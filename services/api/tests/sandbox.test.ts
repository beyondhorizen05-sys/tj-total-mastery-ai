import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Sandbox } from '../src/tools/sandbox.js';

describe('Sandbox Path Traversal Prevention', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let outsideDir: string;
  let sandbox: Sandbox;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-sandbox-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    outsideDir = path.join(tmpDir, 'outside');

    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    sandbox = new Sandbox(() => [workspaceDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows access to files within allowed roots', () => {
    const safePath = path.join(workspaceDir, 'notes.txt');
    fs.writeFileSync(safePath, 'safe content', 'utf8');

    expect(sandbox.isInside(safePath)).toBe(true);
  });

  it('allows the active project root in addition to configured storage roots', () => {
    const selectedProject = path.join(tmpDir, 'selected-project');
    fs.mkdirSync(selectedProject);
    const file = path.join(selectedProject, 'src', 'main.ts');
    expect(sandbox.isInside(file, selectedProject)).toBe(true);
  });

  it('blocks absolute paths outside allowed roots', () => {
    const unsafePath = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(unsafePath, 'secret content', 'utf8');

    expect(sandbox.isInside(unsafePath)).toBe(false);
  });

  it('blocks path traversal dot-dot attempts', () => {
    const traversalPath = path.join(workspaceDir, '..', 'outside', 'secret.txt');
    const resolved = sandbox.resolve(traversalPath, workspaceDir);
    expect(sandbox.isInside(resolved)).toBe(false);
  });

  it('blocks a symlink or junction inside an allowed root when it resolves outside', () => {
    const escape = path.join(workspaceDir, 'outside-link');
    try { fs.symlinkSync(outsideDir, escape, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch { return; } // Symlink creation can be disabled by host policy.
    const secret = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(secret, 'outside');
    const linkedFile = path.join(escape, 'secret.txt');
    expect(fs.realpathSync(linkedFile)).toBe(secret);
    expect(sandbox.isInside(linkedFile), `resolved ${fs.realpathSync(linkedFile)} outside ${workspaceDir}`).toBe(false);
  });

  it('detects forbidden system directory escapes', () => {
    if (process.platform === 'win32') {
      expect(sandbox.isForbidden('C:\\Windows\\System32\\cmd.exe')).toBe(true);
      expect(sandbox.isForbidden('C:\\Program Files\\evil.exe')).toBe(true);
    } else {
      expect(sandbox.isForbidden('/etc/passwd')).toBe(true);
      expect(sandbox.isForbidden('/bin/bash')).toBe(true);
    }
  });

  it('correctly resolves and deduplicates project-relative paths', () => {
    const projectDir = path.join(tmpDir, 'runtime-verification-test-proj');
    fs.mkdirSync(projectDir, { recursive: true });

    // 1. Resolving project basename itself returns project root
    expect(sandbox.resolve('runtime-verification-test-proj', projectDir)).toBe(projectDir);

    // 2. Resolving project basename + subfile resolves inside project root without duplication
    const fileWithBasename = sandbox.resolve('runtime-verification-test-proj/notes.md', projectDir);
    expect(fileWithBasename).toBe(path.join(projectDir, 'notes.md'));

    // 3. Accidental duplicated project basename segment is collapsed
    const duplicatePath = sandbox.resolve('runtime-verification-test-proj/runtime-verification-test-proj/notes.md', projectDir);
    expect(duplicatePath).toBe(path.join(projectDir, 'notes.md'));

    // 4. Ordinary file name resolves directly inside project root
    const directFile = sandbox.resolve('notes.md', projectDir);
    expect(directFile).toBe(path.join(projectDir, 'notes.md'));
  });

  it('handles paths with spaces and Windows separators safely', () => {
    const spacedProject = path.join(tmpDir, 'project with spaces in name');
    fs.mkdirSync(spacedProject, { recursive: true });

    const file = sandbox.resolve('sub folder\\file with spaces.txt', spacedProject);
    expect(file).toBe(path.join(spacedProject, 'sub folder', 'file with spaces.txt'));
    expect(sandbox.isInside(file, spacedProject)).toBe(true);
  });
});
