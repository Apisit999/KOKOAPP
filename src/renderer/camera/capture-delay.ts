/** Abortable wait used by countdowns and inter-shot pauses. */
export function waitForCaptureDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Capture canceled', 'AbortError')); return; }
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new DOMException('Capture canceled', 'AbortError')); };
    const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
    timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
