// Turns a raw error message (often an Electron IPC error such as "Error invoking remote method '...': Error: ENOSPC ...") into text a person can act on.
export function friendlyErrorText(message: string, th: boolean): string {
  if (/ENOSPC|EDQUOT|no space left|disk quota|Not enough free space/i.test(message)) {
    return th ? 'พื้นที่จัดเก็บเต็ม กรุณาเพิ่มพื้นที่ว่างหรือเลือกโฟลเดอร์อื่น' : 'The storage disk is full. Free up space or choose another folder.';
  }
  return message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
}
