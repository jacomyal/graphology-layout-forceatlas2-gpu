import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getClustersGraph } from "../../utils/graph";
import { calculateNearestNeighborDistances, detectEmptyHalos } from "../../utils/halo-detection";
import { setupWebGL2Context } from "../../utils/webgl";
import { ForceAtlas2Settings } from "./consts";
import { ForceAtlas2GPU, ForceAtlas2Graph } from "./index";

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

describe("ForceAtlas2 GPU - Empty Halo Bug Regression Test", () => {
  const TEST_CONFIG = {
    NODES: 1000,
    EDGES: 5000,
    CLUSTERS: 5,
    CLUSTER_DENSITY: 0.7,
    CENTROIDS: 30,
    K_MEANS_STEPS: 3,
    ITERATIONS: 1000,
    SEED: 42, // Use a fixed seed for deterministic tests
  };

  /**
   * Helper function to test empty halos for a given repulsion configuration
   */
  async function testEmptyHalos(repulsion: ForceAtlas2Settings["repulsion"], repulsionName: string): Promise<void> {
    const { NODES, EDGES, CLUSTERS, CLUSTER_DENSITY, CENTROIDS, ITERATIONS, SEED } = TEST_CONFIG;

    const graph = getClustersGraph(NODES, EDGES, CLUSTERS, CLUSTER_DENSITY, SEED) as ForceAtlas2Graph;

    const fa2 = new ForceAtlas2GPU(graph, {
      repulsion,
      iterationsPerStep: ITERATIONS,
    });

    fa2.start(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    fa2.stop();

    const distances = calculateNearestNeighborDistances(graph);
    const halos = detectEmptyHalos(distances);

    // If the bug exists, we'd see exactly CENTROIDS nodes with empty halos
    // The test expects NO significant empty halos (or at most a few random ones, not exactly CENTROIDS)
    expect(
      halos.count,
      `${repulsionName}: Found ${halos.count} nodes with empty halos. ` +
        `If this equals ${CENTROIDS} (number of centroids), the bug is confirmed. ` +
        `Threshold: ${halos.threshold.toFixed(2)}, Outlier indices: ${halos.outlierIndices.slice(0, 10)}...`,
    ).toBeLessThan(CENTROIDS / 2); // Should be much less than half the centroids count
  }

  test<Test>("k-means repulsion should NOT create empty halos around N nodes", async () => {
    const { CENTROIDS, K_MEANS_STEPS } = TEST_CONFIG;
    await testEmptyHalos({ type: "k-means", centroids: CENTROIDS, steps: K_MEANS_STEPS }, "k-means");
  });

  test<Test>("k-means-grouped repulsion should NOT create empty halos around N nodes", async () => {
    const { CENTROIDS, K_MEANS_STEPS } = TEST_CONFIG;
    await testEmptyHalos({ type: "k-means-grouped", centroids: CENTROIDS, steps: K_MEANS_STEPS }, "k-means-grouped");
  });
});
