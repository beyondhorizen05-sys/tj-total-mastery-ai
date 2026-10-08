import fs from 'node:fs';
import path from 'node:path';
import type { Plan } from '../cognitive/types.js';

export type ProjectSnapshot = Map<string, string>;
export type SuccessfulTool = { tool: string; task_title: string; summary: string; test_command?: boolean };
export type GoalEvidence = {
  changed_files: string[];
  source_calls: number;
  test_calls: number;
  gaps: string[];
};

/** Capture bounded project file metadata; symlinks and generated dependency trees are excluded. */
export function snapshotProjectFiles(root: string, limit = 500): ProjectSnapshot {
  const files: ProjectSnapshot = new Map();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const ignored = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', 'coverage']);
  while (queue.length && files.size < limit) {
    const current = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (files.size >= limit) break;
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 6 && !ignored.has(entry.name)) queue.push({ dir: full, depth: current.depth + 1 });
      else if (entry.isFile()) {
        try { const stat = fs.statSync(full); files.set(path.relative(root, full), `${stat.size}:${stat.mtimeMs}`); } catch { /* File changed during scan. */ }
      }
    }
  }
  return files;
}

/** Require observable evidence for research/build/test claims in a software goal. */
export function assessGoalEvidence(goal: string, plan: Plan, root: string, before: ProjectSnapshot, calls: SuccessfulTool[]): GoalEvidence {
  const after = snapshotProjectFiles(root);
  const changed_files = [...after].filter(([name, signature]) => before.get(name) !== signature).map(([name]) => name);
  const source_calls = calls.filter((call) => call.tool === 'web_fetch' || (call.tool === 'web_search' && /https?:\/\//i.test(call.summary))).length;
  const test_calls = calls.filter((call) => call.tool === 'shell_exec' && call.test_command === true).length;
  const criteria = `${goal}\n${plan.success_criteria.join('\n')}`;
  const softwareGoal = /\b(app|application|prototype|website|software|program|codebase|project files)\b/i.test(criteria)
    && /\b(build|create|develop|implement|prototype|test)\b/i.test(criteria);
  const gaps: string[] = [];
  if (softwareGoal && changed_files.length === 0) gaps.push('No new or changed project file was found; prototype creation is unverified.');
  if (/\bresearch\b/i.test(goal) && source_calls === 0) gaps.push('No successful source retrieval was recorded for the research request.');
  if (softwareGoal && /\b(test|tests|tested|verify|validation)\b/i.test(criteria) && test_calls === 0) gaps.push('No successful test command was recorded from a test or QA task.');
  return { changed_files, source_calls, test_calls, gaps };
}
