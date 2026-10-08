import { z } from 'zod';
import { AgentStatus } from './entities/agents.js';

export const TownAgent = z.object({
  id: z.string(), name: z.string(), role: z.string(), area: z.string(), status: AgentStatus,
  task_id: z.string().nullable(), workstation_id: z.string().nullable(),
  x: z.number(), z: z.number(),
});
export type TownAgent = z.infer<typeof TownAgent>;
