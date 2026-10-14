import { useEffect, useRef, useState } from 'react';
import type { AccountLinkPollResult, AccountLinkStart, LicenseSnapshot } from '../shared/license-contract';

export function AccountLinkCard({ th, canLink, onLinked }: { th: boolean; canLink: boolean; onLinked: (license: LicenseSnapshot) => void }) {
  const [start, setStart] = useState<AccountLinkStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const onLinkedRef = useRef(onLinked);
  const thRef = useRef(th);
  onLinkedRef.current = onLinked;
  thRef.current = th;

  useEffect(() => {
    if (!start || complete) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const retry = (delayMs: number) => {
      if (!stopped) timer = setTimeout(poll, Math.max(1000, Math.min(60_000, delayMs)));
    };
    const poll = async () => {
      if (stopped) return;
      if (Date.parse(start.expiresAt) <= Date.now()) {
        setError(thRef.current ? 'รหัสเชื่อมบัญชีหมดอายุแล้ว กรุณาเริ่มใหม่' : 'The account-link code expired. Start again.');
        setStart(null);
        void window.koko.cancelLicenseAccountLink().catch(() => false);
        return;
      }
      try {
        const result: AccountLinkPollResult = await window.koko.pollLicenseAccountLink();
        if (stopped) return;
        if (result.status === 'approved') {
          setComplete(true);
          setStart(null);
          onLinkedRef.current(result.license);
          return;
        }
        attempts = 0;
        setError('');
        retry((result.retryAfterSeconds ?? 5) * 1000);
      } catch (cause) {
        if (stopped) return;
        const message = cause instanceof Error ? cause.message : '';
        if (/expired|denied|no account link|entitlement could not be verified/i.test(message)) {
          setError(message || (thRef.current ? 'ตรวจสอบการเชื่อมบัญชีไม่สำเร็จ กรุณาเริ่มใหม่' : 'Could not check account approval. Start again.'));
          setStart(null);
          return;
        }
        attempts += 1;
        setError(thRef.current ? 'การเชื่อมต่อสะดุด กำลังลองตรวจสอบอีกครั้ง…' : 'Connection interrupted. Retrying approval check…');
        retry(Math.min(30_000, 2000 * 2 ** Math.min(attempts - 1, 4)));
      }
    };
    timer = setTimeout(poll, 5000);
    return () => { stopped = true; clearTimeout(timer); void window.koko.cancelLicenseAccountLink().catch(() => false); };
  }, [start, complete]);

  async function begin() {
    setBusy(true); setError(''); setComplete(false);
    try { setStart(await window.koko.beginLicenseAccountLink()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (th ? 'เริ่มเชื่อมบัญชีไม่สำเร็จ' : 'Could not start account linking')); }
    finally { setBusy(false); }
  }
  async function cancel() {
    await window.koko.cancelLicenseAccountLink().catch(() => false);
    setStart(null); setError('');
  }

  return <section className="activate-card">
    <h2>{th ? 'เชื่อมอุปกรณ์กับบัญชี KOKO' : 'Link this device to your KOKO account'}</h2>
    <p>{th ? 'เปิดหน้าเว็บที่ระบบเปิดให้ ลงชื่อเข้าใช้ แล้วกรอกรหัสด้านล่างเพื่อยืนยันอุปกรณ์นี้' : 'Sign in on the browser page opened for you, then enter the code below to approve this device.'}</p>
    {!start && !complete && <button className="primary" type="button" onClick={() => void begin()} disabled={!canLink || busy}>{busy ? (th ? 'กำลังเปิดหน้าเชื่อมบัญชี…' : 'Opening account link…') : (th ? 'เริ่มเชื่อมบัญชี' : 'Link KOKO account')}</button>}
    {!canLink && !complete && <p className="muted">{th ? 'รับสิทธิ์ Free บนอุปกรณ์นี้ก่อน แล้วจึงเชื่อมบัญชีได้' : 'Claim the Free license on this device before linking an account.'}</p>}
    {start && <div className="account-link-code" role="status"><p>{th ? 'กรอกรหัสนี้บนหน้าเว็บ KOKO' : 'Enter this code on the KOKO page'}</p><strong>{start.userCode}</strong><p className="muted">{th ? `หมดเวลา ${new Date(start.expiresAt).toLocaleTimeString('th-TH')}` : `Expires ${new Date(start.expiresAt).toLocaleTimeString()}`}</p><button className="camera-secondary" type="button" onClick={() => void cancel()}>{th ? 'ยกเลิก' : 'Cancel'}</button></div>}
    {complete && <p role="status">{th ? 'เชื่อมอุปกรณ์กับบัญชีเรียบร้อยแล้ว' : 'This device is linked to your KOKO account.'}</p>}
    {error && <p className="activation-error" role="alert">{error}</p>}
  </section>;
}
