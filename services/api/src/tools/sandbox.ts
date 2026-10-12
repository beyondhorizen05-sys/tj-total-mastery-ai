import path from 'node:path';
import fs from 'node:fs';

/**
 * Path sandbox (Spec §75 path traversal). Agents may only touch:
 *   - the active project's root
 *   - the TJ data dir (artifacts/projects)
 *   - explicitly user-allowed roots (settings.allowed_roots)
 * Everything else requires an approval for the resolved absolute path.
 */
export class Sandbox {
  constructor(private roots: () => string[]) {}

  normalize(p: string): string {
    const normalized = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return normalized || '/';
  }

  private canonicalPath(candidate: string): string {
    let probe = candidate;
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    try { return this.normalize(path.join(fs.realpathSync(probe), path.relative(probe, candidate))); }
    catch { return this.normalize(candidate); }
  }

  resolve(input: string, projectRoot: string | null): string {
    if (!input || typeof input !== 'string') throw new Error('path is required');
    if (input.includes('\0')) throw new Error('invalid path');
    const base = projectRoot ?? this.roots()[0] ?? process.cwd();

    if (path.isAbsolute(input)) {
      return path.resolve(input);
    }

    const cleanInput = input.replace(/^[.][\\/]/, '');
    if (projectRoot) {
      const normProjectRoot = this.normalize(projectRoot);
      const projectBasename = path.basename(normProjectRoot);

      // 1. If input resolved from process.cwd() lands inside or is equal to projectRoot,
      // the caller specified a path relative to the repo root rather than project root.
      const candidateFromCwd = path.resolve(process.cwd(), cleanInput);
      const normFromCwd = this.normalize(candidateFromCwd);
      if (normFromCwd === normProjectRoot || normFromCwd.startsWith(normProjectRoot + '/')) {
        return this.collapseProjectDuplicates(candidateFromCwd, projectBasename);
      }

      // 2. If input begins with the project folder name (single or repeated)
      const normInput = cleanInput.replace(/\\/g, '/');
      let subPath = normInput;
      while (subPath.startsWith(projectBasename + '/')) {
        subPath = subPath.slice(projectBasename.length + 1);
      }
      if (subPath === projectBasename) {
        return projectRoot;
      }
      if (subPath !== normInput) {
        return path.resolve(projectRoot, subPath);
      }

      // 3. If input resolved from project parent directory lands inside or is equal to projectRoot,
      // the caller passed a path starting with the project folder name.
      const candidateFromParent = path.resolve(path.dirname(projectRoot), cleanInput);
      const normFromParent = this.normalize(candidateFromParent);
      if (normFromParent === normProjectRoot || normFromParent.startsWith(normProjectRoot + '/')) {
        return this.collapseProjectDuplicates(candidateFromParent, projectBasename);
      }
    }

    const abs = path.resolve(base, input);

    if (projectRoot) {
      const normProjectRoot = this.normalize(projectRoot);
      const projectBasename = path.basename(normProjectRoot);
      return this.collapseProjectDuplicates(abs, projectBasename);
    }

    return abs;
  }

  private collapseProjectDuplicates(p: string, projectBasename: string): string {
    const doubleSep = `/${projectBasename}/${projectBasename}`;
    let norm = p.replace(/\\/g, '/');
    while (norm.includes(doubleSep)) {
      norm = norm.replace(doubleSep, `/${projectBasename}`);
    }
    return path.resolve(norm);
  }

  isInside(abs: string, projectRoot?: string | null): boolean {
    // Compare canonical paths only: lexical membership alone accepts a symlink or
    // junction inside a trusted folder that resolves outside it.
    const real = this.canonicalPath(abs);
    const roots = [...this.roots(), ...(projectRoot ? [projectRoot] : [])];
    return roots.some((r) => {
      const root = this.canonicalPath(r);
      return real === root || real.startsWith(root + '/');
    });
  }

  /** Protected system locations are never writable by tools, even with approval. */
  isForbidden(abs: string): boolean {
    const n = this.normalize(abs);
    const win = process.platform === 'win32';
    const forbidden = win
      ? ['c:/windows', 'c:/program files', 'c:/program files (x86)', 'c:/programdata/microsoft']
      : ['/bin', '/sbin', '/usr', '/etc', '/boot', '/sys', '/proc', '/dev', '/lib', '/lib64', '/system'];
    return forbidden.some((f) => n === f || n.startsWith(f + '/'));
  }
}
