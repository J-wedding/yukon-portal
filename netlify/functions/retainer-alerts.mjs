// Scheduled every hour. For each client, checks how much budget is left and
// emails their contacts once when it drops to 50%, 20% and 10%.
// Sent thresholds are remembered in Netlify Blobs, so nothing goes out twice.
// A top-up re-arms the thresholds the client is back above.
//
// Env: RESEND_API_KEY, MAIL_FROM ("Studio Yukon <portal@studioyukon.com>"),
//      MAIL_REPLY_TO, ALERT_BCC (your own address), PORTAL_URL (optional),
//      ALERTS_DRY_RUN=1 to log instead of sending.
import { getStore } from "@netlify/blobs";
import { summarize, pendingAlerts } from "../../public/assets/retainer.js";
import { listClients, readJSON } from "../../lib/server.mjs";
import { buildAlertEmail } from "../../lib/alert-email.mjs";
import { sendMail, mailConfigured } from "../../lib/mail.mjs";


export default async () => {
  const dry = process.env.ALERTS_DRY_RUN === "1";
  const configured = mailConfigured();
  const base = (process.env.PORTAL_URL || process.env.URL || "").replace(/\/$/, "");
  const store = getStore("retainer-alerts");
  const users = readJSON("config/users.json", { clients: {} });
  const log = [];

  for (const data of listClients()) {
    const slug = data.client?.slug;
    if (!slug || data.example) { log.push(`${slug}: skipped (example data)`); continue; }

    const summary = summarize(data);
    const state = await store.get(slug, { type: "json" });
    const { send, next } = pendingAlerts(summary, state);

    if (!send) {
      if (JSON.stringify(state) !== JSON.stringify(next)) await store.setJSON(slug, { ...next, updatedAt: new Date().toISOString() });
      log.push(`${slug}: ${summary.pctRemaining.toFixed(1)}% left, nothing to send`);
      continue;
    }

    const contacts = (users.clients?.[slug] || []).filter((u) => u.notify !== false);
    if (!contacts.length) { log.push(`${slug}: ${send}% crossed but no contacts with notify on`); continue; }
    if (!configured && !dry) { log.push(`${slug}: ${send}% crossed, email not configured, will retry`); continue; }

    try {
      for (const u of contacts) {
        const mail = buildAlertEmail({
          summary, threshold: send,
          firstName: (u.name || "").split(" ")[0],
          portalUrl: `${base}/${slug}/`,
          logoUrl: `${base}/assets/studio-yukon.png`,
          signature: process.env.ALERT_SIGNATURE || "Jordy Wedding",
        });
        if (dry) console.log(`[dry run] to ${u.email}: ${mail.subject}`);
        else await sendMail({ to: u.email, bcc: process.env.ALERT_BCC, ...mail });
      }
      if (!dry) await store.setJSON(slug, { ...next, updatedAt: new Date().toISOString(), last: { threshold: send, at: new Date().toISOString(), to: contacts.map((u) => u.email) } });
      log.push(`${slug}: sent ${send}% alert to ${contacts.length} contact(s)${dry ? " (dry run)" : ""}`);
    } catch (err) {
      log.push(`${slug}: sending failed, will retry. ${err.message}`);
    }
  }

  console.log(log.join("\n"));
  return new Response(log.join("\n"), { headers: { "Content-Type": "text/plain" } });
};

export const config = { schedule: "@hourly" };
