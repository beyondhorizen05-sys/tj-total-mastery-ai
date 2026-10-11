import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, apiScriptDirectory } from '../src/config.js';

describe('Desktop runtime script resolution', () => {
  it('preserves checked-in script paths in development', () => {
    const scripts = apiScriptDirectory(false);
    expect(scripts).toBe(path.join(REPO_ROOT, 'services', 'api', 'scripts'));
    for (const name of ['computer-bridge.ps1', 'voice-listener.ps1', 'voice-speak.ps1', 'voice-voices.ps1', 'local-asr.py']) {
      expect(fs.statSync(path.join(scripts, name)).isFile()).toBe(true);
    }
  });

  it('resolves installed scripts beside the bundled main.js, independent of the checkout', () => {
    const bundled = path.join(os.tmpdir(), 'TJ bundled app', 'resources', 'api', 'main.js');
    expect(apiScriptDirectory(true, pathToFileURL(bundled).href))
      .toBe(path.join(os.tmpdir(), 'TJ bundled app', 'resources', 'api', 'scripts'));
  });
});
