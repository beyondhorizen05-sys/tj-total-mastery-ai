import { afterEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractZip, parseSearchResults } from '../src/tools/builtin/web.js';

const roots: string[] = [];
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-web-tools-')); roots.push(dir); return dir; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('public web research tools', () => {
  it('parses public search results and unwraps DuckDuckGo redirect URLs', () => {
    const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fguide">Guide &amp; docs</a><a class="result__snippet">A public guide</a>';
    expect(parseSearchResults(html, 4)).toEqual([{ title: 'Guide & docs', url: 'https://example.org/guide', snippet: 'A public guide' }]);
  });

  it('extracts bounded ZIP files under the chosen directory', async () => {
    const dir = temp(), archive = path.join(dir, 'source.zip'), dest = path.join(dir, 'out');
    fs.writeFileSync(archive, zipSync({ 'docs/readme.txt': new TextEncoder().encode('safe content') }));
    const result = await extractZip(archive, dest);
    expect(result).toEqual({ files: 1, bytes: 12 });
    expect(fs.readFileSync(path.join(dest, 'docs/readme.txt'), 'utf8')).toBe('safe content');
  });

  it('rejects ZIP path traversal entries', async () => {
    const dir = temp(), archive = path.join(dir, 'bad.zip');
    fs.writeFileSync(archive, zipSync({ '../outside.txt': new TextEncoder().encode('unsafe') }));
    await expect(extractZip(archive, path.join(dir, 'out'))).rejects.toThrow(/path traversal|invalid relative path/i);
    expect(fs.existsSync(path.join(dir, 'outside.txt'))).toBe(false);
  });
});
