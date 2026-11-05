export const SUPPORT_EMAIL = 'kokomemory@gmail.com';
const MAX_DESCRIPTION = 1000;

export type ProblemReportInfo = {
  description: string;
  version: string;
  platform: string;
  arch: string;
  osRelease: string;
  electron: string;
  licenseState: string;
};

/**
 * Builds the text a user sends to support. It only contains app/system facts and what the user typed.
 * It deliberately has no license key, device id, token, file path or photo content.
 */
export function buildProblemReport(info: ProblemReportInfo) {
  const description = info.description.trim().slice(0, MAX_DESCRIPTION);
  const body = [
    description || '(no description)',
    '',
    '--- KOKO Studio ---',
    `App: ${info.version}`,
    `System: ${info.platform} ${info.arch} ${info.osRelease}`,
    `Electron: ${info.electron}`,
    `License: ${info.licenseState}`
  ].join('\n');
  const subject = `KOKO Studio problem report (${info.version})`;
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { subject, body, mailto };
}
