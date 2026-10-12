/**
 * CLI Tool: Ingest Universal Agentic Skills into TJ Knowledge Base.
 *
 * Scans .agents/skills (or global antigravity skills directory),
 * extracts structural markdown playbooks, chunks them semantically,
 * and indexes them into TJ's SQLite memory store with FTS5 search.
 *
 * Usage:
 *   pnpm --filter @tj/api run ingest-skills [--filter <pattern>] [--limit <number>]
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { Database } from '../db/database.js';
import { EventBus } from '../core/event-bus.js';
import { MemoryService } from '../memory/memory.js';
import { KnowledgeIndexer } from '../memory/knowledge-indexer.js';

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  relativePath: string;
  content: string;
}

export function parseSkillFile(filePath: string, relativePath: string): SkillInfo | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

    let name = path.basename(path.dirname(filePath));
    let description = '';
    let body = raw;

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      body = frontmatterMatch[2];

      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');

      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    return {
      name,
      description,
      filePath,
      relativePath,
      content: body.trim(),
    };
  } catch {
    return null;
  }
}

export function findSkills(rootDir: string, filterPattern?: RegExp, limit?: number): SkillInfo[] {
  const results: SkillInfo[] = [];

  if (!fs.existsSync(rootDir)) {
    return results;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;

    if (filterPattern && !filterPattern.test(skillName)) {
      continue;
    }

    const skillMdPath = path.join(rootDir, skillName, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const parsed = parseSkillFile(skillMdPath, `skills/${skillName}/SKILL.md`);
      if (parsed) {
        results.push(parsed);
        if (limit && results.length >= limit) break;
      }
    }
  }

  return results;
}

export async function runIngestion(options: {
  filter?: string;
  limit?: number;
  skillsDir?: string;
  dbPath?: string;
}) {
  const cfg = loadConfig();
  const dbPath = options.dbPath ?? cfg.dbPath;

  console.log(`Connecting to TJ database: ${dbPath}`);
  const db = new Database(dbPath);
  db.migrate();

  const bus = new EventBus(db);
  const memory = new MemoryService(db, bus, null);
  const indexer = new KnowledgeIndexer(db, bus, memory, null);

  // Resolve skills directory
  const defaultDir = path.resolve(cfg.dataDir, '..', '.agents', 'skills');
  const globalDir = 'C:\\Users\\Jazib\\.gemini\\antigravity\\skills';
  const resolvedDir = options.skillsDir ?? (fs.existsSync(defaultDir) ? defaultDir : globalDir);

  console.log(`Scanning skills in: ${resolvedDir}`);
  const filter = options.filter ? new RegExp(options.filter, 'i') : undefined;
  const skills = findSkills(resolvedDir, filter, options.limit);

  console.log(`Found ${skills.length} skills matching criteria. Starting ingestion...`);

  let totalChunks = 0;
  let totalCharacters = 0;
  const start = performance.now();

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    const fullDoc = `# Skill: ${skill.name}\n\n${skill.description ? `> ${skill.description}\n\n` : ''}${skill.content}`;

    const res = await indexer.ingestDocument({
      workspace_id: 'default',
      file_path: skill.relativePath,
      content: fullDoc,
      category: 'agent_skill',
      format: 'markdown',
    });

    totalChunks += res.chunks_created;
    totalCharacters += fullDoc.length;

    if ((i + 1) % 25 === 0 || i + 1 === skills.length) {
      process.stdout.write(`\rProgress: ${i + 1}/${skills.length} skills ingested (${totalChunks} chunks)`);
    }
  }

  const durationSec = ((performance.now() - start) / 1000).toFixed(2);
  console.log(`\n\nIngestion complete in ${durationSec}s!`);
  console.log(`- Skills Ingested: ${skills.length}`);
  console.log(`- Total Chunks: ${totalChunks}`);
  console.log(`- Characters Indexed: ${totalCharacters.toLocaleString()}`);

  const totalInDb = db.get<{ c: number }>('SELECT COUNT(*) c FROM memories WHERE source LIKE ?', ['file:skills/%']);
  console.log(`- Total Skill Chunks in TJ Database: ${totalInDb?.c ?? 0}`);

  db.close();
  return { skillsCount: skills.length, totalChunks, durationSec };
}

// Run CLI if invoked directly
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isMain) {
  const args = process.argv.slice(2);
  let filter: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filter' && args[i + 1]) filter = args[++i];
    if (args[i] === '--limit' && args[i + 1]) limit = Number(args[++i]);
  }

  runIngestion({ filter, limit }).catch((err) => {
    console.error('Ingestion failed:', err);
    process.exit(1);
  });
}
