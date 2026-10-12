/**
 * Stateful Multi-Agent Graph Architecture (LangGraph Pattern in TypeScript).
 *
 * Implements:
 * 1. Typed StateGraph with Node definitions and State Reducers.
 * 2. Static and Conditional Edges with decision-based branching.
 * 3. Controlled cycles with max_iterations guards to avoid infinite loops.
 * 4. Step-by-step checkpointing for pause, resume, and audit logging.
 */

export type Reducer<T> = (current: T, update: any) => T;

export interface StateGraphOptions<TState extends Record<string, any>> {
  channels?: { [K in keyof TState]?: Reducer<TState[K]> };
  maxIterations?: number;
}

export type NodeHandler<TState extends Record<string, any>> = (
  state: TState,
  signal?: AbortSignal
) => Promise<Partial<TState>> | Partial<TState>;

export type ConditionalEdgeRouter<TState extends Record<string, any>> = (
  state: TState
) => string | Promise<string>;

export interface Checkpoint<TState> {
  step: number;
  node: string;
  state: TState;
  timestamp: string;
}

export const START = '__START__';
export const END = '__END__';

/** Default reducer: shallow merge object properties */
export function defaultObjectReducer<T extends Record<string, any>>(current: T, update: Partial<T>): T {
  return { ...current, ...update };
}

/** Reducer for array append (messages, tool calls, audit logs) */
export function appendArrayReducer<T>(current: T[], update: T[] | T): T[] {
  const base = Array.isArray(current) ? current : [];
  if (Array.isArray(update)) {
    return [...base, ...update];
  }
  return update !== undefined ? [...base, update] : base;
}

export class StateGraph<TState extends Record<string, any>> {
  private nodes = new Map<string, NodeHandler<TState>>();
  private edges = new Map<string, string>();
  private conditionalEdges = new Map<string, ConditionalEdgeRouter<TState>>();
  private entryPoint: string = END;
  private maxIterations: number;
  private reducers: { [K in keyof TState]?: Reducer<TState[K]> };

  constructor(options: StateGraphOptions<TState> = {}) {
    this.maxIterations = options.maxIterations ?? 25;
    this.reducers = options.channels ?? {};
  }

  /** Add an executable node */
  addNode(name: string, handler: NodeHandler<TState>): this {
    if (name === START || name === END) {
      throw new Error(`Reserved node name: ${name}`);
    }
    this.nodes.set(name, handler);
    return this;
  }

  /** Set the entry node */
  setEntryPoint(nodeName: string): this {
    if (!this.nodes.has(nodeName)) {
      throw new Error(`Entry point node "${nodeName}" does not exist`);
    }
    this.entryPoint = nodeName;
    return this;
  }

  /** Add a deterministic edge from node A to node B */
  addEdge(from: string, to: string): this {
    if (from !== START && !this.nodes.has(from)) {
      throw new Error(`Source node "${from}" does not exist`);
    }
    if (to !== END && !this.nodes.has(to)) {
      throw new Error(`Target node "${to}" does not exist`);
    }
    if (from === START) {
      this.entryPoint = to;
    } else {
      this.edges.set(from, to);
    }
    return this;
  }

  /** Add a conditional edge from a node based on dynamic routing */
  addConditionalEdges(from: string, router: ConditionalEdgeRouter<TState>): this {
    if (!this.nodes.has(from)) {
      throw new Error(`Source node "${from}" does not exist`);
    }
    this.conditionalEdges.set(from, router);
    return this;
  }

  /** Apply reducers to state updates */
  private applyStateUpdate(currentState: TState, update: Partial<TState>): TState {
    const nextState = { ...currentState };
    for (const key of Object.keys(update) as Array<keyof TState>) {
      const reducer = this.reducers[key];
      if (reducer) {
        nextState[key] = reducer(currentState[key], update[key]!);
      } else {
        nextState[key] = update[key]!;
      }
    }
    return nextState;
  }

  /** Compile the graph into an executable runnable */
  compile(checkpointer?: { save: (cp: Checkpoint<TState>) => void | Promise<void> }) {
    if (this.entryPoint === END) {
      throw new Error('Graph must have an entry point defined before compiling.');
    }

    return {
      invoke: async (
        initialState: TState,
        options: { signal?: AbortSignal; onStep?: (step: Checkpoint<TState>) => void } = {}
      ): Promise<{ finalState: TState; checkpoints: Checkpoint<TState>[]; steps: number }> => {
        let currentState = { ...initialState };
        let currentNode = this.entryPoint;
        let stepCount = 0;
        const checkpoints: Checkpoint<TState>[] = [];

        while (currentNode !== END && stepCount < this.maxIterations) {
          if (options.signal?.aborted) {
            throw new Error('Graph execution aborted by signal.');
          }

          const handler = this.nodes.get(currentNode);
          if (!handler) {
            throw new Error(`Node "${currentNode}" not found in graph.`);
          }

          stepCount++;
          const update = await handler(currentState, options.signal);
          currentState = this.applyStateUpdate(currentState, update);

          const cp: Checkpoint<TState> = {
            step: stepCount,
            node: currentNode,
            state: currentState,
            timestamp: new Date().toISOString(),
          };

          checkpoints.push(cp);
          if (checkpointer) {
            await checkpointer.save(cp);
          }
          options.onStep?.(cp);

          // Determine next node: conditional router takes precedence over direct edge
          if (this.conditionalEdges.has(currentNode)) {
            const router = this.conditionalEdges.get(currentNode)!;
            currentNode = await router(currentState);
          } else if (this.edges.has(currentNode)) {
            currentNode = this.edges.get(currentNode)!;
          } else {
            currentNode = END;
          }
        }

        if (stepCount >= this.maxIterations && currentNode !== END) {
          throw new Error(`Graph exceeded maximum iteration limit of ${this.maxIterations}. Possible infinite cycle detected.`);
        }

        return {
          finalState: currentState,
          checkpoints,
          steps: stepCount,
        };
      },
    };
  }
}
