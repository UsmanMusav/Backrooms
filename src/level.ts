export const CELL = 2.8;
export const WALL_HEIGHT = 2.95;
export const MAP_SIZE = 27;
export type Cell = { x: number; z: number };

/** The map is kept independent from rendering so collision and AI use the same geometry. */
export function createMap(): boolean[][] {
  const map = Array.from({ length: MAP_SIZE }, () => Array<boolean>(MAP_SIZE).fill(true));
  const carve = (x1: number, z1: number, x2: number, z2: number) => {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) map[z][x] = false;
  };
  const wall = (x1: number, z1: number, x2: number, z2: number) => {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) map[z][x] = true;
  };
  carve(2, 2, 9, 10);
  carve(7, 4, 14, 12);
  carve(11, 2, 16, 7);
  carve(13, 7, 18, 19);
  carve(18, 3, 24, 11);
  carve(20, 10, 24, 24);
  carve(8, 14, 23, 17);
  carve(3, 9, 6, 22);
  carve(3, 18, 11, 24);
  carve(10, 21, 21, 24);
  carve(12, 18, 16, 23);
  wall(6, 3, 6, 5);
  wall(6, 8, 6, 10);
  wall(3, 8, 3, 9);
  wall(9, 7, 9, 7);
  wall(11, 9, 11, 11);
  wall(14, 3, 14, 4);
  wall(16, 10, 16, 13);
  wall(14, 16, 14, 18);
  wall(20, 5, 20, 8);
  wall(22, 14, 22, 16);
  wall(7, 19, 7, 22);
  wall(11, 22, 12, 22);
  wall(21, 21, 21, 22);
  wall(4, 13, 4, 15);
  wall(9, 15, 10, 15);
  return map;
}

export const SPAWN: Cell = { x: 4, z: 4 };
export const FUSE_CELLS: Cell[] = [{ x: 12, z: 5 }, { x: 5, z: 21 }, { x: 23, z: 20 }];
export const PANEL_CELL: Cell = { x: 3, z: 2 };
export const EXIT_CELL: Cell = { x: 5, z: 2 };

export function blocked(map: boolean[][], x: number, z: number): boolean {
  const col = Math.floor(x / CELL + 0.5);
  const row = Math.floor(z / CELL + 0.5);
  return map[row]?.[col] ?? true;
}

export function canStand(map: boolean[][], x: number, z: number, radius = 0.24): boolean {
  return !blocked(map, x - radius, z - radius) && !blocked(map, x + radius, z - radius)
    && !blocked(map, x - radius, z + radius) && !blocked(map, x + radius, z + radius);
}

export function cellAt(x: number, z: number): Cell {
  return { x: Math.round(x / CELL), z: Math.round(z / CELL) };
}

export function findPath(map: boolean[][], start: Cell, end: Cell): Cell[] {
  if (map[start.z]?.[start.x] !== false || map[end.z]?.[end.x] !== false) return [];
  const queue: Cell[] = [start];
  const cameFrom = new Map<string, Cell | null>([[`${start.x},${start.z}`, null]]);
  let index = 0;
  while (index < queue.length) {
    const current = queue[index++];
    if (current.x === end.x && current.z === end.z) {
      const path: Cell[] = [];
      let node: Cell | null = current;
      while (node) {
        path.unshift(node);
        node = cameFrom.get(`${node.x},${node.z}`) ?? null;
      }
      return path;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, z: current.z + dz };
      const key = `${next.x},${next.z}`;
      if (map[next.z]?.[next.x] === false && !cameFrom.has(key)) {
        cameFrom.set(key, current);
        queue.push(next);
      }
    }
  }
  return [];
}

export function clearSight(map: boolean[][], ax: number, az: number, bx: number, bz: number): boolean {
  const distance = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(distance / 0.4);
  for (let i = 1; i < steps; i++) {
    if (blocked(map, ax + (bx - ax) * i / steps, az + (bz - az) * i / steps)) return false;
  }
  return true;
}

export function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
