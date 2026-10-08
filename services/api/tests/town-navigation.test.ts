import { describe, expect, it } from 'vitest';
import { planTownPath } from '../../../apps/web/src/components/town-navigation.js';

describe('Agent Town navigation', () => {
  it('routes an agent around buildings when moving to another area', () => {
    const path = planTownPath([-4.5, 0.3], [0, -3.06]);
    expect(path.length).toBeGreaterThan(2);
    expect(path.at(-1)).toEqual([0, -3.06]);
    const buildings: Array<[number, number]> = [[0, 0], [-4.5, -2.5], [4.5, -2.5], [0, -4.5], [-4.5, 2.5], [4.5, 2.5]];
    for (const [x, z] of path) {
      expect(buildings.some(([bx, bz]) => Math.abs(x - bx) < 1.58 && Math.abs(z - bz) < 1.02)).toBe(false);
    }
  });
});
