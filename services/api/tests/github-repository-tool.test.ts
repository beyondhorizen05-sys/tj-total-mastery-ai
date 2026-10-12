import { describe, expect, it, vi } from 'vitest';
import { githubRepositoryTool } from '../src/tools/builtin/github.js';
import type { ToolContext } from '../src/tools/types.js';

const context: ToolContext = {
  workspace_id: 'default', project_id: null, project_root: null, agent_id: null,
  agent_permissions: ['network.http'], task_id: null, workflow_run_id: null,
};

describe('GitHub public repository inspection tool', () => {
  it('rejects non-GitHub links before making a network request', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await githubRepositoryTool(fetcher).execute({ url: 'https://evil.example/owner/repo' }, context);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/github.com/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads bounded repository text and uses the saved GitHub token without exposing it', async () => {
    const token = 'secret-test-token';
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
      if (url.endsWith('/repos/acme/widget')) return Response.json({ full_name: 'acme/widget', description: 'Example', default_branch: 'main', html_url: 'https://github.com/acme/widget', stargazers_count: 8, license: { spdx_id: 'MIT' } });
      if (url.includes('/git/trees/main')) return Response.json({ tree: [
        { path: 'README.md', type: 'blob', size: 18 },
        { path: 'package.json', type: 'blob', size: 22 },
        { path: 'src/index.ts', type: 'blob', size: 30 },
        { path: 'image.png', type: 'blob', size: 40 },
      ] });
      if (url.includes('/contents/')) {
        const path = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
        const content = path === 'README.md' ? 'Public project readme' : JSON.stringify({ path });
        return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const result = await githubRepositoryTool(fetcher, () => token).execute({ url: 'https://github.com/acme/widget' }, context);
    expect(result.ok).toBe(true);
    expect(result.data?.repository).toBe('acme/widget');
    expect(result.data?.license).toBe('MIT');
    expect((result.data?.inspected_files as unknown[]).length).toBe(3);
    expect(result.output).toContain('Public project readme');
    expect(result.output).not.toContain(token);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('does not let a GitHub path escape the selected repository', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await githubRepositoryTool(fetcher).execute({ url: 'https://github.com/acme/widget/blob/main/../../secrets.txt' }, context);
    expect(result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
