// Create the shop owner, or change any account's password, straight in the database. Needs DATABASE_URL (in .env or the shell).
//   npm run user:password -- someone@mail.com "a new password"
//   npm run user:admin -- owner@mail.com "Owner Name" "a strong password"
// Handy after you load db/supabase_schema_only.sql, or to replace the demo admin password on a live shop.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const [cmd, ...args] = process.argv.slice(2);
const fail = (m) => { console.error(m); process.exitCode = 1; };

try {
  if (cmd === 'password') {
    const [email, password] = args;
    if (!email || !password) fail('Usage: npm run user:password -- email "new password"');
    else if (password.length < 8 || password.length > 72) fail('The password must be 8 to 72 characters.');
    else {
      const hash = await bcrypt.hash(password, 10);
      const r = await pool.query('UPDATE users SET password_hash = $2 WHERE lower(email) = lower($1)', [email, hash]);
      if (!r.rowCount) fail(`No account with the email ${email}`);
      else {
        await pool.query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))', [email]);   // log them out everywhere
        console.log(`Password changed for ${email}. They were logged out on every device.`);
      }
    }
  } else if (cmd === 'admin') {
    const [email, name, password] = args;
    if (!email || !name || !password) fail('Usage: npm run user:admin -- email "Full Name" "password"');
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('That does not look like an email address.');
    else if (password.length < 8 || password.length > 72) fail('The password must be 8 to 72 characters.');
    else {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, lower($2), $3, 'admin')
         ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash`, [name, email, hash]);
      console.log(`${email} is now a shop admin.`);
    }
  } else {
    fail('Commands: password, admin   (see the comment at the top of db/user-tool.js)');
  }
} finally {
  await pool.end();
}
