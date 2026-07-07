import { describe, expect, test } from "vitest";

import { setupWebGL2Context, waitForGPUCompletion } from "../../utils/webgl";
import { QuadTreeGPU, QuadTreeNode, getQuadTreeLevelSize } from "./index";

// Helper: Generate random nodes (seeded)
// Uses deterministic pseudo-random number generation for reproducible tests
// See: https://en.wikipedia.org/wiki/Linear_congruential_generator
function generateRandomNodes(N: number, seed: number): Required<QuadTreeNode>[] {
  return Array.from({ length: N }, (_, i) => ({
    // LCG-style generation: (seed + i * multiplier) % modulus
    // Using coprime multipliers (13, 17) for x and y to avoid correlation
    // Maps [0, 10000] to [-100, 100] range
    x: ((seed + i * 13) % 10000) / 50 - 100,
    y: ((seed + i * 17) % 10000) / 50 - 100,
    mass: 1 + (i % 3),
  }));
}

// Helper: CPU replica of the splatting, to compare with the GPU output. It
// must use the same square bounding box and cell assignment as the shaders.
function computeExpectedLevel(nodes: Required<QuadTreeNode>[], level: number) {
  const xMin = Math.min(...nodes.map((n) => n.x));
  const xMax = Math.max(...nodes.map((n) => n.x));
  const yMin = Math.min(...nodes.map((n) => n.y));
  const yMax = Math.max(...nodes.map((n) => n.y));
  const center = { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 };
  const side = Math.max(Math.max(xMax - xMin, yMax - yMin), 1e-6);

  const size = getQuadTreeLevelSize(level);
  const cells = new Float64Array(size * size * 4);

  nodes.forEach(({ x, y, mass }) => {
    const relX = Math.min(Math.max((x - center.x) / side + 0.5, 0), 0.999999);
    const relY = Math.min(Math.max((y - center.y) / side + 0.5, 0), 0.999999);
    const cellX = Math.floor(relX * size);
    const cellY = Math.floor(relY * size);
    const index = (cellY * size + cellX) * 4;
    cells[index] += x * mass;
    cells[index + 1] += y * mass;
    cells[index + 2] += mass;
    cells[index + 3] += 1;
  });

  return cells;
}

describe("Quad Tree GPU Program", () => {
  const testCases = [10, 1000].flatMap((N) => [1, 3, 5].map((depth) => ({ N, depth })));

  test.each(testCases)("N=$N, depth=$depth - boundaries match nodes extents", async ({ N, depth }) => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const nodes = generateRandomNodes(N, 42);
      const quadTree = new QuadTreeGPU(gl, { nodesCount: N }, { depth });
      quadTree.setNodesData(nodes);
      quadTree.compute();
      await waitForGPUCompletion(gl);

      const [xMin, xMax, yMin, yMax] = quadTree.getBoundaries();
      expect(xMin).toBeCloseTo(Math.min(...nodes.map((n) => n.x)), 3);
      expect(xMax).toBeCloseTo(Math.max(...nodes.map((n) => n.x)), 3);
      expect(yMin).toBeCloseTo(Math.min(...nodes.map((n) => n.y)), 3);
      expect(yMax).toBeCloseTo(Math.max(...nodes.map((n) => n.y)), 3);
    } finally {
      canvas.remove();
    }
  });

  test.each(testCases)("N=$N, depth=$depth - each level conserves mass and count", async ({ N, depth }) => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const nodes = generateRandomNodes(N, 42);
      const totalMass = nodes.reduce((sum, n) => sum + n.mass, 0);
      const quadTree = new QuadTreeGPU(gl, { nodesCount: N }, { depth });
      quadTree.setNodesData(nodes);
      quadTree.compute();
      await waitForGPUCompletion(gl);

      for (let level = 0; level < depth; level++) {
        const data = quadTree.getLevelData(level);
        let mass = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          mass += data[i + 2];
          count += data[i + 3];
        }
        expect(mass, `Level ${level} total mass`).toBeCloseTo(totalMass, 2);
        expect(count, `Level ${level} total count`).toBe(N);
      }
    } finally {
      canvas.remove();
    }
  });

  test.each(testCases)("N=$N, depth=$depth - each level preserves the global barycenter", async ({ N, depth }) => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const nodes = generateRandomNodes(N, 42);
      const totalMass = nodes.reduce((sum, n) => sum + n.mass, 0);
      const barycenter = {
        x: nodes.reduce((sum, n) => sum + n.x * n.mass, 0) / totalMass,
        y: nodes.reduce((sum, n) => sum + n.y * n.mass, 0) / totalMass,
      };
      const quadTree = new QuadTreeGPU(gl, { nodesCount: N }, { depth });
      quadTree.setNodesData(nodes);
      quadTree.compute();
      await waitForGPUCompletion(gl);

      for (let level = 0; level < depth; level++) {
        const data = quadTree.getLevelData(level);
        let x = 0;
        let y = 0;
        let mass = 0;
        for (let i = 0; i < data.length; i += 4) {
          x += data[i];
          y += data[i + 1];
          mass += data[i + 2];
        }
        expect(x / mass, `Level ${level} barycenter x`).toBeCloseTo(barycenter.x, 2);
        expect(y / mass, `Level ${level} barycenter y`).toBeCloseTo(barycenter.y, 2);
      }
    } finally {
      canvas.remove();
    }
  });

  test.each(testCases)("N=$N, depth=$depth - cells aggregations match a CPU reference", async ({ N, depth }) => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const nodes = generateRandomNodes(N, 42);
      const quadTree = new QuadTreeGPU(gl, { nodesCount: N }, { depth });
      quadTree.setNodesData(nodes);
      quadTree.compute();
      await waitForGPUCompletion(gl);

      for (let level = 0; level < depth; level++) {
        const data = quadTree.getLevelData(level);
        const expected = computeExpectedLevel(nodes, level);
        for (let i = 0; i < data.length; i += 4) {
          expect(data[i + 3], `Level ${level} cell ${i / 4} count`).toBe(expected[i + 3]);
          expect(data[i], `Level ${level} cell ${i / 4} x sum`).toBeCloseTo(expected[i], 1);
          expect(data[i + 1], `Level ${level} cell ${i / 4} y sum`).toBeCloseTo(expected[i + 1], 1);
          expect(data[i + 2], `Level ${level} cell ${i / 4} mass`).toBeCloseTo(expected[i + 2], 2);
        }
      }
    } finally {
      canvas.remove();
    }
  });
});
