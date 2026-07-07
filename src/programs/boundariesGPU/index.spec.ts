import { describe, expect, test } from "vitest";

import { setupWebGL2Context, waitForGPUCompletion } from "../../utils/webgl";
import { BoundariesGPU, BoundariesNode } from "./index";

// Helper: Generate random nodes (seeded)
// Uses deterministic pseudo-random number generation for reproducible tests
// See: https://en.wikipedia.org/wiki/Linear_congruential_generator
function generateRandomNodes(N: number, seed: number): BoundariesNode[] {
  return Array.from({ length: N }, (_, i) => ({
    // LCG-style generation: (seed + i * multiplier) % modulus
    // Using coprime multipliers (13, 17) for x and y to avoid correlation
    // Maps [0, 10000] to [-100, 100] range
    x: ((seed + i * 13) % 10000) / 50 - 100,
    y: ((seed + i * 17) % 10000) / 50 - 100,
  }));
}

describe("Boundaries GPU Program", () => {
  // Various sizes, including 1 (single pass into the output), non powers of
  // two, and sizes requiring multiple reduction passes:
  const NValues = [1, 3, 10, 17, 1000, 5000];

  test.each(NValues.map((N) => ({ N })))("N=$N - boundaries match nodes extents", async ({ N }) => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const nodes = generateRandomNodes(N, 42);
      const boundaries = new BoundariesGPU(gl, { nodesCount: N });
      boundaries.setNodesData(nodes);
      boundaries.compute();
      await waitForGPUCompletion(gl);

      const [xMin, xMax, yMin, yMax] = boundaries.getBoundaries();
      expect(xMin).toBeCloseTo(Math.min(...nodes.map((n) => n.x)), 3);
      expect(xMax).toBeCloseTo(Math.max(...nodes.map((n) => n.x)), 3);
      expect(yMin).toBeCloseTo(Math.min(...nodes.map((n) => n.y)), 3);
      expect(yMax).toBeCloseTo(Math.max(...nodes.map((n) => n.y)), 3);
    } finally {
      canvas.remove();
    }
  });

  test("Padding texels are ignored (all nodes in the positive quadrant)", async () => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      // 5 nodes on a 3x3 texture: the 4 padding texels contain zeros, which
      // must NOT drag the min boundaries to 0:
      const nodes = [
        { x: 10, y: 20 },
        { x: 15, y: 25 },
        { x: 30, y: 22 },
        { x: 12, y: 40 },
        { x: 18, y: 35 },
      ];
      const boundaries = new BoundariesGPU(gl, { nodesCount: nodes.length });
      boundaries.setNodesData(nodes);
      boundaries.compute();
      await waitForGPUCompletion(gl);

      const [xMin, xMax, yMin, yMax] = boundaries.getBoundaries();
      expect(xMin).toBeCloseTo(10, 4);
      expect(xMax).toBeCloseTo(30, 4);
      expect(yMin).toBeCloseTo(20, 4);
      expect(yMax).toBeCloseTo(40, 4);
    } finally {
      canvas.remove();
    }
  });

  test("Recomputing after data change gives fresh boundaries", async () => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const boundaries = new BoundariesGPU(gl, { nodesCount: 100 });
      boundaries.setNodesData(generateRandomNodes(100, 42));
      boundaries.compute();
      await waitForGPUCompletion(gl);

      const nodes = generateRandomNodes(100, 42).map((n) => ({ x: n.x * 2 + 1000, y: n.y * 3 - 500 }));
      boundaries.setNodesData(nodes);
      boundaries.compute();
      await waitForGPUCompletion(gl);

      const [xMin, xMax, yMin, yMax] = boundaries.getBoundaries();
      expect(xMin).toBeCloseTo(Math.min(...nodes.map((n) => n.x)), 3);
      expect(xMax).toBeCloseTo(Math.max(...nodes.map((n) => n.x)), 3);
      expect(yMin).toBeCloseTo(Math.min(...nodes.map((n) => n.y)), 3);
      expect(yMax).toBeCloseTo(Math.max(...nodes.map((n) => n.y)), 3);
    } finally {
      canvas.remove();
    }
  });
});
