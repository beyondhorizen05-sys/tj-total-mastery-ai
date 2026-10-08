const BUILDINGS: Array<[number, number]> = [[0, 0], [-4.5, -2.5], [4.5, -2.5], [0, -4.5], [-4.5, 2.5], [4.5, 2.5]];

/** Grid navigation around structures; movement starts only when a server target changes. */
export function planTownPath(from: [number, number], to: [number, number]): Array<[number, number]> {
  const start: [number, number] = [Math.round(from[0] * 2), Math.round(from[1] * 2)];
  const goal: [number, number] = [Math.round(to[0] * 2), Math.round(to[1] * 2)];
  const key = (x: number, z: number) => `${x},${z}`;
  const blocked = (x: number, z: number) => Math.abs(x) > 16 || Math.abs(z) > 13 || BUILDINGS.some(([bx, bz]) => Math.abs(x / 2 - bx) < 1.58 && Math.abs(z / 2 - bz) < 1.02);
  const open: Array<[number, number]> = [start];
  const fromKey = new Map<string, string>();
  const cost = new Map<string, number>([[key(...start), 0]]);
  const visited = new Set<string>();
  while (open.length) {
    open.sort((a, b) => (cost.get(key(...a))! + Math.abs(a[0] - goal[0]) + Math.abs(a[1] - goal[1])) - (cost.get(key(...b))! + Math.abs(b[0] - goal[0]) + Math.abs(b[1] - goal[1])));
    const [x, z] = open.shift()!;
    const current = key(x, z);
    if (visited.has(current)) continue;
    if (x === goal[0] && z === goal[1]) {
      const route: Array<[number, number]> = [to];
      let cursor = current;
      while (fromKey.has(cursor)) {
        const [cx, cz] = cursor.split(',').map(Number);
        route.unshift([cx / 2, cz / 2]);
        cursor = fromKey.get(cursor)!;
      }
      return route;
    }
    visited.add(current);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, next = key(nx, nz);
      if (visited.has(next) || (blocked(nx, nz) && next !== key(...goal))) continue;
      const tentative = cost.get(current)! + 1;
      if (tentative < (cost.get(next) ?? Infinity)) {
        cost.set(next, tentative);
        fromKey.set(next, current);
        open.push([nx, nz]);
      }
    }
  }
  return [to];
}
