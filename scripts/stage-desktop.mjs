import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') {
  throw new Error('Self-contained TJ Windows bundles must be staged on Windows using Node 22.');
}
const nodeVersion = Number(process.versions.node.split('.')[0]);
if (nodeVersion < 22) throw new Error('TJ requires Node 22 or later for its built-in SQLite API.');

const api = path.join(root, 'services', 'api', 'dist');
const main = path.join(api, 'main.js');
const ui = path.join(root, 'apps', 'web', 'dist', 'index.html');
if (!fs.existsSync(main) || !fs.existsSync(ui)) {
  throw new Error('Build the API and web frontend before staging the Windows desktop package.');
}

const dest = path.join(root, 'apps', 'desktop', 'src-tauri', 'resources');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(process.execPath, path.join(dest, 'node.exe'));
fs.cpSync(api, path.join(dest, 'api'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'desktop-api-launcher.cjs'),
  path.join(dest, 'api', 'launcher.cjs'));
console.log('Staged bundled Node runtime and TJ API for Windows; no API key or user data included.');
