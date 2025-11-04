import { chunk } from "lodash";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { setupWebGL2Context, waitForGPUCompletion } from "../../utils/webgl";
import { KMeansGroupedGPU } from "./index";

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

describe("K-means Grouped GPU Program", () => {
  test<Test>("It should initialize and compute k-means clustering", async ({ gl }) => {
    // Create 9 nodes in 3 clear clusters
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
    const kMeansGrouped = new KMeansGroupedGPU(gl, { nodesCount: nodes.length, centroidsCount, debug: true });

    const kMeans = kMeansGrouped.getKMeans();
    kMeans.setNodesData(nodes);

    kMeansGrouped.initialize();
    kMeansGrouped.compute({ steps: 3 });
    await waitForGPUCompletion(gl);

    // Test that closest centroid data is valid
    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Each node should be assigned to a valid centroid
    assignments.forEach((centroidID, nodeIdx) => {
      expect(centroidID, `Node ${nodeIdx} should have valid centroid`).toBeGreaterThanOrEqual(0);
      expect(centroidID, `Node ${nodeIdx} should have valid centroid`).toBeLessThan(centroidsCount);
      expect(Number.isInteger(centroidID), `Node ${nodeIdx} centroid should be integer`).toBe(true);
    });

    // Test that all centroids are used
    const usedCentroids = new Set(assignments);
    expect(usedCentroids.size, "All centroids should be used").toBe(centroidsCount);
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
    const kMeansGrouped = new KMeansGroupedGPU(gl, { nodesCount: nodes.length, centroidsCount, debug: true });

    const kMeans = kMeansGrouped.getKMeans();
    kMeans.setNodesData(nodes);

    kMeansGrouped.initialize();
    kMeansGrouped.compute({ steps: 5 });
    await waitForGPUCompletion(gl);

    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Count how many nodes are assigned to each centroid
    const centroidCounts = new Array(centroidsCount).fill(0);
    assignments.forEach((centroidID) => {
      centroidCounts[centroidID]++;
    });

    // All centroids should have at least one node
    centroidCounts.forEach((count, centroidID) => {
      expect(count, `Centroid ${centroidID} should have at least one node`).toBeGreaterThan(0);
    });

    // With 20 nodes and 4 centroids, each should have roughly 5 nodes
    centroidCounts.forEach((count, centroidID) => {
      expect(count, `Centroid ${centroidID} should have between 2 and 10 nodes`).toBeGreaterThanOrEqual(2);
      expect(count, `Centroid ${centroidID} should have between 2 and 10 nodes`).toBeLessThanOrEqual(10);
    });
  });

  test<Test>("It should compute valid centroid offsets", async ({ gl }) => {
    // Create 12 nodes in 3 clear clusters
    const nodes = [
      // Cluster 0 (4 nodes)
      { x: -20, y: 0 },
      { x: -21, y: 0 },
      { x: -20, y: 1 },
      { x: -19, y: 0 },
      // Cluster 1 (5 nodes)
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      // Cluster 2 (3 nodes)
      { x: 20, y: 0 },
      { x: 21, y: 0 },
      { x: 20, y: 1 },
    ];

    const centroidsCount = 3;
    const kMeansGrouped = new KMeansGroupedGPU(gl, { nodesCount: nodes.length, centroidsCount, debug: true });

    const kMeans = kMeansGrouped.getKMeans();
    kMeans.setNodesData(nodes);

    kMeansGrouped.initialize();
    kMeansGrouped.compute({ steps: 5 });
    await waitForGPUCompletion(gl);

    // Get offsets texture data
    const offsetProgram = kMeansGrouped.getOffsetProgram();
    const offsetsData = offsetProgram.getOutput("centroidsOffsets");

    const offsets = chunk(offsetsData.slice(0, centroidsCount * 2), 2);

    // Verify offsets are valid
    let totalNodes = 0;
    offsets.forEach(([count, offset], centroidID) => {
      // Count and offset should be non-negative
      expect(count, `Centroid ${centroidID} count should be non-negative`).toBeGreaterThanOrEqual(0);
      expect(offset, `Centroid ${centroidID} offset should be non-negative`).toBeGreaterThanOrEqual(0);

      // Count should be at least 1 (all centroids should have nodes)
      expect(count, `Centroid ${centroidID} should have at least one node`).toBeGreaterThan(0);

      // Offset + count should not exceed total nodes
      expect(offset + count, `Centroid ${centroidID} offset+count should not exceed total`).toBeLessThanOrEqual(
        nodes.length,
      );

      totalNodes += count;
    });

    // Total count across all centroids should equal number of nodes
    expect(totalNodes, "Total nodes in centroids should match input").toBe(nodes.length);
  });

  test<Test>("It should sort nodes by centroid ID", async ({ gl }) => {
    // Create nodes in clear clusters
    const nodes = [
      { x: -30, y: 0 },
      { x: -31, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 30, y: 0 },
      { x: 31, y: 0 },
    ];

    const centroidsCount = 3;
    const kMeansGrouped = new KMeansGroupedGPU(gl, { nodesCount: nodes.length, centroidsCount, debug: true });

    const kMeans = kMeansGrouped.getKMeans();
    kMeans.setNodesData(nodes);

    kMeansGrouped.initialize();
    kMeansGrouped.compute({ steps: 5 });
    await waitForGPUCompletion(gl);

    // Get sorted nodes
    const bitonicSort = kMeansGrouped.getBitonicSort();
    const sortedNodesData = bitonicSort.getSortedValues();
    const sortedNodes = sortedNodesData.slice(0, nodes.length);

    // Get closest centroid assignments
    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // Verify all node indices are present in sorted array
    const sortedSet = new Set(sortedNodes);
    for (let i = 0; i < nodes.length; i++) {
      expect(sortedSet.has(i), `Node ${i} should appear in sorted array`).toBe(true);
    }

    // Verify sorted array is sorted by centroid ID
    let lastCentroidID = -1;
    for (let i = 0; i < nodes.length; i++) {
      const nodeIdx = sortedNodes[i];
      const centroidID = assignments[nodeIdx];

      expect(centroidID, `Centroid ID should be non-decreasing in sorted array`).toBeGreaterThanOrEqual(lastCentroidID);
      lastCentroidID = centroidID;
    }
  });

  test<Test>("It should maintain consistency between sorted array and offsets", async ({ gl }) => {
    // Create nodes in distinct clusters
    const nodes = [
      // Cluster 0
      { x: -40, y: 0 },
      { x: -41, y: 0 },
      { x: -40, y: 1 },
      // Cluster 1
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      // Cluster 2
      { x: 40, y: 0 },
      { x: 41, y: 0 },
      { x: 40, y: 1 },
      { x: 39, y: 0 },
    ];

    const centroidsCount = 3;
    const kMeansGrouped = new KMeansGroupedGPU(gl, { nodesCount: nodes.length, centroidsCount, debug: true });

    const kMeans = kMeansGrouped.getKMeans();
    kMeans.setNodesData(nodes);

    kMeansGrouped.initialize();
    kMeansGrouped.compute({ steps: 5 });
    await waitForGPUCompletion(gl);

    // Get data
    const offsetProgram = kMeansGrouped.getOffsetProgram();
    const offsetsData = offsetProgram.getOutput("centroidsOffsets");
    const offsets = chunk(offsetsData.slice(0, centroidsCount * 2), 2);

    const bitonicSort = kMeansGrouped.getBitonicSort();
    const sortedNodesData = bitonicSort.getSortedValues();
    const sortedNodes = sortedNodesData.slice(0, nodes.length);

    const closestCentroidData = kMeans.getClosestCentroidData();
    const assignments = closestCentroidData.slice(0, nodes.length);

    // For each centroid, verify its offset range contains the right nodes
    offsets.forEach(([count, offset], centroidID) => {
      for (let i = 0; i < count; i++) {
        const sortedIdx = offset + i;
        const nodeIdx = sortedNodes[sortedIdx];
        const nodeCentroid = assignments[nodeIdx];

        expect(nodeCentroid, `Node at sorted position ${sortedIdx} should belong to centroid ${centroidID}`).toBe(
          centroidID,
        );
      }
    });
  });
});
