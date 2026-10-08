import { describe, expect, it } from 'vitest';
import type { Agent } from '@tj/schemas';
import { buildTownState } from '../src/agents/town.js';

const agent = (id: string, status: Agent['status'], area = 'research_lab'): Agent => ({
  id, name: id, role: 'Researcher', status, town_area: area,
  current_task_id: status === 'working' ? `task-${id}` : null,
} as Agent);

describe('Agent Town projection', () => {
  it('reserves each actual work desk once and frees it when work ends', () => {
    const live = buildTownState([agent('d', 'working'), agent('b', 'working'), agent('a', 'thinking'), agent('c', 'working')]);
    const reservations = live.map((a) => a.workstation_id).filter(Boolean);
    expect(new Set(reservations).size).toBe(3);
    expect(reservations).toHaveLength(3);
    expect(live.find((a) => a.id === 'd')?.workstation_id).toBeNull();
    expect(live.find((a) => a.id === 'b')?.task_id).toBe('task-b');
    const after = buildTownState([agent('a', 'completed'), agent('b', 'working')]);
    expect(after.find((a) => a.id === 'a')?.workstation_id).toBeNull();
    expect(after.find((a) => a.id === 'b')?.workstation_id).toBe('research_lab:desk:1');
  });
});
