// Sending email through Resend. Used for login links and budget alerts.
// Env: RESEND_API_KEY, MAIL_FROM (or ALERT_FROM), MAIL_REPLY_TO (or ALERT_REPLY_TO).
// MAIL_DRY_RUN=1 (or ALERTS_DRY_RUN=1) logs the mail instead of sending it,
// so you can read a login link in the Netlify function log while testing.

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && (process.env.MAIL_FROM || process.env.ALERT_FROM));
export const mailDryRun = () => process.env.MAIL_DRY_RUN === "1" || process.env.ALERTS_DRY_RUN === "1";

export async function sendMail({ to, bcc, subject, html, text }) {
  if (mailDryRun() || !mailConfigured()) {
    console.log(`[mail ${mailDryRun() ? "dry run" : "not configured"}] to ${[].concat(to).join(", ")}: ${subject}\n${text}`);
    return { dryRun: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || process.env.ALERT_FROM,
      to: [].concat(to),
      bcc: bcc ? [].concat(bcc) : undefined,
      reply_to: process.env.MAIL_REPLY_TO || process.env.ALERT_REPLY_TO || undefined,
      subject, html, text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}
