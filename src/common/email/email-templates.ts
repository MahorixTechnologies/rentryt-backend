/**
 * Shared HTML shell for transactional emails, branded to match the
 * Rentryt web/admin palette (--primary #1e5bff, --accent #0b2466).
 * Kept table-based and inline-styled for compatibility with Gmail/Outlook
 * clients that strip <style> blocks.
 */
function brandedEmailHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#eef2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 24px rgba(17,24,39,0.08);">
            <tr>
              <td style="background-color:#0b2466;padding:28px 32px;text-align:center;">
                <span style="font-size:20px;font-weight:800;letter-spacing:-0.2px;color:#ffffff;">Rentryt</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 28px 32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#f7f9fb;border-top:1px solid rgba(17,24,39,0.08);">
                <p style="margin:0;font-size:12px;line-height:18px;color:#6b7280;">
                  This is an automated message from Rentryt. If you didn't request this, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function otpDigitsHtml(code: string): string {
  const digits = code.split('');
  const cells = digits
    .map(
      (digit) =>
        `<td style="padding:0 4px;"><div style="width:40px;height:48px;line-height:48px;text-align:center;background-color:#eef2f5;border:1px solid rgba(17,24,39,0.08);border-radius:10px;font-size:24px;font-weight:800;color:#0b2466;letter-spacing:0;">${digit}</div></td>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto 0;"><tr>${cells}</tr></table>`;
}

export function buildOtpEmailHtml(params: {
  heading: string;
  intro: string;
  code: string;
  expiryMinutes: number;
  note?: string;
}): string {
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:#0b2466;">${params.heading}</h1>
    <p style="margin:0;font-size:14px;line-height:22px;color:#111827;">${params.intro}</p>
    ${otpDigitsHtml(params.code)}
    <p style="margin:20px 0 0 0;font-size:13px;line-height:20px;color:#6b7280;text-align:center;">
      This code expires in ${params.expiryMinutes} minute${params.expiryMinutes === 1 ? '' : 's'}.
    </p>
    ${
      params.note
        ? `<p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:#6b7280;">${params.note}</p>`
        : ''
    }
  `;
  return brandedEmailHtml(body);
}

export function buildOtpEmailText(params: {
  heading: string;
  intro: string;
  code: string;
  expiryMinutes: number;
  note?: string;
}): string {
  return [
    params.heading,
    '',
    params.intro,
    '',
    `Your code: ${params.code}`,
    '',
    `This code expires in ${params.expiryMinutes} minute${params.expiryMinutes === 1 ? '' : 's'}.`,
    params.note ? `\n${params.note}` : '',
  ]
    .join('\n')
    .trim();
}
