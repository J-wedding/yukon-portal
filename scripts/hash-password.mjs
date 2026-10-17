// Usage: node scripts/hash-password.mjs you@studioyukon.com 'your-password'
// Prints the entry for the PORTAL_ADMINS environment variable on Netlify.
// Client logins are managed with: node scripts/portal.mjs user:add ...
import { hashPassword } from "../lib/server.mjs";
const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error("Usage: node scripts/hash-password.mjs <email> <password>"); process.exit(1); }
console.log(`${email.trim().toLowerCase()}=${hashPassword(password)}`);
