import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'apps/desktop/src-tauri/resources');
const api = path.join(root, 'services/api/dist');
if (!fs.existsSync(path.join(api, 'main.js'))) throw new Error('Build TJ first; services/api/dist/main.js is missing.');
fs.rmSync(runtime, { recursive: true, force: true });
fs.mkdirSync(path.join(runtime, 'services/api'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
fs.cpSync(api, path.join(runtime, 'services/api/dist'), { recursive: true });
const scripts = path.join(root, 'services/api/scripts');
if (fs.existsSync(scripts)) {
  fs.cpSync(scripts, path.join(runtime, 'services/api/scripts'), { recursive: true });
}
console.log(`Prepared TJ desktop runtime with ${process.version} and bundled API assets.`);
