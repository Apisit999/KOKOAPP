import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type CameraUsbStatus = {
  enabled: boolean;
  camera: string | null;
  state: 'off' | 'searching' | 'ready' | 'busy' | 'error';
  importedCount: number;
  lastError: string | null;
};

// Windows sees most cameras (Canon, Nikon, Sony, Fujifilm, phones in photo mode) as
// "portable devices". The Shell can list and copy their files without any vendor SDK.
// Photos already on the card when the camera is first seen are skipped; every photo
// shot after that is copied into the inbox, where the folder watcher imports it.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$inbox = $env:KOKO_USB_INBOX
$shell = New-Object -ComObject Shell.Application
$seen = @{}
$known = @{}
function Say($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
function FileName($item) { try { $n = $item.ExtendedProperty('System.FileName'); if ($n) { return [string]$n } } catch {} ; return [string]$item.Name }
$last = ''
while ($true) {
  try {
    $found = $null; $files = @(); $sawStorage = $false
    foreach ($device in @($shell.Namespace(17).Items())) {
      if ($device.IsFileSystem -or -not $device.IsFolder) { continue }
      foreach ($storage in @($device.GetFolder.Items())) {
        if (-not $storage.IsFolder) { continue }
        $sawStorage = $true
        $dcim = @($storage.GetFolder.Items()) | Where-Object { $_.Name -eq 'DCIM' } | Select-Object -First 1
        if (-not $dcim) { continue }
        $found = [string]$device.Name
        foreach ($dir in @($dcim.GetFolder.Items())) {
          if (-not $dir.IsFolder) { continue }
          foreach ($file in @($dir.GetFolder.Items())) {
            if ($file.IsFolder) { continue }
            $name = FileName $file
            if ($name -match '\.jpe?g$') { $files += ,@(($found + '|' + $dir.Name + '|' + $name), $file, $name) }
          }
        }
      }
      if ($found) { break }
    }
    if (-not $found) {
      $state = if ($sawStorage) { 'busy' } else { 'searching' }
      if ($last -ne $state) { Say @{ type = 'status'; state = $state; camera = $null }; $last = $state }
    } else {
      if ($last -ne "ready:$found") { Say @{ type = 'status'; state = 'ready'; camera = $found }; $last = "ready:$found" }
      if (-not $known.ContainsKey($found)) {
        foreach ($f in $files) { $seen[$f[0]] = $true }
        $known[$found] = $true
      } else {
        foreach ($f in $files) {
          if ($seen.ContainsKey($f[0])) { continue }
          $target = Join-Path $inbox $f[2]
          if (Test-Path -LiteralPath $target) { $target = Join-Path $inbox ([IO.Path]::GetFileNameWithoutExtension($f[2]) + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6) + [IO.Path]::GetExtension($f[2])) }
          $temp = Join-Path $inbox ('.incoming-' + [Guid]::NewGuid().ToString('N'))
          New-Item -ItemType Directory -Path $temp | Out-Null
          $shell.Namespace($temp).CopyHere($f[1], 4 + 16 + 512 + 1024)
          $copied = $null
          for ($i = 0; $i -lt 300 -and -not $copied; $i++) {
            Start-Sleep -Milliseconds 200
            $copied = Get-ChildItem -LiteralPath $temp -File | Select-Object -First 1
          }
          if (-not $copied) { Remove-Item -LiteralPath $temp -Recurse -Force; throw "Copy from camera timed out: $($f[2])" }
          $size = -1
          while ($size -ne $copied.Length) { $size = $copied.Length; Start-Sleep -Milliseconds 300; $copied.Refresh() }
          Move-Item -LiteralPath $copied.FullName -Destination $target
          Remove-Item -LiteralPath $temp -Recurse -Force
          $seen[$f[0]] = $true
          Say @{ type = 'imported'; file = $f[2] }
        }
      }
    }
  } catch {
    Say @{ type = 'error'; message = [string]$_.Exception.Message }
    $last = ''
  }
  Start-Sleep -Milliseconds 1000
}
`;

export class CameraUsbImport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private current: CameraUsbStatus = { enabled: false, camera: null, state: 'off', importedCount: 0, lastError: null };
  private readonly onChange?: (status: CameraUsbStatus) => void;

  constructor(onChange?: (status: CameraUsbStatus) => void) { this.onChange = onChange; }

  start(inbox: string) {
    if (process.platform !== 'win32') throw new Error('USB camera import is available on Windows only.');
    if (!path.isAbsolute(inbox)) throw new Error('Inbox folder must be an absolute path.');
    this.stop();
    mkdirSync(inbox, { recursive: true });
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, KOKO_USB_INBOX: inbox }, windowsHide: true
    });
    this.child = child;
    this.update({ enabled: true, camera: null, state: 'searching', lastError: null });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) this.handle(line);
      }
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      this.update({ enabled: false, state: 'error', lastError: this.current.lastError ?? 'USB camera import stopped unexpectedly.' });
    });
    return this.status();
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (child) child.kill();
    if (this.current.enabled) this.update({ enabled: false, camera: null, state: 'off' });
    return this.status();
  }

  status(): CameraUsbStatus { return { ...this.current }; }

  private handle(line: string) {
    let message: Record<string, unknown>;
    try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'status') {
      const state = message.state === 'ready' || message.state === 'busy' ? message.state : 'searching';
      this.update({ state, camera: typeof message.camera === 'string' ? message.camera : null, lastError: null });
    } else if (message.type === 'imported') {
      this.update({ importedCount: this.current.importedCount + 1 });
    } else if (message.type === 'error') {
      this.update({ lastError: typeof message.message === 'string' ? message.message.slice(0, 300) : 'USB camera error' });
    }
  }

  private update(patch: Partial<CameraUsbStatus>) {
    this.current = { ...this.current, ...patch };
    this.onChange?.(this.status());
  }
}
