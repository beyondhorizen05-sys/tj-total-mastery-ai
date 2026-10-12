import { describe, expect, it } from 'vitest';
import { CognitiveEngine } from '../src/cognitive/engine.js';
import type { ModelRouter } from '../src/models/router.js';

describe('cognitive intent fallback', () => {
  const engine = new CognitiveEngine({} as ModelRouter);

  it('recognizes short imperative work requests when model classification is unavailable', () => {
    for (const text of ['Update my Shopify product', 'Run the project tests', 'Connect my calendar']) {
      expect(engine.heuristicIntent(text).intent, text).toBe('goal');
    }
  });

  it('recognizes polite delegated work while keeping how-to questions in chat', () => {
    expect(engine.heuristicIntent('Could you update my Shopify product?').intent).toBe('goal');
    expect(engine.heuristicIntent('Can you explain how to build a Shopify product page?').intent).toBe('chat');
  });

  it('keeps ordinary short conversation in chat intent', () => {
    expect(engine.heuristicIntent('Hi TJ, how are you?').intent).toBe('chat');
  });

  it('preserves the requested roles and prohibits shell or GitHub calls for local static QA audits', async () => {
    const goal = 'Execute a multi-agent quality audit of docs/calculator-prototype.html. Assign Developer, QA Engineer and Verifier. Create docs/calculator-qa-report.md. Do not change existing files, execute shell commands, or claim tests passed without evidence.';
    const planned = await engine.plan(goal);
    expect(planned.source).toBe('fallback');
    expect(planned.plan.tasks.map((task) => task.role)).toEqual(['Developer', 'QA Engineer', 'Verifier']);
    expect(planned.plan.tasks.map((task) => task.depends_on)).toEqual([[], ['inspect'], ['qa']]);
    expect(planned.plan.tasks[1]?.description).toContain('docs/calculator-qa-report.md');
    for (const task of planned.plan.tasks) {
      expect(task.tools).not.toContain('shell_exec');
      expect(task.tools).not.toContain('github_inspect_repository');
    }
  });

  it('still uses the normal planning route for unrelated coding goals', () => {
    expect(engine.staticFileAuditPlan('Build and test a new calculator prototype')).toBeNull();
    expect(engine.staticFileAuditPlan('Inspect a GitHub repo with shell commands allowed')).toBeNull();
  });

  it('preserves explicitly requested Developer -> QA Engineer -> Verifier role assignments and dependencies', async () => {
    const goal = 'Run runtime verification test. Assign Developer -> QA Engineer -> Verifier in dependency order.';
    const planned = await engine.plan(goal);
    expect(planned.plan.tasks.map((task) => task.role)).toEqual(['Developer', 'QA Engineer', 'Verifier']);
    expect(planned.plan.tasks[0]?.depends_on).toEqual([]);
    expect(planned.plan.tasks[1]?.depends_on).toEqual(['t1']);
    expect(planned.plan.tasks[2]?.depends_on).toEqual(['t2']);
    expect(planned.plan.tasks[0]?.tools).toContain('shell_exec');
    expect(planned.plan.tasks[2]?.tools).not.toContain('shell_exec');
  });

  it('routes straightforward shell diagnostics directly without web search or research specialists', async () => {
    const goal = 'Run shell diagnostic node -e "console.log(1)" and verify output';
    const planned = await engine.plan(goal);
    expect(planned.plan.tasks.map((task) => task.role)).toEqual(['Developer', 'Verifier']);
    const allTools = planned.plan.tasks.flatMap((t) => t.tools ?? []);
    expect(allTools).not.toContain('web_search');
    expect(allTools).not.toContain('github_inspect_repository');
    expect(allTools).toContain('shell_exec');
  });
});
