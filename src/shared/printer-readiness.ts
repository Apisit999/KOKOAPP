export type PrinterReadiness = { state: 'ready' | 'optional'; detail: { th: string; en: string } };

/**
 * Readiness text for the printer step. Finding a printer only means Windows lists it;
 * it never says a model is supported or tested (see docs/SOFTWARE_FIRST_PLAN_TH.md).
 * `count` is null while the scan has not finished or failed.
 */
export function printerReadiness(count: number | null): PrinterReadiness {
  if (count === null) return { state: 'optional', detail: { th: 'ยังตรวจเครื่องพิมพ์ไม่ได้ ใช้ "จำลองการพิมพ์" ทดสอบได้', en: 'Could not scan printers yet. You can still use "Simulate print".' } };
  if (count <= 0) return { state: 'optional', detail: { th: 'ไม่พบเครื่องพิมพ์ในเครื่องนี้ ใช้ "จำลองการพิมพ์" ทดสอบได้', en: 'No printer found on this PC. You can use "Simulate print" to test.' } };
  return { state: 'ready', detail: { th: `Windows พบเครื่องพิมพ์ ${count} เครื่อง (ยังไม่ได้ทดสอบกับรุ่นใดโดยเฉพาะ ควรพิมพ์ทดสอบก่อนใช้งานจริง)`, en: `Windows lists ${count} printer(s). No model is tested yet; do a test print before a real event.` } };
}
