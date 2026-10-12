import { describe, it, expect } from 'vitest';
import { StateGraph, START, END, appendArrayReducer, type Checkpoint } from '../src/core/state-graph.js';

interface TestAgentState {
  goal: string;
  messages: string[];
  code: string;
  testsPassed: boolean;
  attempts: number;
}

describe('StateGraph (Stateful Multi-Agent Graph Architecture)', () => {
  it('executes a linear flow through nodes and compiles final state', async () => {
    interface SimpleState { count: number; log: string[] }
    const graph = new StateGraph<SimpleState>({
      channels: {
        log: appendArrayReducer,
      },
    });

    graph.addNode('step_a', (s) => ({ count: s.count + 1, log: ['Ran step A'] }));
    graph.addNode('step_b', (s) => ({ count: s.count * 2, log: ['Ran step B'] }));

    graph.setEntryPoint('step_a');
    graph.addEdge('step_a', 'step_b');
    graph.addEdge('step_b', END);

    const app = graph.compile();
    const result = await app.invoke({ count: 5, log: [] });

    expect(result.finalState.count).toBe(12); // (5 + 1) * 2
    expect(result.finalState.log).toEqual(['Ran step A', 'Ran step B']);
    expect(result.steps).toBe(2);
  });

  it('routes dynamically via conditional edges with critic evaluation and feedback loop', async () => {
    const graph = new StateGraph<TestAgentState>({
      channels: {
        messages: appendArrayReducer,
      },
      maxIterations: 10,
    });

    // 1. Planner Node
    graph.addNode('planner', (s) => ({
      messages: [`Planned goal: ${s.goal}`],
    }));

    // 2. Developer Node
    graph.addNode('developer', (s) => ({
      attempts: s.attempts + 1,
      code: s.attempts >= 1 ? 'function add(a, b) { return a + b; }' : 'function add(a, b) { return 0; }',
      messages: [`Developer attempt ${s.attempts + 1}`],
    }));

    // 3. QA Critic Node
    graph.addNode('qa_critic', (s) => {
      const ok = s.code.includes('a + b');
      return {
        testsPassed: ok,
        messages: [ok ? 'QA: Tests PASSED' : 'QA: Tests FAILED, routing back to Developer'],
      };
    });

    graph.setEntryPoint('planner');
    graph.addEdge('planner', 'developer');
    graph.addEdge('developer', 'qa_critic');

    // Conditional routing: if tests pass -> END, else -> loop back to developer
    graph.addConditionalEdges('qa_critic', (s) => {
      return s.testsPassed ? END : 'developer';
    });

    const app = graph.compile();
    const result = await app.invoke({
      goal: 'Write an add function',
      messages: [],
      code: '',
      testsPassed: false,
      attempts: 0,
    });

    expect(result.finalState.testsPassed).toBe(true);
    expect(result.finalState.attempts).toBe(2);
    expect(result.finalState.code).toBe('function add(a, b) { return a + b; }');
    expect(result.finalState.messages).toContain('QA: Tests PASSED');
  });

  it('detects and guards against infinite loops when maxIterations is exceeded', async () => {
    interface InfiniteState { loops: number }
    const graph = new StateGraph<InfiniteState>({ maxIterations: 5 });

    graph.addNode('loop_node', (s) => ({ loops: s.loops + 1 }));
    graph.setEntryPoint('loop_node');
    graph.addEdge('loop_node', 'loop_node'); // Infinite cycle

    const app = graph.compile();
    await expect(app.invoke({ loops: 0 })).rejects.toThrow(/exceeded maximum iteration limit of 5/i);
  });

  it('persists checkpoints across every step execution', async () => {
    interface StepState { val: number }
    const savedCheckpoints: Checkpoint<StepState>[] = [];

    const graph = new StateGraph<StepState>();
    graph.addNode('n1', (s) => ({ val: s.val + 10 }));
    graph.addNode('n2', (s) => ({ val: s.val * 3 }));
    graph.setEntryPoint('n1');
    graph.addEdge('n1', 'n2');
    graph.addEdge('n2', END);

    const app = graph.compile({
      save: (cp) => { savedCheckpoints.push(cp); },
    });

    const result = await app.invoke({ val: 2 });
    expect(result.finalState.val).toBe(36); // (2 + 10) * 3
    expect(savedCheckpoints.length).toBe(2);
    expect(savedCheckpoints[0]?.node).toBe('n1');
    expect(savedCheckpoints[0]?.state.val).toBe(12);
    expect(savedCheckpoints[1]?.node).toBe('n2');
    expect(savedCheckpoints[1]?.state.val).toBe(36);
  });

  it('handles abort signal cancellation during execution', async () => {
    interface State { x: number }
    const graph = new StateGraph<State>();
    const ctrl = new AbortController();

    graph.addNode('step1', (s) => {
      ctrl.abort(); // abort mid-execution
      return { x: s.x + 1 };
    });
    graph.addNode('step2', (s) => ({ x: s.x + 2 }));

    graph.setEntryPoint('step1');
    graph.addEdge('step1', 'step2');
    graph.addEdge('step2', END);

    const app = graph.compile();
    await expect(app.invoke({ x: 0 }, { signal: ctrl.signal })).rejects.toThrow(/aborted by signal/i);
  });
});
