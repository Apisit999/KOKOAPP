// Guest receipt printer settings: pure validation, no UI and no files. Anything unexpected falls back to "no printer".

export type ReceiptPrinterConfig =
  | { kind: 'network'; host: string; port?: number }
  | { kind: 'windows'; name: string }
  | { kind: 'serial'; port: string; baud?: number };

export type ReceiptSettings = { paper: 58 | 80; autoPrint: boolean; printer: ReceiptPrinterConfig | null };
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = { paper: 58, autoPrint: false, printer: null };
export const SERIAL_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

export function normalizeReceiptPrinter(value: unknown): ReceiptPrinterConfig | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.kind === 'network') {
    if (typeof item.host !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(item.host)) return null;
    const port = typeof item.port === 'number' && Number.isInteger(item.port) && item.port >= 1 && item.port <= 65535 ? item.port : undefined;
    return port && port !== 9100 ? { kind: 'network', host: item.host, port } : { kind: 'network', host: item.host };
  }
  if (item.kind === 'windows') {
    return typeof item.name === 'string' && item.name.length >= 1 && item.name.length <= 200 && !/[\u0000-\u001f]/.test(item.name) ? { kind: 'windows', name: item.name } : null;
  }
  if (item.kind === 'serial') {
    if (typeof item.port !== 'string' || !/^COM\d{1,3}$/.test(item.port)) return null;
    const baud = SERIAL_BAUD_RATES.find(rate => rate === item.baud);
    return baud && baud !== 9600 ? { kind: 'serial', port: item.port, baud } : { kind: 'serial', port: item.port };
  }
  return null;
}

export function normalizeReceiptSettings(value: unknown): ReceiptSettings {
  const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const printer = normalizeReceiptPrinter(item.printer);
  return { paper: item.paper === 80 ? 80 : 58, autoPrint: item.autoPrint === true && printer !== null, printer };
}
