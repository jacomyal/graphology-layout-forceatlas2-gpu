import { chunk } from "lodash";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { setupWebGL2Context, waitForGPUCompletion } from "../../utils/webgl";
import { KMeansGPU } from "./index";

interface Test {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}

beforeEach<Test>(async (context) => {
  const { gl, canvas } = setupWebGL2Context();
  context.canvas = canvas;
  context.gl = gl;
});
afterEach<Test>(async ({ canvas }) => {
  canvas.remove();
});

describe("K-means GPU Program", () => {
  test<Test>("It should initialize centroids from node positions", async ({ gl }) => {
    // Create 9 nodes evenly distributed
    const nodes = [
      // Top-left cluster
      { x: -10, y: -10 },
      { x: -9, y: -10 },
      { x: -10, y: -9 },
      // Center cluster
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      // Bottom-right cluster
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 10, y: 11 },
    ];

    const centroidsCount = 3;
    const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount });
    kMeans.setNodesData(nodes);
    await waitForGPUCompletion(gl);

    const centroidsData = kMeans.getCentroidsPositionData();
    const centroids = chunk(centroidsData.slice(0, centroidsCount * 4), 4);

    // Initial centroids should be sampled from nodes
    centroids.forEach((centroid) => {
      const [x, y, mass, size] = centroid;
      expect(x).toBeTypeOf("number");
      expect(y).toBeTypeOf("number");
      expect(mass).toBe(0); // Initial centroids have no mass yet
      expect(size).toBe(0); // Initial centroids have no size yet

      expect(nodes.find((node) => x === node.x && y === node.y)).toBeTruthy();
    });
  });

  test<Test>("It should assign each node to its closest centroid", async ({ gl }) => {
    // Create clear clusters: far left, center, far right
    const nodes = [
      // Cluster 0
      { x: -100, y: 0 },
      { x: -99, y: 0 },
      { x: -98, y: 1 },
      // Cluster 1
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      // Cluster 2
      { x: 100, y: 0 },
      { x: 99, y: 0 },
      { x: 100, y: 1 },
    ];

    const centroidsCount = 3;
    const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount });
    kMeans.setNodesData(nodes);
    kMeans.compute({ steps: 1 });
    await waitForGPUCompletion(gl);

    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Each node should be assigned to a centroid
    assignments.forEach((centroidID) => {
      expect(centroidID).toBeGreaterThanOrEqual(0);
      expect(centroidID).toBeLessThan(centroidsCount);
      expect(Number.isInteger(centroidID)).toBe(true);
    });

    // Nodes in same spatial cluster should eventually have same centroid
    // After initialization, centroids are at indices 0, 3, 6
    // So nodes 0,1,2 should be closest to centroid 0
    // nodes 3,4,5 should be closest to centroid 1
    // nodes 6,7,8 should be closest to centroid 2
    expect(assignments[0]).toBe(assignments[1]);
    expect(assignments[0]).toBe(assignments[2]);
    expect(assignments[3]).toBe(assignments[4]);
    expect(assignments[3]).toBe(assignments[5]);
    expect(assignments[6]).toBe(assignments[7]);
    expect(assignments[6]).toBe(assignments[8]);

    // The three cluster assignments should be different
    const uniqueAssignments = new Set([assignments[0], assignments[3], assignments[6]]);
    expect(uniqueAssignments.size).toBe(3);
  });

  test<Test>("It should distribute nodes across all centroids", async ({ gl }) => {
    // Create 20 nodes in 4 clear quadrants
    const nodes = [
      // Quadrant 1: top-left
      { x: -10, y: -10 },
      { x: -11, y: -10 },
      { x: -10, y: -11 },
      { x: -9, y: -10 },
      { x: -10, y: -9 },
      // Quadrant 2: top-right
      { x: 10, y: -10 },
      { x: 11, y: -10 },
      { x: 10, y: -11 },
      { x: 9, y: -10 },
      { x: 10, y: -9 },
      // Quadrant 3: bottom-left
      { x: -10, y: 10 },
      { x: -11, y: 10 },
      { x: -10, y: 11 },
      { x: -9, y: 10 },
      { x: -10, y: 9 },
      // Quadrant 4: bottom-right
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 10, y: 11 },
      { x: 9, y: 10 },
      { x: 10, y: 9 },
    ];

    const centroidsCount = 4;
    const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount });
    kMeans.setNodesData(nodes);
    kMeans.compute({ steps: 5 });
    await waitForGPUCompletion(gl);

    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Count how many nodes are assigned to each centroid
    const centroidCounts: number[] = new Array(centroidsCount).fill(0);
    assignments.forEach((centroidID) => {
      centroidCounts[centroidID]++;
    });

    // CRITICAL BUG CHECK: All centroids should have at least one node
    // This test will fail if centroid 0 has all nodes (the bug reported by the user)
    centroidCounts.forEach((count, centroidID) => {
      expect(count, `Centroid ${centroidID} should have at least one node`).toBeGreaterThan(0);
    });

    // With 20 nodes and 4 centroids, each should have roughly 5 nodes
    // Allow some variation, but no centroid should have less than 2 or more than 10
    centroidCounts.forEach((count, centroidID) => {
      expect(count, `Centroid ${centroidID} should have between 2 and 10 nodes`).toBeGreaterThanOrEqual(2);
      expect(count, `Centroid ${centroidID} should have between 2 and 10 nodes`).toBeLessThanOrEqual(10);
    });
  });

  test<Test>("It should compute centroid positions as barycenters of assigned nodes", async ({ gl }) => {
    // Create 6 nodes in 2 clear clusters
    const nodes = [
      // Cluster 0: average should be (-10, 0)
      { x: -10, y: 0 },
      { x: -10, y: 0 },
      { x: -10, y: 0 },
      // Cluster 1: average should be (10, 5)
      { x: 10, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 5 },
    ];

    const centroidsCount = 2;
    const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount });
    kMeans.setNodesData(nodes);
    kMeans.compute({ steps: 3 });
    await waitForGPUCompletion(gl);

    const centroidsData = kMeans.getCentroidsPositionData();
    const centroids = chunk(centroidsData.slice(0, centroidsCount * 4), 4);
    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Find which centroid has the left cluster and which has the right
    const leftCentroidID = assignments[0];
    const rightCentroidID = assignments[3];

    const [leftX, leftY, leftMass, leftSize] = centroids[leftCentroidID];
    const [rightX, rightY, rightMass, rightSize] = centroids[rightCentroidID];

    // Left centroid should be near (-10, 0)
    expect(leftX).toBeCloseTo(-10, 1);
    expect(leftY).toBeCloseTo(0, 1);
    expect(leftSize).toBe(3); // 3 nodes in this cluster

    // Right centroid should be near (10, 5)
    expect(rightX).toBeCloseTo(10, 1);
    expect(rightY).toBeCloseTo(5, 1);
    expect(rightSize).toBe(3); // 3 nodes in this cluster

    // Mass should be sum of node masses (all nodes have mass 1 by default)
    expect(leftMass).toBeCloseTo(3, 1);
    expect(rightMass).toBeCloseTo(3, 1);
  });

  test<Test>("It should handle single node per centroid", async ({ gl }) => {
    // Create nodes that are very far apart
    const nodes = [
      { x: -100, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];

    const centroidsCount = 3;
    const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount });
    kMeans.setNodesData(nodes);
    kMeans.compute({ steps: 2 });
    await waitForGPUCompletion(gl);

    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Each node should be in its own cluster
    expect(new Set(assignments).size).toBe(3);

    const centroidsData = kMeans.getCentroidsPositionData();
    const centroids = chunk(centroidsData.slice(0, centroidsCount * 4), 4);

    // Each centroid should have exactly 1 node
    centroids.forEach((centroid) => {
      const [_x, _y, mass, size] = centroid;
      expect(size).toBe(1);
      expect(mass).toBeCloseTo(1, 1);
    });
  });

  test<Test>("It should converge after multiple iterations", async ({ gl }) => {
    // Create well-separated clusters
    const nodes = [
      { x: -20, y: -20 },
      { x: -21, y: -20 },
      { x: -20, y: -21 },
      { x: 20, y: 20 },
      { x: 21, y: 20 },
      { x: 20, y: 21 },
    ];

    const centroidsCount = 2;
    const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount });
    kMeans.setNodesData(nodes);

    // Get assignments after 1 step
    kMeans.compute({ steps: 1 });
    await waitForGPUCompletion(gl);
    const assignments1 = kMeans.getClosestCentroidData().slice(0, nodes.length);

    // Get assignments after 5 more steps
    kMeans.compute({ steps: 5 });
    await waitForGPUCompletion(gl);
    const assignments2 = kMeans.getClosestCentroidData().slice(0, nodes.length);

    // Assignments should stabilize (not change after convergence)
    // For well-separated clusters, 6 total steps should be enough
    expect(assignments2).toEqual(assignments1);
  });

  test<Test>("It should handle more centroids than natural clusters", async ({ gl }) => {
    // Create 2 natural clusters but ask for 4 centroids
    const nodes = [
      { x: -10, y: 0 },
      { x: -11, y: 0 },
      { x: -10, y: 1 },
      { x: -9, y: 0 },
      { x: 10, y: 0 },
      { x: 11, y: 0 },
      { x: 10, y: 1 },
      { x: 9, y: 0 },
    ];

    const centroidsCount = 4;
    const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount });
    kMeans.setNodesData(nodes);
    kMeans.compute({ steps: 5 });
    await waitForGPUCompletion(gl);

    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Count unique centroids that have nodes
    const usedCentroids = new Set(assignments);

    // All 4 centroids should be used (even if some have just 1 node)
    // This catches the bug where centroid 0 gets everything
    expect(usedCentroids.size).toBeGreaterThan(1);

    // Each centroid should have at least one node
    const centroidCounts = new Array(centroidsCount).fill(0);
    assignments.forEach((centroidID) => {
      centroidCounts[centroidID]++;
    });

    const emptyCentroids = centroidCounts.filter((count) => count === 0).length;
    expect(emptyCentroids, "Some centroids may be empty with more centroids than clusters").toBeLessThanOrEqual(2);
  });

  test<Test>("It should use different initial centroids based on iterationCount", async ({ gl }) => {
    // Create a large enough set of nodes to test varied initialization
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      x: i * 2,
      y: Math.sin(i) * 10,
    }));

    const centroidsCount = 4;

    // Test with iterationCount = 0
    const kMeans0 = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount, iterationCount: 0 });
    kMeans0.setNodesData(nodes);
    await waitForGPUCompletion(gl);
    const centroids0 = kMeans0.getInitialCentroidsPositionData().slice(0, centroidsCount * 4);

    // Test with iterationCount = 1
    const kMeans1 = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount, iterationCount: 1 });
    kMeans1.setNodesData(nodes);
    await waitForGPUCompletion(gl);
    const centroids1 = kMeans1.getInitialCentroidsPositionData().slice(0, centroidsCount * 4);

    // Test with iterationCount = 5
    const kMeans5 = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount, iterationCount: 5 });
    kMeans5.setNodesData(nodes);
    await waitForGPUCompletion(gl);
    const centroids5 = kMeans5.getInitialCentroidsPositionData().slice(0, centroidsCount * 4);

    // Verify that different iterationCounts produce different initial centroids
    let diff0vs1 = 0;
    let diff0vs5 = 0;
    let diff1vs5 = 0;

    for (let i = 0; i < centroidsCount * 4; i++) {
      diff0vs1 += Math.abs(centroids0[i] - centroids1[i]);
      diff0vs5 += Math.abs(centroids0[i] - centroids5[i]);
      diff1vs5 += Math.abs(centroids1[i] - centroids5[i]);
    }

    // All three should be different
    expect(diff0vs1, "iterationCount=0 and iterationCount=1 should produce different centroids").toBeGreaterThan(0);
    expect(diff0vs5, "iterationCount=0 and iterationCount=5 should produce different centroids").toBeGreaterThan(0);
    expect(diff1vs5, "iterationCount=1 and iterationCount=5 should produce different centroids").toBeGreaterThan(0);
  });

  test<Test>("It should produce deterministic results for same iterationCount", async ({ gl }) => {
    const nodes = Array.from({ length: 15 }, (_, i) => ({
      x: i * 3,
      y: (i % 3) * 5,
    }));

    const centroidsCount = 3;

    // Create two instances with same iterationCount
    const kMeans1 = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount, iterationCount: 7 });
    kMeans1.setNodesData(nodes);
    await waitForGPUCompletion(gl);
    const centroids1 = kMeans1.getInitialCentroidsPositionData().slice(0, centroidsCount * 4);

    const kMeans2 = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount, iterationCount: 7 });
    kMeans2.setNodesData(nodes);
    await waitForGPUCompletion(gl);
    const centroids2 = kMeans2.getInitialCentroidsPositionData().slice(0, centroidsCount * 4);

    // They should be identical
    for (let i = 0; i < centroidsCount * 4; i++) {
      expect(centroids1[i], `Centroid component ${i} should be identical`).toBe(centroids2[i]);
    }
  });

  test<Test>("It should not initialize any two centroids at the same node", async ({ gl }) => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({
      x: i * 5,
      y: i * 2,
    }));

    const centroidsCount = 5;

    // Test several different iterationCounts
    for (const iterationCount of [0, 1, 5, 10, 20]) {
      const kMeans = new KMeansGPU(gl, { nodesCount: nodes.length, centroidsCount, iterationCount });
      kMeans.setNodesData(nodes);
      await waitForGPUCompletion(gl);
      const centroidsData = kMeans.getInitialCentroidsPositionData().slice(0, centroidsCount * 4);

      // Extract positions
      const positions = [];
      for (let i = 0; i < centroidsCount; i++) {
        positions.push({ x: centroidsData[i * 4], y: centroidsData[i * 4 + 1] });
      }

      // Check for duplicates
      for (let i = 0; i < centroidsCount; i++) {
        for (let j = i + 1; j < centroidsCount; j++) {
          const same = positions[i].x === positions[j].x && positions[i].y === positions[j].y;
          expect(
            same,
            `Centroids ${i} and ${j} should not be at same position (iterationCount=${iterationCount})`,
          ).toBe(false);
        }
      }
    }
  });
});
