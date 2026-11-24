'use strict';
// Usage:  npm run create-admin
// Creates (or resets the password of) an admin user. Passwords are never stored in plain text.
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const store = require('../lib/store');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

// Hide typed characters for the password prompt.
function askHidden(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    let buf = '';
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode && stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (c === '\u0003') process.exit(1);
        if (c === '\u007f') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const username = (await ask('Admin username: ')).trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) { console.error('Use 3-32 letters, digits, . _ -'); process.exit(1); }
  rl.close();
  const pw = await askHidden('Password (min 12 chars): ');
  const pw2 = await askHidden('Repeat password: ');
  if (pw.length < 4) { console.error('Password must be at least 4 characters.'); process.exit(1); }
  if (pw !== pw2) { console.error('Passwords do not match.'); process.exit(1); }

  const users = store.getUsers();
  const existing = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  const hash = await bcrypt.hash(pw, 12);
  if (existing) { existing.hash = hash; console.log(`Password updated for "${existing.username}".`); }
  else { users.push({ username, hash, role: 'admin', createdAt: new Date().toISOString() }); console.log(`Admin "${username}" created.`); }
  store.saveUsers(users);
  process.exit(0);
})();
