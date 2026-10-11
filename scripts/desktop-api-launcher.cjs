'use strict';
// Runs only inside the installed TJ desktop bundle. Never prints the token.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = process.env.TJ_DESKTOP_TOKEN_FILE;
if (!file) throw new Error('Missing desktop token file location');
fs.mkdirSync(path.dirname(file), { recursive: true });
const token = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
process.env.TJ_DESKTOP_TOKEN = token;
import('./main.js').catch((error) => {
  console.error('TJ desktop backend launch failed:', error?.message ?? 'unknown error');
  process.exitCode = 1;
});
