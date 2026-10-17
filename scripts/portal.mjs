#!/usr/bin/env node
// Studio Yukon portal CLI. Every change to client data and logins goes through here,
// so the JSON stays valid and the numbers are recalculated after each change.
//
//   node scripts/portal.mjs help
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { summarize, pendingAlerts, todayISO, THRESHOLDS } from "../public/assets/retainer.js";
import { hashPassword } from "../lib/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public/data");
const USERS = path.join(ROOT, "config/users.json");
const RESERVED = new Set(["admin", "login", "logout", "api", "data", "assets", "favicon"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

const HELP = `
Studio Yukon portal

Reading
  status [client]                         Budget, spend, remaining and alerts for one or all clients
  show <client> [--entries 10]            Projects and latest log entries with their ids
  users [client]                          Logins (never shows passwords)
  validate                                Check every data file and the logins file

Clients and projects
  client:new <slug> --name "Acme" --rate 110 --start 2027-01-01 --end 2027-12-31
             [--deposit 5000] [--deposit-date 2027-01-01] [--label "Design capaciteit"]
             [--team "Marketing"] [--contact "Name"] [--brand #hex --deep #hex --soft #hex --accent #hex]
             [--logo /assets/clients/acme.svg]
  client:set <slug> [--name] [--rate] [--start] [--end] [--label] [--team] [--contact] [--brand] [--deep] [--soft] [--accent] [--hero] [--hero-ink] [--hero-fill] [--logo] [--branded-login on|off]
  client:live <slug> [--clear-entries|--reset]  Remove the example flag. --reset also clears the example deposits
  scope <client> [--in "Item | Item"] [--out "Item | Item"] [--note "..."]   What falls inside and outside the retainer (shown on the dashboard)
  project:add <client> --name "Social templates" [--id social] [--status Lopend]
  project:set <client> <projectId> [--name] [--status Opgeleverd]

Hours and money
  log <client> --hours 2 --note "What was done" [--project <id> | --project-name "Laadpas campagne"] [--date] [--rate]
                                          No project given: goes to Ad hoc. A new --project-name is created automatically.
  import <client> --file lines.json [--dry-run]   Many lines at once (from notes). Lines already logged are skipped.
  cost <client> --amount 120 --note "Stocklicentie" [--project <id>] [--date]   Fixed cost, no hours
  entry:edit <client> <entryId> [--hours] [--amount] [--note] [--date] [--project] [--rate]
  entry:remove <client> <entryId>
  deposit <client> --amount 3000 [--date 2027-03-01] [--label "Aanvulling"]

Logins (email decides which dashboard someone lands on; they log in with a link sent to that address)
  user:add <client> --email a@b.nl --name "Full Name" [--no-notify]
  user:password --email a@b.nl [--password x]     Optional fallback password, rarely needed
  user:notify --email a@b.nl --on|--off
  user:remove --email a@b.nl

Dates default to today (Amsterdam). Generated passwords are printed once.
`;

// ---------- io ----------
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const dataPath = (slug) => path.join(DATA, `${slug}.json`);
function load(slug) {
  if (!slug) fail("Name the client, e.g. vandebron.");
  if (!fs.existsSync(dataPath(slug))) fail(`No client "${slug}". Known: ${clients().join(", ") || "none"}.`);
  return readJSON(dataPath(slug));
}
function save(data) {
  data.updated = todayISO();
  const problems = check(data);
  if (problems.length) fail(`Not saved:\n- ${problems.join("\n- ")}`);
  writeJSON(dataPath(data.client.slug), data);
  syncBrand(data);
}

// The login page shows the client's logo and colours when someone opens /<slug>/.
// That needs a small public file, because the data file itself is private.
// Turn it off per client with: client:set <slug> --branded-login off
const BRANDS = path.join(ROOT, "public/assets/clients");
function syncBrand(data) {
  const file = path.join(BRANDS, `${data.client.slug}.json`);
  if (data.brandedLogin === false) { if (fs.existsSync(file)) fs.rmSync(file); return; }
  const t = data.theme || {};
  fs.mkdirSync(BRANDS, { recursive: true });
  writeJSON(file, { name: data.client.name, logo: t.logo || null, brand: t.brand, brandDeep: t.brandDeep, brandSoft: t.brandSoft, hero: t.hero, heroInk: t.heroInk, heroFill: t.heroFill, radius: t.radius });
}
const clients = () => (fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : []);
const loadUsers = () => (fs.existsSync(USERS) ? readJSON(USERS) : { clients: {} });
const saveUsers = (u) => writeJSON(USERS, u);

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }
function ok(msg) { console.log(`✓ ${msg}`); }
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40);
const num = (v, name) => { const n = Number(String(v).replace(",", ".")); if (!Number.isFinite(n)) fail(`--${name} must be a number`); return n; };
const date = (v, name = "date") => { const d = v || todayISO(); if (!DATE.test(d)) fail(`--${name} must be YYYY-MM-DD`); return d; };
const genPassword = () => crypto.randomBytes(9).toString("base64url");
// Find a project by id or (case-insensitive) name. Creates it when createName is given and nothing matches.
function resolveProject(data, { id, name } = {}) {
  if (id) {
    const p = data.projects.find((x) => x.id === id);
    if (!p) fail(`No project "${id}". Known: ${data.projects.map((x) => x.id).join(", ")}. Or pass --project-name to create one.`);
    return { project: p, created: false };
  }
  if (!name) {
    let p = data.projects.find((x) => x.id === "adhoc");
    if (!p) { p = { id: "adhoc", name: "Ad hoc aanpassingen", status: "Doorlopend" }; data.projects.push(p); return { project: p, created: true }; }
    return { project: p, created: false };
  }
  const norm = (v) => slugify(v);
  const p = data.projects.find((x) => norm(x.name) === norm(name) || x.id === norm(name));
  if (p) return { project: p, created: false };
  let nid = norm(name) || "project", i = 2;
  while (data.projects.some((x) => x.id === nid)) nid = `${norm(name)}-${i++}`;
  const created = { id: nid, name: name.trim(), status: "Lopend" };
  data.projects.push(created);
  return { project: created, created: true };
}

// Stable fingerprint so the same note line is never logged twice.
function fingerprint(e) {
  const raw = e.src ? String(e.src) : `${e.date}|${e.kind || "hours"}|${e.hours ?? e.amount}|${e.note || ""}`;
  return crypto.createHash("sha256").update(raw.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

function nextEntryId(data) {
  const max = Math.max(0, ...(data.entries || []).map((e) => Number(String(e.id || "").replace(/\D/g, "")) || 0));
  return `e${max + 1}`;
}

// ---------- validation ----------
function check(data) {
  const p = [];
  const c = data.client || {};
  if (!c.slug || !/^[a-z0-9-]+$/.test(c.slug)) p.push("client.slug must be lowercase letters, numbers or hyphens");
  if (RESERVED.has(c.slug)) p.push(`"${c.slug}" is reserved`);
  if (!c.name) p.push("client.name missing");
  const r = data.retainer || {};
  if (!DATE.test(r.start || "") || !DATE.test(r.end || "")) p.push("retainer.start and retainer.end must be YYYY-MM-DD");
  if (r.start > r.end) p.push("retainer.start is after retainer.end");
  if (!(r.rate > 0)) p.push("retainer.rate must be above 0");
  for (const d of r.deposits || []) if (!DATE.test(d.date) || !(d.amount > 0)) p.push(`bad deposit ${JSON.stringify(d)}`);
  const ids = new Set();
  for (const pr of data.projects || []) {
    if (!pr.id || ids.has(pr.id)) p.push(`project id "${pr.id}" missing or duplicate`);
    ids.add(pr.id);
  }
  const eids = new Set();
  for (const e of data.entries || []) {
    if (!e.id || eids.has(e.id)) p.push(`entry id "${e.id}" missing or duplicate`);
    eids.add(e.id);
    if (!DATE.test(e.date)) p.push(`entry ${e.id}: bad date`);
    if (e.kind === "cost") {
      if (e.project && !ids.has(e.project)) p.push(`entry ${e.id}: unknown project "${e.project}"`);
      if (!(e.amount > 0)) p.push(`entry ${e.id}: cost amount must be above 0`);
      if (!e.note) p.push(`entry ${e.id}: a cost needs a note saying what it was`);
    } else {
      if (!ids.has(e.project)) p.push(`entry ${e.id}: unknown project "${e.project}"`);
      if (!(e.hours > 0) || e.hours > 24) p.push(`entry ${e.id}: hours must be between 0 and 24`);
    }
  }
  return p;
}

// ---------- reporting ----------
function report(data, before) {
  const m = summarize(data);
  const pct = m.pctRemaining;
  const lines = [
    `${m.client.name}: ${eur.format(m.remaining)} left of ${eur.format(m.budget)} (${pct.toFixed(1)}%)`,
    `  spent ${eur.format(m.spent)} over ${m.hours} h at ${eur.format(m.rate)}/h${m.runOut ? `, runs out around ${m.runOut.toISOString().slice(0, 10)}` : ""}`,
  ];
  const today = data.asOf || todayISO();
  const future = (data.retainer.deposits || []).filter((d) => d.date > today);
  for (const d of future) lines.push(`  ${eur.format(d.amount)} (${d.label || "deposit"}) counts from ${d.date}`);
  if (data.example) lines.push("  example data: alerts are off for this client");
  if (before) {
    const crossed = THRESHOLDS.filter((t) => pct <= t && before.pctRemaining > t);
    if (crossed.length) lines.push(data.example
      ? `  ⚑ crossed the ${Math.min(...crossed)}% line. No email, because this is example data.`
      : `  ⚑ crossed the ${Math.min(...crossed)}% line. The client gets an email within the hour after deploy.`);
  }
  if (m.remaining < 0) lines.push("  ⚠ over budget");
  console.log(lines.join("\n"));
}

// ---------- commands ----------
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    name: { type: "string" }, rate: { type: "string" }, start: { type: "string" }, end: { type: "string" },
    deposit: { type: "string" }, "deposit-date": { type: "string" }, label: { type: "string" },
    team: { type: "string" }, contact: { type: "string" }, brand: { type: "string" }, deep: { type: "string" },
    soft: { type: "string" }, accent: { type: "string" }, hero: { type: "string" }, "hero-ink": { type: "string" }, "hero-fill": { type: "string" }, "branded-login": { type: "string" }, in: { type: "string" }, out: { type: "string" }, "project-name": { type: "string" }, file: { type: "string" }, "dry-run": { type: "boolean" }, logo: { type: "string" }, id: { type: "string" },
    status: { type: "string" }, project: { type: "string" }, hours: { type: "string" }, note: { type: "string" },
    date: { type: "string" }, amount: { type: "string" }, email: { type: "string" }, password: { type: "string" },
    "no-notify": { type: "boolean" }, on: { type: "boolean" }, off: { type: "boolean" },
    "clear-entries": { type: "boolean" }, reset: { type: "boolean" }, entries: { type: "string" },
  },
});
const [cmd, a1, a2] = positionals;

const commands = {
  help() { console.log(HELP); },

  status() {
    const list = a1 ? [a1] : clients();
    if (!list.length) return console.log("No clients yet.");
    for (const s of list) report(load(s));
  },

  show() {
    const data = load(a1);
    const m = summarize(data);
    report(data);
    console.log("\nProjects");
    for (const p of m.projects) console.log(`  ${p.id.padEnd(20)} ${String(p.hours).padStart(6)} h  ${p.status || ""}  ${p.name}`);
    const n = Number(o.entries || 10);
    console.log(`\nLatest ${n} entries`);
    for (const e of [...(data.entries || [])].sort((x, y) => y.date.localeCompare(x.date)).slice(0, n))
      console.log(`  ${e.id.padEnd(6)} ${e.date}  ${e.kind === "cost" ? ("€" + e.amount).padStart(6) : (String(e.hours) + " h").padStart(6)}  ${(e.project || "kosten").padEnd(18)} ${e.note || ""}`);
  },

  validate() {
    let bad = 0;
    for (const s of clients()) {
      const data = readJSON(dataPath(s));
      const p = check(data);
      if (data.client?.slug !== s) p.push(`file name ${s}.json does not match client.slug "${data.client?.slug}"`);
      if (p.length) { bad++; console.log(`✗ ${s}\n  - ${p.join("\n  - ")}`); } else ok(s);
    }
    const u = loadUsers();
    const seen = new Map();
    for (const [c, list] of Object.entries(u.clients || {})) {
      if (!clients().includes(c)) { bad++; console.log(`✗ users: "${c}" has logins but no data file`); }
      for (const x of list) {
        const e = x.email.toLowerCase();
        if (seen.has(e)) { bad++; console.log(`✗ users: ${e} is on both ${seen.get(e)} and ${c}`); }
        seen.set(e, c);
        if (x.password && !String(x.password).startsWith("scrypt$")) { bad++; console.log(`✗ users: ${e} has a password that is not hashed`); }
      }
    }
    if (!bad) ok("users");
    process.exit(bad ? 1 : 0);
  },

  "client:new"() {
    const slug = slugify(a1 || o.name || "");
    if (!slug) fail("Give a slug, e.g. client:new acme --name \"Acme\"");
    if (RESERVED.has(slug)) fail(`"${slug}" is reserved, pick another slug`);
    if (fs.existsSync(dataPath(slug))) fail(`${slug} already exists`);
    if (!o.name || !o.rate || !o.start || !o.end) fail("client:new needs --name, --rate, --start and --end");
    const data = {
      client: { name: o.name, slug, team: o.team || "", contact: o.contact || "" },
      theme: { brand: o.brand || "#141414", brandDeep: o.deep || "#141414", brandSoft: o.soft || "#EDEDEA", accent: o.accent || "#ED1C24", logo: o.logo || null },
      updated: todayISO(),
      retainer: {
        label: o.label || "Retainer",
        start: date(o.start, "start"), end: date(o.end, "end"), rate: num(o.rate, "rate"),
        deposits: o.deposit ? [{ date: date(o["deposit-date"] || o.start, "deposit-date"), amount: num(o.deposit, "deposit"), label: "Startbedrag" }] : [],
      },
      projects: [{ id: "adhoc", name: "Ad hoc aanpassingen", status: "Doorlopend" }],
      entries: [],
    };
    fs.mkdirSync(DATA, { recursive: true });
    save(data);
    const u = loadUsers(); u.clients ||= {}; u.clients[slug] ||= []; saveUsers(u);
    ok(`Created ${slug}. Dashboard: /${slug}/`);
    console.log("Next: add logins with user:add, and a logo in public/assets/clients/.");
  },

  "client:set"() {
    const data = load(a1);
    const map = { name: ["client", "name"], team: ["client", "team"], contact: ["client", "contact"], label: ["retainer", "label"], start: ["retainer", "start"], end: ["retainer", "end"], brand: ["theme", "brand"], deep: ["theme", "brandDeep"], soft: ["theme", "brandSoft"], accent: ["theme", "accent"], hero: ["theme", "hero"], "hero-ink": ["theme", "heroInk"], "hero-fill": ["theme", "heroFill"], logo: ["theme", "logo"] };
    let changed = 0;
    for (const [k, [obj, key]] of Object.entries(map)) if (o[k] !== undefined) { data[obj] ||= {}; data[obj][key] = o[k]; changed++; }
    if (o.rate !== undefined) { data.retainer.rate = num(o.rate, "rate"); changed++; }
    if (o["branded-login"] !== undefined) { data.brandedLogin = o["branded-login"] !== "off"; changed++; }
    if (!changed) fail("Nothing to change");
    save(data); ok(`Updated ${a1}`); report(data);
  },

  "client:live"() {
    const data = load(a1);
    delete data.example; delete data.asOf;
    if (o["clear-entries"] || o.reset) data.entries = [];
    if (o.reset) data.retainer.deposits = [];
    save(data); ok(`${a1} now shows real data${o.reset ? " (log and deposits cleared)" : o["clear-entries"] ? " (log cleared)" : ""}`); report(data);
  },

  scope() {
    const data = load(a1);
    const split = (v) => String(v).split("|").map((x) => x.trim()).filter(Boolean);
    const sc = (data.retainer.scope ||= { included: [], excluded: [] });
    if (o.in !== undefined) sc.included = split(o.in);
    if (o.out !== undefined) sc.excluded = split(o.out);
    if (o.note !== undefined) sc.note = o.note;
    if (o.in === undefined && o.out === undefined && o.note === undefined) {
      console.log("Valt eronder:\n" + (sc.included || []).map((x) => "  + " + x).join("\n"));
      console.log("Valt erbuiten:\n" + (sc.excluded || []).map((x) => "  - " + x).join("\n"));
      if (sc.note) console.log("Note: " + sc.note);
      return;
    }
    save(data); ok(`Scope updated for ${a1}`);
  },

  "project:add"() {
    const data = load(a1);
    if (!o.name) fail("project:add needs --name");
    const id = slugify(o.id || o.name);
    if (data.projects.some((p) => p.id === id)) fail(`Project id "${id}" exists. Pass --id to choose another.`);
    data.projects.push({ id, name: o.name, status: o.status || "Lopend" });
    save(data); ok(`Added project ${id} to ${a1}`);
  },

  "project:set"() {
    const data = load(a1);
    const p = data.projects.find((x) => x.id === a2);
    if (!p) fail(`No project "${a2}". Known: ${data.projects.map((x) => x.id).join(", ")}`);
    if (o.name) p.name = o.name;
    if (o.status) p.status = o.status;
    save(data); ok(`Updated project ${a2}`);
  },

  log() {
    const data = load(a1);
    if (!o.hours) fail("log needs --hours");
    const before = summarize(data);
    const { project, created } = resolveProject(data, { id: o.project, name: o["project-name"] });
    if (created) ok(`New project "${project.name}" (${project.id})`);
    const e = { id: nextEntryId(data), date: date(o.date), project: project.id, hours: num(o.hours, "hours"), note: o.note || "" };
    if (o.rate) e.rate = num(o.rate, "rate");
    e.fp = fingerprint(e);
    data.entries.push(e);
    save(data);
    ok(`Logged ${e.hours} h on ${e.project} (${e.id}, ${e.date}) = ${eur.format(e.hours * (e.rate ?? data.retainer.rate))}`);
    report(data, before);
  },

  // lines.json: [{ "date": "2027-03-04", "hours": 2, "note": "...", "projectName": "...", "src": "original note line" },
  //              { "date": "...", "kind": "cost", "amount": 120, "note": "...", "src": "..." }]
  import() {
    const data = load(a1);
    if (!o.file) fail("import needs --file");
    const lines = JSON.parse(fs.readFileSync(o.file, "utf8"));
    if (!Array.isArray(lines)) fail("The file must hold a JSON array of lines");
    const before = summarize(data);
    const seen = new Set((data.entries || []).map((e) => e.fp || fingerprint(e)));
    const added = [], skipped = [], made = [];
    for (const l of lines) {
      const fp = fingerprint(l);
      if (seen.has(fp)) { skipped.push(l); continue; }
      seen.add(fp);
      const isCost = l.kind === "cost";
      const { project, created } = isCost && !l.projectName && !l.project ? { project: null, created: false } : resolveProject(data, { id: l.project, name: l.projectName });
      if (created) made.push(project.name);
      const e = { id: nextEntryId(data), date: date(l.date), note: l.note || "", fp };
      if (project) e.project = project.id;
      if (isCost) { e.kind = "cost"; e.amount = num(l.amount, "amount"); } else { e.hours = num(l.hours, "hours"); if (l.rate) e.rate = num(l.rate, "rate"); }
      data.entries.push(e);
      added.push(e);
    }
    for (const e of added) console.log(`  + ${e.date}  ${e.kind === "cost" ? "€" + e.amount : e.hours + " h"}  ${e.project || "kosten"}  ${e.note}`);
    for (const l of skipped) console.log(`  = already logged: ${l.date} ${l.hours ?? "€" + l.amount} ${l.note || ""}`);
    if (made.length) console.log(`  new projects: ${made.join(", ")}`);
    if (o["dry-run"]) { console.log(`Dry run: ${added.length} new, ${skipped.length} already logged. Nothing saved.`); return; }
    if (!added.length) return ok(`Nothing new. ${skipped.length} line(s) were already logged.`);
    save(data);
    ok(`Imported ${added.length} line(s), skipped ${skipped.length}`);
    report(data, before);
  },

  cost() {
    const data = load(a1);
    if (!o.amount || !o.note) fail("cost needs --amount and --note");
    if (o.project && !data.projects.some((p) => p.id === o.project)) fail(`No project "${o.project}". Known: ${data.projects.map((x) => x.id).join(", ")}`);
    const before = summarize(data);
    const e = { id: nextEntryId(data), date: date(o.date), kind: "cost", amount: num(o.amount, "amount"), note: o.note };
    if (o.project) e.project = o.project;
    e.fp = fingerprint(e);
    data.entries.push(e);
    save(data);
    ok(`Logged cost ${eur.format(e.amount)} (${e.id}, ${e.date}): ${e.note}`);
    report(data, before);
  },

  "entry:edit"() {
    const data = load(a1);
    const e = data.entries.find((x) => x.id === a2);
    if (!e) fail(`No entry "${a2}". Run: show ${a1}`);
    const before = summarize(data);
    if (o.hours && e.kind !== "cost") e.hours = num(o.hours, "hours");
    if (o.amount && e.kind === "cost") e.amount = num(o.amount, "amount");
    if (o.note !== undefined) e.note = o.note;
    if (o.date) e.date = date(o.date);
    if (o.project) e.project = o.project;
    if (o.rate) e.rate = num(o.rate, "rate");
    save(data); ok(`Updated ${a2}`); report(data, before);
  },

  "entry:remove"() {
    const data = load(a1);
    const i = data.entries.findIndex((x) => x.id === a2);
    if (i < 0) fail(`No entry "${a2}"`);
    const [e] = data.entries.splice(i, 1);
    save(data); ok(`Removed ${e.id}: ${e.date} ${e.hours} h ${e.project}`); report(data);
  },

  deposit() {
    const data = load(a1);
    if (!o.amount) fail("deposit needs --amount");
    const before = summarize(data);
    const d = { date: date(o.date), amount: num(o.amount, "amount"), label: o.label || "Aanvulling" };
    data.retainer.deposits.push(d);
    save(data);
    ok(`Added ${eur.format(d.amount)} on ${d.date}`);
    report(data, before);
    const after = summarize(data);
    if (before.budget > 0 && after.budget > before.budget) {
      const { next } = pendingAlerts(after, { budget: before.budget, sent: THRESHOLDS.filter((t) => before.pctRemaining <= t) });
      console.log(`  alerts re-armed above ${after.pctRemaining.toFixed(0)}%. Still marked sent: ${next.sent.join(", ") || "none"}`);
    }
  },

  users() {
    const u = loadUsers();
    for (const [c, list] of Object.entries(u.clients || {})) {
      if (a1 && c !== a1) continue;
      console.log(c);
      for (const x of list) console.log(`  ${x.email.padEnd(36)} ${x.name || ""}${x.notify === false ? "  (no alerts)" : ""}`);
      if (!list.length) console.log("  (no logins)");
    }
  },

  "user:add"() {
    load(a1);
    const email = String(o.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("user:add needs a valid --email");
    const u = loadUsers(); u.clients ||= {};
    for (const [c, list] of Object.entries(u.clients)) if (list.some((x) => x.email === email)) fail(`${email} already has a login for ${c}`);
    const user = { email, name: o.name || "", notify: !o["no-notify"] };
    if (o.password) user.password = hashPassword(o.password);
    (u.clients[a1] ||= []).push(user);
    saveUsers(u);
    ok(`${email} logs in to /${a1}/ with a link sent to that address`);
  },

  "user:password"() {
    const email = String(o.email || "").toLowerCase();
    const u = loadUsers();
    const x = Object.values(u.clients || {}).flat().find((y) => y.email === email);
    if (!x) fail(`No login for ${email}`);
    const password = o.password || genPassword();
    x.password = hashPassword(password);
    saveUsers(u);
    ok(`New password set for ${email}`);
    if (!o.password) console.log(`  password: ${password}   (shown once)`);
  },

  "user:notify"() {
    const email = String(o.email || "").toLowerCase();
    const u = loadUsers();
    const x = Object.values(u.clients || {}).flat().find((y) => y.email === email);
    if (!x) fail(`No login for ${email}`);
    if (!o.on && !o.off) fail("Pass --on or --off");
    x.notify = Boolean(o.on);
    saveUsers(u); ok(`${email}: alerts ${x.notify ? "on" : "off"}`);
  },

  "user:remove"() {
    const email = String(o.email || "").toLowerCase();
    const u = loadUsers();
    let found = false;
    for (const c of Object.keys(u.clients || {})) {
      const n = u.clients[c].length;
      u.clients[c] = u.clients[c].filter((x) => x.email !== email);
      if (u.clients[c].length !== n) found = true;
    }
    if (!found) fail(`No login for ${email}`);
    saveUsers(u); ok(`Removed ${email}. An open session ends within 14 days, or at once if SESSION_SECRET is rotated.`);
  },
};

(commands[cmd] || (() => { if (cmd) console.error(`Unknown command "${cmd}"`); console.log(HELP); process.exit(cmd ? 1 : 0); }))();
