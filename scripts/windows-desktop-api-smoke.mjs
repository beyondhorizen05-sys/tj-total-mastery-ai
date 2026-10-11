// Windows-only package smoke: actual bundled node.exe + bundled API + token gate.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') throw new Error('This acceptance test must run on a Windows host');
const runtime = path.join(root, 'apps', 'desktop', 'src-tauri', 'resources');
const node = path.join(runtime, 'node.exe');
const launcher = path.join(runtime, 'api', 'launcher.cjs');
if (!fs.existsSync(node) || !fs.existsSync(launcher)) throw new Error('Bundled API and Node runtime were not staged');
for (const name of ['computer-bridge.ps1', 'voice-listener.ps1', 'voice-speak.ps1', 'voice-voices.ps1', 'local-asr.py']) {
  if (!fs.statSync(path.join(runtime, 'api', 'scripts', name), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Packaged Windows capability is missing its runtime script: ' + name);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-packaged-smoke-'));
const tokenFile = path.join(dir, 'tj-session.token');
const socket = net.createServer();
await new Promise((resolve, reject) => {
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', resolve);
});
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
let stderr = '';
const child = spawn(node, [launcher], {
  cwd: path.join(runtime, 'api'),
  env: { ...process.env, TJ_HOST: '127.0.0.1', TJ_PORT: String(port),
    TJ_DATA_DIR: path.join(dir, 'data'), TJ_DESKTOP_TOKEN_FILE: tokenFile },
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr?.on('data', (chunk) => { stderr += String(chunk).slice(0, 1000); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Packaged backend exited: ' + stderr.slice(-1500));
    if (fs.existsSync(tokenFile)) {
      const token = fs.readFileSync(tokenFile, 'utf8');
      if (/^[a-f0-9]{64}$/.test(token)) {
        try {
          const good = await fetch('http://127.0.0.1:' + port + '/api/v1/system/status', {
            headers: { 'X-TJ-Desktop-Token': token }, signal: AbortSignal.timeout(900) });
          if (good.status === 200) {
            const unauthorized = await fetch('http://127.0.0.1:' + port + '/api/v1/system/status');
            if (unauthorized.status !== 401) throw new Error('Local API allowed an unauthenticated request');
            const invalid = await fetch('http://127.0.0.1:' + port + '/api/v1/system/status', {
              headers: { 'X-TJ-Desktop-Token': '0'.repeat(64) } });
            if (invalid.status !== 401) throw new Error('Local API accepted the wrong desktop token');
            // The desktop UI depends on a token-authenticated event stream, not just REST.
            const eventsUrl = 'http://127.0.0.1:' + port + '/api/v1/system/events';
            const deniedEvents = await fetch(eventsUrl, { signal: AbortSignal.timeout(3000) });
            if (deniedEvents.status !== 401) {
              await deniedEvents.body?.cancel();
              throw new Error('Local event stream allowed an unauthenticated request');
            }
            const eventController = new AbortController();
            try {
              const authorizedEvents = await fetch(eventsUrl, {
                headers: { 'X-TJ-Desktop-Token': token },
                signal: AbortSignal.any([eventController.signal, AbortSignal.timeout(3000)]),
              });
              if (authorizedEvents.status !== 200 || !authorizedEvents.headers.get('content-type')?.includes('text/event-stream')) {
                throw new Error('Authenticated desktop event stream did not return SSE');
              }
            } finally {
              eventController.abort();
            }
            ready = true;
            break;
          }
        } catch (error) {
          if (!String(error).includes('fetch failed') && !String(error).includes('TimeoutError')) throw error;
        }
      }
    }
    await sleep(250);
  }
  if (!ready) throw new Error('Bundled local API failed to become ready. ' + stderr.slice(-1500));
  console.log('PASS: bundled Node API started, authenticated, and denied unauthenticated requests');
} finally {
  child.kill();
  await sleep(350);
  fs.rmSync(dir, { recursive: true, force: true });
}
