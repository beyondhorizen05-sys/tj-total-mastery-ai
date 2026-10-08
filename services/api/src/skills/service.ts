import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Audit } from '../security/audit.js';

export interface TextSkillManifest {
  id: string;
  version: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, { type: 'string'; maxLength?: number }>; required: string[]; additionalProperties: false };
  output_schema: { type: 'object'; properties: { text: { type: 'string' } }; required: ['text']; additionalProperties: false };
  permissions: string[];
  execution: { method: 'text_template'; template: string };
  dependencies: string[];
  network_access: false;
  file_access: false;
  os_privileges: false;
  secrets_required: string[];
}

interface InstalledSkill {
  manifest: TextSkillManifest;
  digest: string;
  enabled: boolean;
  reviewed_at: string | null;
  installed_at: string;
  updated_at: string;
}

interface SkillRun {
  id: string;
  skill_id: string;
  version: string;
  status: 'completed' | 'failed';
  duration_ms: number;
  timestamp: string;
  error?: string;
}

interface SkillStore { installed: Record<string, InstalledSkill>; runs: SkillRun[] }

export class SkillError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_OUTPUT_CHARS = 16_384;
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^\d+\.\d+\.\d+$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSkillManifest(value: unknown): TextSkillManifest {
  if (!record(value)) throw new SkillError('Skill manifest must be an object');
  const m = value;
  if (typeof m.id !== 'string' || m.id.length > 80 || !idPattern.test(m.id)) throw new SkillError('Invalid skill id');
  if (typeof m.version !== 'string' || !versionPattern.test(m.version)) throw new SkillError('Skill version must use major.minor.patch');
  if (typeof m.description !== 'string' || !m.description.trim() || m.description.length > 500) throw new SkillError('Skill description is required (max 500 characters)');
  if (!Array.isArray(m.permissions) || m.permissions.length !== 0) throw new SkillError('This text skill runtime only supports an empty permissions list');
  if (!Array.isArray(m.dependencies) || m.dependencies.length !== 0) throw new SkillError('External skill dependencies are not supported');
  if (!Array.isArray(m.secrets_required) || m.secrets_required.length !== 0) throw new SkillError('Secrets are not supported by text skills');
  if (m.network_access !== false || m.file_access !== false || m.os_privileges !== false) throw new SkillError('Text skills cannot request network, file, or OS access');
  if (!record(m.execution) || m.execution.method !== 'text_template' || typeof m.execution.template !== 'string' || m.execution.template.length > 8192) throw new SkillError('Execution must be a text_template of at most 8192 characters');
  if (!record(m.input_schema) || m.input_schema.type !== 'object' || m.input_schema.additionalProperties !== false || !record(m.input_schema.properties) || !Array.isArray(m.input_schema.required)) throw new SkillError('Invalid input schema');
  const properties = m.input_schema.properties;
  if (Object.keys(properties).length > 30) throw new SkillError('Too many skill inputs');
  for (const [key, spec] of Object.entries(properties)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || !record(spec) || spec.type !== 'string' || (spec.maxLength !== undefined && (!Number.isInteger(spec.maxLength) || Number(spec.maxLength) < 1 || Number(spec.maxLength) > 4096))) throw new SkillError(`Invalid input field ${key}`);
  }
  if (m.input_schema.required.some((key: unknown) => typeof key !== 'string' || !Object.hasOwn(properties, key))) throw new SkillError('Required input does not exist in properties');
  if (!record(m.output_schema) || m.output_schema.type !== 'object' || m.output_schema.additionalProperties !== false || !record(m.output_schema.properties) || !record(m.output_schema.properties.text) || m.output_schema.properties.text.type !== 'string' || !Array.isArray(m.output_schema.required) || m.output_schema.required.length !== 1 || m.output_schema.required[0] !== 'text') throw new SkillError('Output schema must declare a required text string');
  const placeholders = [...m.execution.template.matchAll(/{{\s*([a-z][a-z0-9_]*)\s*}}/g)].map((match) => match[1]);
  if (m.execution.template.replace(/{{\s*[a-z][a-z0-9_]*\s*}}/g, '').includes('{{') || m.execution.template.replace(/{{\s*[a-z][a-z0-9_]*\s*}}/g, '').includes('}}')) throw new SkillError('Invalid template placeholder');
  if (placeholders.some((key) => !Object.hasOwn(properties, key))) throw new SkillError('Template references an undeclared input');
  if (Buffer.byteLength(JSON.stringify(m), 'utf8') > MAX_MANIFEST_BYTES) throw new SkillError('Manifest exceeds 64 KB');
  return m as unknown as TextSkillManifest;
}

function digest(manifest: TextSkillManifest) { return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'); }

/** Local, declarative skill lifecycle. No skill code, shell, network, or filesystem execution. */
export class SkillService {
  private readonly root: string;
  private readonly storePath: string;
  private store: SkillStore;

  constructor(dataDir: string, private audit: Audit) {
    this.root = path.join(dataDir, 'skills');
    this.storePath = path.join(this.root, 'installed.json');
    fs.mkdirSync(path.join(this.root, 'catalog'), { recursive: true });
    this.store = this.load();
  }

  private load(): SkillStore {
    if (!fs.existsSync(this.storePath)) return { installed: {}, runs: [] };
    const value = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as SkillStore;
    if (!record(value) || !record(value.installed) || !Array.isArray(value.runs)) throw new SkillError('Skill store is invalid', 500);
    return value;
  }

  private save() {
    const tmp = `${this.storePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, this.storePath);
  }

  catalogPath() { return path.join(this.root, 'catalog'); }

  discover() {
    const result: Array<{ filename: string; manifest?: TextSkillManifest; error?: string }> = [];
    for (const name of fs.readdirSync(this.catalogPath()).filter((n) => n.endsWith('.json'))) {
      const full = path.join(this.catalogPath(), name);
      try {
        const stat = fs.lstatSync(full);
        if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new SkillError('Catalog entry must be a regular JSON file under 64 KB');
        const manifest = validateSkillManifest(JSON.parse(fs.readFileSync(full, 'utf8')));
        result.push({ filename: name, manifest });
      } catch (error) { result.push({ filename: name, error: (error as Error).message }); }
    }
    return result;
  }

  list() { return Object.values(this.store.installed).map((item) => structuredClone(item)); }
  get(id: string) { const item = Object.hasOwn(this.store.installed, id) ? this.store.installed[id] : undefined; return item ? structuredClone(item) : undefined; }
  runs(id?: string) { return this.store.runs.filter((run) => !id || run.skill_id === id).map((run) => ({ ...run })); }

  install(raw: unknown) {
    const manifest = validateSkillManifest(raw);
    const prior = Object.hasOwn(this.store.installed, manifest.id) ? this.store.installed[manifest.id] : undefined;
    if (prior?.manifest.version === manifest.version) throw new SkillError('This skill version is already installed', 409);
    const now = new Date().toISOString();
    const item: InstalledSkill = { manifest: structuredClone(manifest), digest: digest(manifest), enabled: false, reviewed_at: null, installed_at: prior?.installed_at ?? now, updated_at: now };
    this.store.installed[manifest.id] = item;
    this.save();
    this.audit.log({ actor: 'user:api', action: prior ? 'skill.update' : 'skill.install', resource: manifest.id, decision: 'staged', details: { version: manifest.version } });
    return structuredClone(item);
  }

  installFromCatalog(filename: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(filename)) throw new SkillError('Invalid catalog filename');
    const full = path.join(this.catalogPath(), filename);
    if (!fs.existsSync(full)) throw new SkillError('Catalog skill not found', 404);
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new SkillError('Invalid catalog file');
    return this.install(JSON.parse(fs.readFileSync(full, 'utf8')));
  }

  setEnabled(id: string, enabled: boolean, reviewed: boolean) {
    const item = Object.hasOwn(this.store.installed, id) ? this.store.installed[id] : undefined;
    if (!item) throw new SkillError('Skill not found', 404);
    if (enabled && !reviewed) throw new SkillError('Explicit permission review is required before enabling', 400);
    if (digest(item.manifest) !== item.digest) throw new SkillError('Installed skill manifest changed; reinstall it', 409);
    item.enabled = enabled;
    item.reviewed_at = enabled ? new Date().toISOString() : item.reviewed_at;
    item.updated_at = new Date().toISOString();
    this.save();
    this.audit.log({ actor: 'user:api', action: enabled ? 'skill.enable' : 'skill.disable', resource: id, decision: enabled ? 'enabled' : 'disabled', details: { version: item.manifest.version } });
    return structuredClone(item);
  }

  run(id: string, rawInput: unknown) {
    const item = Object.hasOwn(this.store.installed, id) ? this.store.installed[id] : undefined;
    if (!item) throw new SkillError('Skill not found', 404);
    if (!item.enabled) throw new SkillError('Skill is disabled', 403);
    if (digest(item.manifest) !== item.digest) throw new SkillError('Installed skill manifest changed; reinstall it', 409);
    const started = performance.now();
    const runId = crypto.randomUUID();
    try {
      if (!record(rawInput)) throw new SkillError('Skill input must be an object');
      const schema = item.manifest.input_schema;
      for (const required of schema.required) if (!Object.hasOwn(rawInput, required)) throw new SkillError(`Missing input: ${required}`);
      for (const [key, value] of Object.entries(rawInput)) {
        const spec = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
        if (!spec) throw new SkillError(`Unknown input: ${key}`);
        if (typeof value !== 'string' || value.length > (spec.maxLength ?? 4096)) throw new SkillError(`Invalid string input: ${key}`);
      }
      const output = item.manifest.execution.template.replace(/{{\s*([a-z][a-z0-9_]*)\s*}}/g, (_match, key: string) => String(rawInput[key] ?? ''));
      if (output.length > MAX_OUTPUT_CHARS) throw new SkillError('Skill output exceeds 16384 characters');
      const run: SkillRun = { id: runId, skill_id: id, version: item.manifest.version, status: 'completed', duration_ms: Math.round(performance.now() - started), timestamp: new Date().toISOString() };
      this.store.runs.unshift(run);
      this.store.runs = this.store.runs.slice(0, 500);
      this.save();
      this.audit.log({ actor: 'user:api', action: 'skill.run', resource: id, decision: 'completed', details: { run_id: runId, version: item.manifest.version } });
      return { run, output: { text: output } };
    } catch (error) {
      const run: SkillRun = { id: runId, skill_id: id, version: item.manifest.version, status: 'failed', duration_ms: Math.round(performance.now() - started), timestamp: new Date().toISOString(), error: (error as Error).message };
      this.store.runs.unshift(run);
      this.store.runs = this.store.runs.slice(0, 500);
      this.save();
      this.audit.log({ actor: 'user:api', action: 'skill.run', resource: id, decision: 'failed', details: { run_id: runId, error: run.error } });
      throw error;
    }
  }
}
