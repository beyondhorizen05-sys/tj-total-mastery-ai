import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from '../types.js';
import { fail, ok } from '../types.js';
import type { SettingsRepo } from '../../db/repo.js';
import { REPO_ROOT } from '../../config.js';
import type { ModelRouter } from '../../models/router.js';

const SCRIPT = path.join(REPO_ROOT, 'services', 'api', 'scripts', 'computer-bridge.ps1');
export const computerAvailable = () => process.platform === 'win32' && fs.existsSync(SCRIPT);

export function writeVerificationGap(before: Record<string, any>, after: Record<string, any>, text: string): string | null {
  if (before.foreground_handle == null || after.foreground_handle == null) return 'The focused window could not be identified before and after typing.';
  if (String(before.foreground_handle) !== String(after.foreground_handle)) return 'The focused window changed while typing.';
  const snippet = text.slice(0, 80);
  if (!snippet) return 'No text was provided.';
  const prior = (before.elements as string[] | undefined) ?? [];
  const current = (after.elements as string[] | undefined) ?? [];
  if (prior.some((line) => line.includes(snippet))) return 'The text was already visible before typing, so the new write cannot be verified.';
  if (!current.some((line) => line.includes(snippet))) return 'The typed text was not found in accessible controls.';
  return null;
}

export async function runComputerBridge(request: Record<string, unknown>): Promise<Record<string, any>> {
  if (!computerAvailable()) return { ok: false, error: 'Local Windows computer bridge is unavailable.' };
  return await new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-File', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = ''; let settled = false;
    const finish = (value: Record<string, any>) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, error: 'Computer bridge timed out.' }); }, 15_000);
    child.stdout.on('data', (chunk) => { if (output.length < 200_000) output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { if (error.length < 2000) error += chunk.toString(); });
    child.on('error', (reason) => { clearTimeout(timer); finish({ ok: false, error: reason.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try { finish(JSON.parse(output.trim())); }
      catch { finish({ ok: false, error: error.trim() || `Computer bridge exited ${code}.` }); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export function computerTools(settings: SettingsRepo, artifactsDir: string, router: ModelRouter): Tool[] {
  const execute = async (action: string, args: Record<string, any>) => {
    if (settings.get<boolean>('computer_control_enabled', false) !== true) return fail('Computer control is disabled. Enable it in first-run setup.');
    const result = await runComputerBridge({ action, ...args });
    return result.ok ? ok(JSON.stringify(result), { data: result }) : fail(String(result.error ?? 'Computer action failed'));
  };
  return [
    {
      id: 'computer_observe', name: 'Observe focused Windows app', domain: 'computer',
      description: 'Read the focused Windows app title and accessibility controls with screen coordinates. Use this before clicking.',
      input_schema: { type: 'object', properties: {} }, permission: 'system.info', risk: 'low', reversible: true,
      execute: () => execute('observe', {}),
    },
    {
      id: 'computer_click', name: 'Click Windows desktop', domain: 'computer',
      description: 'Click desktop coordinates from computer_observe. Coordinates must be inside the current virtual screen.',
      input_schema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, button: { enum: ['left', 'right'] } }, required: ['x', 'y'] },
      permission: 'computer.control', risk: 'medium', reversible: false,
      describe: (a) => ({ action: 'Click desktop', target: `${a.x}, ${a.y}`, why: 'Voice computer command', risks: ['Could activate a control in the focused app'] }),
      execute: (a) => execute('click', { x: a.x, y: a.y, button: a.button ?? 'left' }),
    },
    {
      id: 'computer_type', name: 'Type into Windows app', domain: 'computer',
      description: 'Low-level typing into the focused control. Use computer_write when the result must be verified; never type passwords or secrets from memory.',
      input_schema: { type: 'object', properties: { text: { type: 'string', maxLength: 4000 } }, required: ['text'] },
      permission: 'computer.control', risk: 'medium', reversible: false,
      describe: (a) => ({ action: 'Type into focused app', target: `${String(a.text).length} characters in focused app`, why: 'Voice computer command', risks: ['Could enter text in the wrong focused app'] }),
      execute: (a) => execute('type', { text: a.text }),
    },
    {
      id: 'computer_write', name: 'Write and inspect Windows app', domain: 'computer',
      description: 'Type text into the focused control, then re-read the focused app to check what visibly changed. Reports whether the new text was found in accessible controls.',
      input_schema: { type: 'object', properties: { text: { type: 'string', maxLength: 4000 } }, required: ['text'] },
      permission: 'computer.control', risk: 'medium', reversible: false,
      describe: (a) => ({ action: 'Write into focused app', target: `${String(a.text).length} characters in focused app`, why: 'Voice computer task', risks: ['Could write into the wrong focused app'] }),
      execute: async (a) => {
        const before = await execute('observe', {});
        if (!before.ok) return before;
        if (!before.data?.foreground || before.data?.foreground_handle == null) return fail('No focused Windows app could be identified. Focus the intended app before writing.');
        const typed = await execute('type', { text: a.text, expected_handle: before.data.foreground_handle });
        if (!typed.ok) return typed;
        const observed = await execute('observe', {});
        if (!observed.ok) return fail('Text was sent, but the app could not be inspected afterward. Do not repeat the write automatically.', { data: { typed: true, visible_text_verified: false } });
        const elements = (observed.data?.elements as string[] | undefined) ?? [];
        const gap = writeVerificationGap(before.data ?? {}, observed.data ?? {}, String(a.text));
        if (gap) return fail(`Text was sent to ${String(observed.data?.foreground ?? 'the focused app')}, but its visible content could not be verified: ${gap} Inspect the screen before continuing; do not type it again automatically.`, { data: { typed: true, visible_text_verified: false, foreground: observed.data?.foreground, elements } });
        return ok(`Typed ${String(a.text).length} characters and verified the text is visible in ${String(observed.data?.foreground)}.`, { data: { typed: true, visible_text_verified: true, foreground: observed.data?.foreground, elements } });
      },
    },
    {
      id: 'computer_key', name: 'Press Windows key', domain: 'computer',
      description: 'Press a supported key: enter, tab, escape, backspace, delete, arrows, home, end, pageup, pagedown, space, ctrl_c, ctrl_v, ctrl_a, ctrl_s, alt_tab.',
      input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      permission: 'computer.control', risk: 'medium', reversible: false,
      describe: (a) => ({ action: 'Press key', target: String(a.key), why: 'Voice computer command', risks: ['Could trigger a shortcut in the focused app'] }),
      execute: (a) => execute('key', { key: a.key }),
    },
    {
      id: 'computer_scroll', name: 'Scroll Windows app', domain: 'computer',
      description: 'Scroll at the current pointer position. Positive ticks scroll up, negative ticks scroll down.',
      input_schema: { type: 'object', properties: { ticks: { type: 'integer', minimum: -10, maximum: 10 } }, required: ['ticks'] },
      permission: 'computer.control', risk: 'medium', reversible: false,
      describe: (a) => ({ action: 'Scroll desktop', target: `${a.ticks} ticks`, why: 'Voice computer command', risks: ['May scroll an unintended window'] }),
      execute: (a) => execute('scroll', { ticks: a.ticks }),
    },
    {
      id: 'computer_screenshot', name: 'Capture Windows desktop', domain: 'computer',
      description: 'Save a current desktop PNG into TJ artifacts. This can contain private screen data; use only when needed.',
      input_schema: { type: 'object', properties: {} }, permission: 'screen.capture', risk: 'medium', reversible: false,
      describe: () => ({ action: 'Capture screen', target: 'Windows desktop', why: 'Voice computer command', risks: ['Screen may contain private information'] }),
      execute: async () => {
        const filename = `desktop-${randomUUID()}.png`;
        const result = await execute('screenshot', { path: path.join(artifactsDir, filename) });
        if (result.ok) result.artifacts = [{ kind: 'image', name: filename, path: path.join(artifactsDir, filename), mime: 'image/png', summary: 'Desktop screenshot' }];
        return result;
      },
    },
    {
      id: 'computer_read_screen', name: 'Read visible Windows screen', domain: 'computer',
      description: 'Capture the current desktop and ask a configured vision-capable model to transcribe visible text and identify UI controls with approximate coordinates. The screenshot is sent to that model provider; respect privacy mode and approval.',
      input_schema: { type: 'object', properties: { question: { type: 'string' } } }, permission: 'screen.capture', risk: 'medium', reversible: false,
      describe: () => ({ action: 'Read screen with vision model', target: 'Windows desktop', why: 'Study the visible task before acting', risks: ['Screen contents are sent to the selected model provider', 'May include private information'] }),
      execute: async (a, ctx) => {
        if (settings.get<boolean>('computer_control_enabled', false) !== true) return fail('Computer control is disabled.');
        const filename = path.join(artifactsDir, `screen-read-${randomUUID()}.png`);
        try {
          const capture = await runComputerBridge({ action: 'screenshot', path: filename });
          if (!capture.ok) return fail(String(capture.error ?? 'Screen capture failed'));
          const image = fs.readFileSync(filename);
          const result = await router.chat({ task_type: 'vision', complexity: 'medium', needs_vision: true, prefer: 'cheapest', max_cost_class: 'free' }, {
            messages: [
              { role: 'system', content: 'Read the visible Windows screen. Transcribe relevant text accurately, identify controls and approximate pixel coordinates. Do not infer hidden content. Mark uncertain observations. Never say an action was performed.' },
              { role: 'user', content: [{ type: 'text', text: String(a.question ?? 'Describe the screen and the controls relevant to the current task.') }, { type: 'image', image_url: `data:image/png;base64,${image.toString('base64')}` }] },
            ], max_tokens: 1300,
          }, { project_id: ctx.project_id, agent_id: ctx.agent_id });
          return ok(result.text, { data: { model_id: result.model_id, bytes: image.length } });
        } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
        finally { try { fs.unlinkSync(filename); } catch { /* already removed */ } }
      },
    },
    {
      id: 'computer_open', name: 'Open Windows app', domain: 'computer',
      description: 'Open a common visible Windows app: notepad, calculator, files, browser, settings.',
      input_schema: { type: 'object', properties: { application: { enum: ['notepad', 'calculator', 'files', 'browser', 'settings'] } }, required: ['application'] },
      permission: 'computer.control', risk: 'medium', reversible: false,
      describe: (a) => ({ action: 'Open Windows app', target: String(a.application), why: 'Voice computer command', risks: ['Opens a desktop application'] }),
      execute: (a) => execute('launch', { application: a.application }),
    },
  ];
}
