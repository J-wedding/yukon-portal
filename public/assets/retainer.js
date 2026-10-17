// An entry is either hours ({ hours, rate? }) or a fixed cost ({ kind: "cost", amount }).
// Shared retainer maths. Used by the dashboard (browser), the alert function
// and scripts/portal.mjs (Node), so every surface shows the same numbers.
// Pure JavaScript, no dependencies.

export const THRESHOLDS = [50, 20, 10]; // percent of budget still remaining
export const DAY = 86400000;

export function parseDate(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Today's date in Amsterdam as YYYY-MM-DD.
export function todayISO(tz = "Europe/Amsterdam") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function summarize(data, asOfISO) {
  const r = data.retainer;
  const start = parseDate(r.start);
  const end = parseDate(r.end);
  const asOf = parseDate(asOfISO || data.asOf || todayISO());

  const deposits = (r.deposits || [])
    .map((x) => ({ ...x, d: parseDate(x.date) }))
    .filter((x) => x.d <= asOf)
    .sort((a, b) => a.d - b.d);

  const projects = new Map((data.projects || []).map((p) => [p.id, { ...p, hours: 0, euro: 0, entries: 0 }]));

  let cum = 0;
  const entries = (data.entries || [])
    .map((e) => ({ ...e, hours: isCost(e) ? 0 : Number(e.hours) || 0, d: parseDate(e.date), euro: round2(isCost(e) ? e.amount : e.hours * (e.rate ?? r.rate)) }))
    .filter((e) => e.d <= asOf)
    .sort((a, b) => a.d - b.d || String(a.id).localeCompare(String(b.id)))
    .map((e) => {
      cum = round2(cum + e.euro);
      if (!e.project) return { ...e, cum };
      const p = projects.get(e.project) || projects.set(e.project, { id: e.project, name: e.project, hours: 0, euro: 0, entries: 0 }).get(e.project);
      p.hours = round2(p.hours + e.hours);
      p.euro = round2(p.euro + e.euro);
      p.entries += 1;
      return { ...e, cum };
    });

  const budget = deposits.reduce((s, x) => s + x.amount, 0);
  const spent = cum;
  const hours = round2(entries.reduce((s, e) => s + e.hours, 0));
  const costs = round2(entries.filter(isCost).reduce((s, e) => s + e.euro, 0));
  const remaining = round2(budget - spent);
  const hoursLeft = r.rate > 0 ? Math.max(0, remaining) / r.rate : 0;
  const pctRemaining = budget > 0 ? (remaining / budget) * 100 : 0;

  const elapsedDays = Math.max(1, (asOf - start) / DAY + 1);
  const totalDays = (end - start) / DAY + 1;
  const burnPerDay = spent / elapsedDays;
  const pacePlanned = budget * Math.min(1, elapsedDays / totalDays);
  const runOut = burnPerDay > 0 && remaining > 0 ? new Date(asOf.getTime() + (remaining / burnPerDay) * DAY) : null;

  const months = [];
  for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); m <= end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const inMonth = entries.filter((e) => e.d.getUTCFullYear() === m.getUTCFullYear() && e.d.getUTCMonth() === m.getUTCMonth());
    months.push({ m, hours: round2(inMonth.reduce((s, e) => s + e.hours, 0)), past: m <= asOf });
  }
  const past = months.filter((x) => x.past);
  const thisMonth = past[past.length - 1] || { m: asOf, hours: 0 };
  const full = past.slice(0, -1);
  const avgHours = full.length ? full.reduce((s, x) => s + x.hours, 0) / full.length : thisMonth.hours;

  const status =
    remaining < 0 ? "over" :
    pctRemaining <= 20 ? "low" :
    spent - pacePlanned > budget * 0.08 ? "fast" :
    pacePlanned - spent > budget * 0.08 ? "slow" : "on-track";

  return {
    client: data.client, rate: r.rate, start, end, asOf, deposits,
    projects: [...projects.values()], entries, budget, spent, hours, costs, remaining, hoursLeft, pctRemaining,
    burnPerDay, pacePlanned, runOut, months, thisMonth, avgHours, status,
  };
}

// Which alert thresholds are crossed and not yet sent.
// state = { budget, sent: [50, 20] } from the previous run, or null.
// A top-up (budget changed) re-arms every threshold the client is back above.
export function pendingAlerts(summary, state) {
  const pct = summary.pctRemaining;
  let sent = state?.sent ? [...state.sent] : [];
  if (state && state.budget !== summary.budget) sent = sent.filter((t) => pct <= t);
  const crossed = summary.budget > 0 ? THRESHOLDS.filter((t) => pct <= t && !sent.includes(t)) : [];
  return {
    send: crossed.length ? Math.min(...crossed) : null,
    next: { budget: summary.budget, sent: [...new Set([...sent, ...crossed])].sort((a, b) => b - a) },
  };
}

export function isCost(e) {
  return e.kind === "cost";
}

// Entries grouped per calendar month, newest first, with subtotals.
export function byMonth(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, { key, m: parseDate(key + "-01"), entries: [], hours: 0, euro: 0 });
    const g = groups.get(key);
    g.entries.push(e);
    g.hours = round2(g.hours + e.hours);
    g.euro = round2(g.euro + e.euro);
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key)).map((g) => ({ ...g, entries: g.entries.sort((a, b) => b.d - a.d) }));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
