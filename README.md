# Studio Yukon retainer portal

Each retainer client logs in with their own email address (a one-time link, no password) and lands on their own dashboard: remaining budget, spend through the retainer year, a forecast of when it runs out, and every logged hour per project. Contacts get an email when 50%, 20% and 10% of the budget is left. Claude keeps the data up to date when you ask it.

Runs on the Netlify free plan. Squarespace cannot do this: its Member Areas give every member the same pages, so there is no way to show each client only their own numbers.

## What is where

```
public/login.html           login page (one for everyone, routes by email)
public/dashboard.html       dashboard template, themed per client
public/data/<client>.json   budget, projects and hours per client
public/assets/retainer.js   the budget maths, shared by everything
public/assets/clients/      client logos + public brand file for the branded login
config/users.json           client logins (email, name, alerts on/off)
netlify/edge-functions/     the gate: who may see which page
netlify/functions/          login links, your /admin overview, hourly alerts
scripts/portal.mjs          the command line Claude uses to change data
CLAUDE.md                   the rules Claude follows in this repo
```

## Setup, once (about 30 minutes)

### 1. GitHub
Create a **private** repo, for example `studioyukon/yukon-portal`, and push this folder to it.

### 2. Netlify
Create a separate free team called Studio Yukon first (team switcher, top left). It gets its own 300 credits a month, so thefront.agency and the portal never pause each other. Each update (deploy) costs 15 credits; a weekly update uses about 60 to 75.

Add new site, Import an existing project, pick the repo. Build settings come from `netlify.toml`. Then under Site configuration, Environment variables:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | a long random string: `openssl rand -hex 32` |
| `PORTAL_ADMINS` | your own email address. You log in with a link like everyone else. Want a password as backup? Use `node scripts/hash-password.mjs you@studioyukon.com 'password'` and paste the output instead. Several admins: separate with commas |
| `PORTAL_URL` | the address clients use, e.g. `https://portal.studioyukon.com` |
| `RESEND_API_KEY` | from resend.com (see step 3) |
| `MAIL_FROM` | `Studio Yukon <portal@studioyukon.com>` (login links and alerts) |
| `MAIL_REPLY_TO` | your own email, so replies about topping up reach you |
| `ALERT_BCC` | your own email, so you see every alert that goes out |
| `MAIL_DRY_RUN` | `1` while testing: nothing is sent, login links appear in the Netlify function log. Remove it to go live |

Redeploy after changing variables.

### 3. Email sending (Resend)
Login links depend on this, so nobody can log in until it works (except an admin with a backup password).
Create a Resend account, add the domain `studioyukon.com` and add the DNS records it shows in Squarespace (Settings, Domains, DNS). Once verified, create an API key and put it in `RESEND_API_KEY`.

### 4. Your own address
In Netlify, Domain management, add `portal.studioyukon.com`. Add the CNAME record it gives you in Squarespace DNS.

### 5. Let Claude make changes
Connect GitHub in claude.ai settings so Claude can push to the repo. Gmail is already connected for reading your mail. Save the "yukon-retainer-portal" skill from the chat where this was built.

## House font

The portal uses Proxima Nova when your Adobe Fonts kit is connected, and Figtree until then. Follow the three steps in `public/assets/fonts.css`.

## Before Vandebron goes live

```
node scripts/portal.mjs client:set vandebron --start 2026-11-01 --end 2027-10-31 --rate 110
node scripts/portal.mjs client:live vandebron --reset
node scripts/portal.mjs deposit vandebron --amount <startbedrag> --date <datum> --label Startbedrag
node scripts/portal.mjs user:add vandebron --email <aafke's address> --name "Aafke Eppinga"
node scripts/portal.mjs scope vandebron   # check the scope text against the signed agreement
```

Or ask Claude: "Zet Vandebron live met startbedrag 5000 per 1 november en geef Aafke en Jasmijn toegang."

## How logging in works

1. Someone opens `portal.studioyukon.com` or their own address, such as `/vandebron/`. Opened via their own address, the login page shows their logo and colours.
2. They enter their email. If the address is known, a link goes to it. If not, nothing is sent and the page says the same thing, so nobody can find out who your clients are.
3. The link opens a page with an "Inloggen" button. Only pressing it logs them in, so mail scanners that open links cannot use it up. A link works once, for 15 minutes.
4. They stay logged in for 14 days on that device. At most 5 links per address per 15 minutes.

The branded login uses a small public file per client (`public/assets/clients/<slug>.json`, logo and colours only). Anyone who guesses the address can see that this client has a portal with you. If a client should stay confidential: `node scripts/portal.mjs client:set <slug> --branded-login off`.

## How alerts work

Every hour the alert function reads each client's data, works out the remaining percentage with the same maths as the dashboard, and emails every contact with notifications on when a line (50%, 20%, 10%) has been passed. Each line goes out once. When a client tops up, the lines they are back above are re-armed. Example clients never get mail. You can preview the email at `/admin?preview=vandebron&t=20`.

## Security notes

- Passwords are stored as scrypt hashes, never in plain text. Keep the repo private anyway.
- A session lasts 14 days. Removing a login stops new sign-ins at once. To end every open session immediately, change `SESSION_SECRET`.
- Client logos and the login page are public. Data files are only served to the right client, or to you.
