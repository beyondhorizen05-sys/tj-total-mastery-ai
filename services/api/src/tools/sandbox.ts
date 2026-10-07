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
    return path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  resolve(input: string, projectRoot: string | null): string {
    if (!input || typeof input !== 'string') throw new Error('path is required');
    if (input.includes('\0')) throw new Error('invalid path');
    const base = projectRoot ?? this.roots()[0] ?? process.cwd();
    const abs = path.isAbsolute(input) ? path.resolve(input) : path.resolve(base, input);
    return abs;
  }

  isInside(abs: string): boolean {
    const n = this.normalize(abs);
    let real = n;
    try {
      // follow symlinks of the deepest existing ancestor to prevent link escapes
      let probe = abs;
      while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
      const realProbe = fs.realpathSync(probe);
      real = this.normalize(path.join(realProbe, path.relative(probe, abs)));
    } catch {}
    return this.roots().some((r) => {
      const root = this.normalize(r);
      return n === root || n.startsWith(root + '/') || real === root || real.startsWith(root + '/');
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
