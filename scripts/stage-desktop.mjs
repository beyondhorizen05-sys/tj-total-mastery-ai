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

// The compiled API invokes these at runtime; copying only main.js silently
// disables Windows computer control and speech in installed builds.
const runtimeScripts = [
  'computer-bridge.ps1', 'voice-listener.ps1', 'voice-speak.ps1',
  'voice-voices.ps1', 'local-asr.py',
];
for (const name of runtimeScripts) {
  if (!fs.statSync(path.join(root, 'services', 'api', 'scripts', name), { throwIfNoEntry: false })?.isFile())
    throw new Error('Missing required packaged API script: ' + name);
}
const dest = path.join(root, 'apps', 'desktop', 'src-tauri', 'resources');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(process.execPath, path.join(dest, 'node.exe'));
fs.cpSync(api, path.join(dest, 'api'), { recursive: true });
const scriptDest = path.join(dest, 'api', 'scripts');
fs.mkdirSync(scriptDest, { recursive: true });
for (const name of runtimeScripts) {
  fs.copyFileSync(path.join(root, 'services', 'api', 'scripts', name), path.join(scriptDest, name));
}
fs.copyFileSync(path.join(root, 'scripts', 'desktop-api-launcher.cjs'),
  path.join(dest, 'api', 'launcher.cjs'));
console.log('Staged bundled Node runtime, TJ API and required Windows scripts; no API key or user data included.');
