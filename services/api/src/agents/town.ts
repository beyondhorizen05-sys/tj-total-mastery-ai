import type { Agent, TownAgent } from '@tj/schemas';

const LOCATIONS: Record<string, [number, number]> = {
  command_center: [0, 0], research_lab: [-4.5, -2.5], dev_studio: [4.5, -2.5],
  meeting_hall: [0, -4.5], creative_studio: [-4.5, 2.5], operations: [4.5, 2.5],
};
const active = (status: Agent['status']) => ['thinking', 'working', 'waiting_approval', 'meeting'].includes(status);

/** A deterministic, collision-free projection of persisted agent work into town coordinates. */
export function buildTownState(agents: Agent[]): TownAgent[] {
  const stationCounts = new Map<string, number>();
  const idleCounts = new Map<string, number>();
  return [...agents].sort((a, b) => a.id.localeCompare(b.id)).map((agent) => {
    const area = agent.status === 'meeting' ? 'meeting_hall' : LOCATIONS[agent.town_area] ? agent.town_area : 'command_center';
    const [ax, az] = LOCATIONS[area];
    if (active(agent.status)) {
      const slot = stationCounts.get(area) ?? 0;
      stationCounts.set(area, slot + 1);
      const assigned = slot < 3;
      return {
        id: agent.id, name: agent.name, role: agent.role, area, status: agent.status,
        task_id: agent.current_task_id, workstation_id: assigned ? `${area}:desk:${slot + 1}` : null,
        x: assigned ? ax - 0.78 + slot * 0.78 : ax - 1.2 + (slot - 3) * 0.5,
        z: assigned ? az + 1.44 : az + 2.75,
      };
    }
    const slot = idleCounts.get(area) ?? 0;
    idleCounts.set(area, slot + 1);
    return {
      id: agent.id, name: agent.name, role: agent.role, area, status: agent.status,
      task_id: agent.current_task_id, workstation_id: null,
      x: ax - 1.2 + (slot % 4) * 0.78,
      z: az + 2.35 + Math.floor(slot / 4) * 0.48,
    };
  });
}
