import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { sendToNetworkPrinter } from './escpos-receipt.ts';
import type { PrinterStatus, ReceiptPrinterConfig } from '../../shared/receipt-settings.ts';
export type { PrinterStatus, ReceiptPrinterConfig } from '../../shared/receipt-settings.ts';

/**
 * One way to reach any ESC/POS receipt printer, whatever the brand:
 *  - network:  LAN / Wi-Fi printers, raw port 9100 (no driver needed)
 *  - windows:  any printer installed in Windows (USB, Bluetooth, shared), sent as RAW bytes through the spooler
 *  - serial:   a COM port (RS-232, USB-serial, or a paired Bluetooth printer's "Outgoing" COM port)
 * The receipt bytes are identical for all three; only the way they travel differs.
 */
export type ExecFn = (file: string, args: string[], options: { input?: string; env?: Record<string, string>; timeoutMs: number }) => Promise<string>;

const POWERSHELL = 'powershell.exe';
const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text'];

const defaultExec: ExecFn = (file, args, options) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { timeout: options.timeoutMs, windowsHide: true, env: { ...process.env, ...options.env }, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error((stderr || stdout || error.message).toString().trim().slice(0, 300)));
    else resolve(stdout.toString());
  });
  if (options.input !== undefined) child.stdin?.end(options.input);
});

/** Sends RAW bytes to a named Windows printer. The name travels in an environment variable, never inside the script text. */
const RAW_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class KokoRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static void Send(string name, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(name, out h, IntPtr.Zero)) throw new Exception("Could not open printer (error " + Marshal.GetLastWin32Error() + ")");
    try {
      var di = new DOCINFO { pDocName = "KOKO receipt", pDataType = "RAW" };
      if (!StartDocPrinter(h, 1, di)) throw new Exception("Printer refused the job (error " + Marshal.GetLastWin32Error() + ")");
      try {
        StartPagePrinter(h); int written;
        if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) throw new Exception("Printer did not accept all data");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
[KokoRaw]::Send($env:KOKO_RECEIPT_PRINTER, $bytes)
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

const encodeScript = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

export async function sendToWindowsPrinter(name: string, bytes: Uint8Array, exec: ExecFn = defaultExec): Promise<void> {
  if (typeof name !== 'string' || name.length < 1 || name.length > 200 || /[\u0000-\u001f]/.test(name)) throw new Error('Invalid printer name');
  await exec(POWERSHELL, [...BASE_ARGS, '-EncodedCommand', encodeScript(RAW_SCRIPT)], { input: Buffer.from(bytes).toString('base64'), env: { KOKO_RECEIPT_PRINTER: name }, timeoutMs: 15000 });
}

/** Printers Windows knows about, for a pick-list in settings. */
export async function listWindowsPrinters(exec: ExecFn = defaultExec): Promise<string[]> {
  const out = await exec(POWERSHELL, [...BASE_ARGS, '-Command', 'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'], { timeoutMs: 10000 });
  const text = out.trim();
  if (!text) return [];
  const parsed: unknown = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((item): item is string => typeof item === 'string');
}

export async function listSerialPorts(exec: ExecFn = defaultExec): Promise<string[]> {
  const out = await exec(POWERSHELL, [...BASE_ARGS, '-Command', "[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress"], { timeoutMs: 10000 });
  const text = out.trim();
  if (!text) return [];
  const parsed: unknown = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((item): item is string => typeof item === 'string' && /^COM\d{1,3}$/.test(item)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

export type SerialWriter = (path: string, data: Uint8Array) => Promise<void>;

export async function sendToSerialPrinter(port: string, bytes: Uint8Array, options: { baud?: number } = {}, exec: ExecFn = defaultExec, write: SerialWriter = (path, data) => writeFile(path, data)): Promise<void> {
  if (!/^COM\d{1,3}$/.test(port)) throw new Error('Invalid COM port');
  const baud = options.baud ?? 9600;
  if (![1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(baud)) throw new Error('Unsupported baud rate');
  await exec('mode.com', [port, `BAUD=${baud}`, 'PARITY=n', 'DATA=8', 'STOP=1'], { timeoutMs: 5000 });
  await write(`\\\\.\\${port}`, bytes);
}

export function sendReceipt(config: ReceiptPrinterConfig, bytes: Uint8Array): Promise<void> {
  switch (config.kind) {
    case 'network': return sendToNetworkPrinter(config.host, bytes, { port: config.port });
    case 'windows': return sendToWindowsPrinter(config.name, bytes);
    case 'serial': return sendToSerialPrinter(config.port, bytes, { baud: config.baud });
    default: return Promise.reject(new Error('Unknown receipt printer type'));
  }
}

/**
 * Printer health from the real-time status commands (DLE EOT 1, 2 and 4), which standard ESC/POS printers answer with one byte each.
 * Only network printers can be asked: a Windows queue or COM port gives no reply path that is the same on every model.
 */

/** `replies` holds the answers to DLE EOT 1, 2 and 4, in that order. Fewer than three bytes means the printer does not report status. */
export function parsePrinterStatus(replies: Uint8Array): PrinterStatus {
  if (replies.length < 3) return { state: 'unknown' };
  const [printer, offline, paper] = replies;
  if (paper & 0x60) return { state: 'paper-out' };
  if (offline & 0x04) return { state: 'cover-open' };
  if (offline & 0x40) return { state: 'error' };
  if (offline & 0x20) return { state: 'paper-out' };
  if (printer & 0x08) return { state: 'offline' };
  if (paper & 0x0c) return { state: 'paper-low' };
  return { state: 'ok' };
}

export function queryNetworkPrinterStatus(host: string, options: { port?: number; timeoutMs?: number } = {}): Promise<PrinterStatus> {
  const port = options.port ?? 9100;
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(new Error('Invalid printer address'));
  return new Promise(resolve => {
    const socket = new Socket();
    const received: number[] = [];
    let settled = false;
    const finish = (status?: PrinterStatus) => { if (settled) return; settled = true; socket.destroy(); resolve(status ?? parsePrinterStatus(Uint8Array.from(received))); };
    const timeout = options.timeoutMs ?? 2000;
    socket.setTimeout(timeout, () => finish(received.length ? undefined : { state: 'unknown' }));
    socket.once('error', error => finish({ state: 'unreachable', detail: error.message }));
    socket.on('data', chunk => { received.push(...chunk); if (received.length >= 3) finish(); });
    socket.connect(port, host, () => socket.write(Buffer.from([0x10, 0x04, 0x01, 0x10, 0x04, 0x02, 0x10, 0x04, 0x04])));
  });
}

export async function getReceiptPrinterStatus(config: ReceiptPrinterConfig): Promise<PrinterStatus> {
  if (config.kind === 'network') return queryNetworkPrinterStatus(config.host, { port: config.port });
  if (config.kind === 'windows') {
    try { return (await listWindowsPrinters()).includes(config.name) ? { state: 'unknown', detail: 'installed' } : { state: 'unreachable', detail: 'Printer is not installed in Windows' }; }
    catch (error) { return { state: 'unknown', detail: error instanceof Error ? error.message : undefined }; }
  }
  try { return (await listSerialPorts()).includes(config.port) ? { state: 'unknown', detail: 'present' } : { state: 'unreachable', detail: `${config.port} is not available` }; }
  catch (error) { return { state: 'unknown', detail: error instanceof Error ? error.message : undefined }; }
}
