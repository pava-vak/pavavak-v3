#!/usr/bin/env node
// Resets a user's password from the server console. The password is typed interactively (never echoed,
// never passed as an argument), hashed with the app's own Argon2id settings, and every device is signed out.
// Usage (in /var/www/pava-vak/b3):  node scripts/reset-password.js <username>
require('dotenv').config();
const readline = require('readline');
const { hashPassword } = require('../src/shared/security/password.service');
const identity = require('../src/db/identityAdapter');
const { getPool, closePool } = require('../src/db/pool');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = (s) => { if (!rl.stdoutMuted) rl.output.write(s); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.stdoutMuted = true;
  });
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node scripts/reset-password.js <username>');
    process.exit(2);
  }
  if (!process.stdin.isTTY) {
    console.error('Run this in an interactive terminal (ssh -t) so the password can be typed privately.');
    process.exit(2);
  }

  const user = await identity.findByUsername(username);
  if (!user) {
    console.error(`No user named "${username}".`);
    process.exit(1);
  }
  console.log(`Resetting the password for ${user.username} (${user.displayName}${user.isAdmin ? ', admin' : ''}).`);

  const first = await askHidden('New password (8-128 characters, hidden): ');
  if (first.length < 8 || first.length > 128) {
    console.error('Password must be 8-128 characters. Nothing was changed.');
    process.exit(1);
  }
  const second = await askHidden('Type it again: ');
  if (first !== second) {
    console.error('The two passwords did not match. Nothing was changed.');
    process.exit(1);
  }

  // setPasswordHash also bumps token_version, which invalidates every existing login
  await identity.setPasswordHash(user.userId, await hashPassword(first));
  const { rowCount } = await getPool().query('delete from user_sessions where user_id = $1', [user.userId]);
  console.log(`Password updated. Signed out of all devices (${rowCount} linked device entr${rowCount === 1 ? 'y' : 'ies'} cleared).`);
}

main()
  .catch((err) => {
    console.error('Reset failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
