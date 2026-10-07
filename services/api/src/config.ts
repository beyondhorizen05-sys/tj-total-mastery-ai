import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config.ts -> repo root is ../../.. ; dist/main.js -> ../../..  (both are 3 levels under root)
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env) && v !== '') process.env[k] = v;
  }
}
loadDotEnv(path.join(REPO_ROOT, '.env'));

export interface TJConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  vaultPath: string;
  artifactsDir: string;
  projectsDir: string;
  backupsDir: string;
  logsDir: string;
  allowedOrigins: string[];
  enableTestProvider: boolean;
  version: string;
}

export function loadConfig(overrides: Partial<TJConfig> = {}): TJConfig {
  const dataDir = overrides.dataDir ?? (process.env.TJ_DATA_DIR?.trim() || path.join(REPO_ROOT, '.tj-data'));
  const cfg: TJConfig = {
    host: process.env.TJ_HOST ?? '127.0.0.1',
    port: Number(process.env.TJ_PORT ?? 4780),
    dataDir,
    dbPath: path.join(dataDir, 'tj.sqlite'),
    vaultPath: path.join(dataDir, 'vault'),
    artifactsDir: path.join(dataDir, 'artifacts'),
    projectsDir: path.join(dataDir, 'projects'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    allowedOrigins: (process.env.TJ_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean)) ?? [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4780',
      'http://127.0.0.1:4780',
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ],
    enableTestProvider: process.env.TJ_ENABLE_TEST_PROVIDER === '1',
    version: '2.0.0',
    ...overrides,
  };
  for (const d of [cfg.dataDir, cfg.vaultPath, cfg.artifactsDir, cfg.projectsDir, cfg.backupsDir, cfg.logsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return cfg;
}
