import _, { sortBy } from "lodash";
import { describe, expect, test } from "vitest";

import { setupWebGL2Context, waitForGPUCompletion } from "../../utils/webgl";
import { KMeansGPU } from "./index";

type Point = { x: number; y: number };
type Node = { id: number } & Point;
type GroupedNode = Node & { group: number };

// Helper: Generate N nodes in C groups (seeded random)
// Creates well-separated clusters using a deterministic pseudo-random distribution
function generateGroupedNodes(N: number, C: number, seed: number): GroupedNode[] {
  const nodes: GroupedNode[] = [];
  const nodesPerGroup = Math.floor(N / C);

  // Distribute C group centers evenly in a [-100, 100] x [-100, 100] space
  // Using prime number offsets (7) to avoid clustering when C is a power of 2
  const groupCenters = Array.from({ length: C }, (_, i) => ({
    x: ((i * 2) / C - 1) * 100, // Linearly distributed from -100 to 100
    y: ((((i * 7) % C) * 2) / C - 1) * 100, // Scrambled distribution to avoid diagonal alignment
  }));

  for (let g = 0; g < C; g++) {
    const count = g === C - 1 ? N - g * nodesPerGroup : nodesPerGroup;
    for (let i = 0; i < count; i++) {
      // Pseudo-random angle using Linear Congruential Generator pattern
      // See: https://en.wikipedia.org/wiki/Linear_congruential_generator
      const angle = ((seed + g * 100 + i) * Math.E) % (Math.PI * 2);

      // Pseudo-random radius using modulo arithmetic with coprime multipliers (13, 17)
      // Scaled to max radius of 5 to keep nodes tightly clustered
      const radius = (((seed + i * 13 + g * 17) % 1000) / 1000) * 5;

      // Place node using polar coordinates around group center
      nodes.push({
        id: nodes.length,
        group: g,
        x: groupCenters[g].x + Math.cos(angle) * radius,
        y: groupCenters[g].y + Math.sin(angle) * radius,
      });
    }
  }
  return nodes;
}

// Helper: Generate random nodes (seeded)
// Uses deterministic pseudo-random number generation for reproducible tests
// See: https://en.wikipedia.org/wiki/Linear_congruential_generator
function generateRandomNodes(N: number, seed: number): Node[] {
  return Array.from({ length: N }, (_, i) => ({
    id: i,
    // LCG-style generation: (seed + i * multiplier) % modulus
    // Using coprime multipliers (13, 17) for x and y to avoid correlation
    // Maps [0, 10000] to [-100, 100] range
    x: ((seed + i * 13) % 10000) / 50 - 100,
    y: ((seed + i * 17) % 10000) / 50 - 100,
  }));
}

// Helper: Calculate barycenter
function getBarycenter(nodes: Node[]): Point {
  const sum = nodes.reduce((acc, n) => ({ x: acc.x + n.x, y: acc.y + n.y }), { x: 0, y: 0 });
  return { x: sum.x / nodes.length, y: sum.y / nodes.length };
}

describe("K-means GPU Program", () => {
  const NCValues = [10, 1000].flatMap((N) => [2, Math.floor(Math.sqrt(N))].map((C) => ({ N, C })));
  const stepValues = [1, 2, 3];
  const iterationCountValues = [1, 2];

  // Test 1: Grouped nodes - centroids should match groups after several iterations
  const groupedTestCases = NCValues.flatMap(({ N, C }) =>
    stepValues.flatMap((steps) => iterationCountValues.map((iterationCount) => ({ N, C, steps, iterationCount }))),
  );

  test.each(groupedTestCases)(
    "Grouped: N=$N, C=$C, steps=$steps, iteration count=$iterationCount - centroids match groups",
    async ({ N, C, steps, iterationCount }) => {
      const { gl, canvas } = setupWebGL2Context();
      try {
        const nodes = generateGroupedNodes(N, C, 42);
        const originalGroups = _(nodes)
          .groupBy("group")
          .map((nodes) => nodes.map((node) => node.id).sort())
          .sortBy((nodes) => nodes.join(","))
          .value();
        const kMeans = new KMeansGPU(gl, { nodesCount: N, centroidsCount: C });
        kMeans.setNodesData(nodes);
        kMeans.compute({ steps, iterationCount });
        await waitForGPUCompletion(gl);

        const assignments = kMeans.getClosestCentroidData().slice(0, N);
        let assignedGroups: number[][] = [];
        assignments.forEach((group, index) => {
          assignedGroups[group] = assignedGroups[group] || [];
          assignedGroups[group].push(index);
        });
        assignedGroups = sortBy(
          assignedGroups.map((nodes) => nodes.sort()),
          (nodes) => nodes.join(","),
        );

        expect(assignedGroups).toStrictEqual(originalGroups);
      } finally {
        canvas.remove();
      }
    },
  );

  // Test 2: Single centroid should be at barycenter
  const singleCentroidTestCases = [10, 1000].flatMap((N) => [1, 2, 3, 4, 5].map((steps) => ({ N, steps })));

  test.each(singleCentroidTestCases)("Single centroid: N=$N, steps=$steps - at barycenter", async ({ N, steps }) => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const nodes = generateRandomNodes(N, 123);
      const barycenter = getBarycenter(nodes);

      const kMeans = new KMeansGPU(gl, { nodesCount: N, centroidsCount: 1 });
      kMeans.setNodesData(nodes);
      kMeans.compute({ steps });
      await waitForGPUCompletion(gl);

      const centroidsData = kMeans.getCentroidsPositionData();
      const [cx, cy] = centroidsData;

      expect(cx).toBeCloseTo(barycenter.x);
      expect(cy).toBeCloseTo(barycenter.y);
    } finally {
      canvas.remove();
    }
  });

  // Test 3: One centroid per node - each should match exactly one node
  const onePerNodeTestCases = [10, 100].flatMap((N) => [1, 2, 3, 4, 5].map((steps) => ({ N, steps })));

  test.each(onePerNodeTestCases)("One per node: N=$N, steps=$steps - exact match", async ({ N, steps }) => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      const nodes = generateRandomNodes(N, 456);

      const kMeans = new KMeansGPU(gl, { nodesCount: N, centroidsCount: N });
      kMeans.setNodesData(nodes);
      kMeans.compute({ steps });
      await waitForGPUCompletion(gl);

      const centroidsData = kMeans.getCentroidsPositionData();
      const assignments = kMeans.getClosestCentroidData().slice(0, N);

      // Each centroid should have exactly 1 node
      const counts = new Array(N).fill(0);
      assignments.forEach((c) => counts[c]++);
      expect(counts.every((c) => c === 1)).toBe(true);

      // Each centroid should match its assigned node exactly (within proportional tolerance)
      for (let i = 0; i < N; i++) {
        const centroidID = assignments[i];
        const cx = centroidsData[centroidID * 4];
        const cy = centroidsData[centroidID * 4 + 1];
        expect(cx).toBeCloseTo(nodes[i].x);
        expect(cy).toBeCloseTo(nodes[i].y);
      }
    } finally {
      canvas.remove();
    }
  });

  // Test 4: Error cases - invalid centroid counts
  test("Error: More centroids than nodes", () => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      expect(() => new KMeansGPU(gl, { nodesCount: 5, centroidsCount: 10 })).toThrow(
        "Invalid centroidsCount: 10. Cannot have more centroids than nodes (5).",
      );
    } finally {
      canvas.remove();
    }
  });

  test("Error: Zero centroids", () => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      expect(() => new KMeansGPU(gl, { nodesCount: 10, centroidsCount: 0 })).toThrow(
        "Invalid centroidsCount: 0. Must be greater than 0.",
      );
    } finally {
      canvas.remove();
    }
  });

  test("Error: Negative centroids", () => {
    const { gl, canvas } = setupWebGL2Context();
    try {
      expect(() => new KMeansGPU(gl, { nodesCount: 10, centroidsCount: -5 })).toThrow(
        "Invalid centroidsCount: -5. Must be greater than 0.",
      );
    } finally {
      canvas.remove();
    }
  });
});
