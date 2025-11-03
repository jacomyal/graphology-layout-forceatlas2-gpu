import { UndirectedGraph } from "graphology";
import clusters from "graphology-generators/random/clusters";
import random from "graphology-layout/random";
import { mean, sortBy, sum } from "lodash";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

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

/**
 * Creates a graph with multiple clusters
 */
function createClusteredGraph(
  order: number,
  size: number,
  clustersCount: number,
  clusterDensity: number,
): ForceAtlas2Graph {
  const graph = clusters(UndirectedGraph, { size, order, clusters: clustersCount, clusterDensity });
  random.assign(graph, {
    scale: 1000,
    center: 0,
  });

  graph.forEachNode((node) => {
    graph.mergeNodeAttributes(node, {
      size: graph.degree(node) / 3,
    });
  });

  return graph as ForceAtlas2Graph;
}

/**
 * Tests if a distribution is approximately normal by checking:
 * 1. No extreme skewness (vertical strip bug would cause bimodal or clustered patterns)
 * 2. Reasonable spread (68-95-99.7 rule loosely applied)
 * 3. No extreme outliers (like node 1 being pushed far away)
 * 4. Uniform distribution across bins (to detect vertical strips)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNormalDistribution(values: number[]): { isNormal: boolean; stats: any } {
  const n = values.length;
  const avg = mean(values);
  const variance = sum(values.map((v) => Math.pow(v - avg, 2))) / n;
  const stdDev = Math.sqrt(variance);

  // Calculate skewness
  const skewness = sum(values.map((v) => Math.pow((v - avg) / stdDev, 3))) / n;

  // Calculate kurtosis
  const kurtosis = sum(values.map((v) => Math.pow((v - avg) / stdDev, 4))) / n;
  const excessKurtosis = kurtosis - 3;

  // Check 68-95-99.7 rule (loosely)
  const within1Std = values.filter((v) => Math.abs(v - avg) <= stdDev).length / n;
  const within2Std = values.filter((v) => Math.abs(v - avg) <= 2 * stdDev).length / n;
  const within3Std = values.filter((v) => Math.abs(v - avg) <= 3 * stdDev).length / n;

  // Check for vertical strip bug: divide range into 10 bins and check distribution
  const sorted = sortBy(values);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;
  const binCount = 10;
  const binSize = range / binCount;
  const bins = new Array(binCount).fill(0);

  values.forEach((v) => {
    const binIndex = Math.min(Math.floor((v - min) / binSize), binCount - 1);
    bins[binIndex]++;
  });

  // Calculate coefficient of variation of bin counts
  // If there are vertical strips, some bins will have many more nodes than others
  const binMean = n / binCount;
  const binVariance = sum(bins.map((count) => Math.pow(count - binMean, 2))) / binCount;
  const binStdDev = Math.sqrt(binVariance);
  const binCV = binStdDev / binMean; // Coefficient of variation

  // Check for extreme outliers (like node 1 repelling everything)
  const extremeOutliers = values.filter((v) => Math.abs(v - avg) > 4 * stdDev).length;

  const stats = {
    mean: avg,
    stdDev,
    skewness,
    excessKurtosis,
    within1Std,
    within2Std,
    within3Std,
    binCV,
    extremeOutliers,
    bins,
  };

  // Relaxed normality criteria to detect obvious bugs:
  // 1. Skewness not too extreme (< 2 in absolute value)
  // 2. Not too many extreme outliers (< 1% of nodes beyond 4 std devs)
  // 3. Bins should be relatively uniform (CV < 0.5 means no severe clustering)
  // 4. Reasonable spread (at least 50% within 1 std, at least 90% within 2 std)
  const isNormal =
    Math.abs(skewness) < 2 &&
    extremeOutliers < n * 0.01 &&
    binCV < 0.5 &&
    within1Std > 0.5 &&
    within2Std > 0.9 &&
    within3Std > 0.97;

  return { isNormal, stats };
}

describe.skip("ForceAtlas2 GPU - Distribution Regression Tests", () => {
  const NODES = 500;
  const EDGES = 5000;
  const CLUSTERS = 10;
  const CLUSTER_DENSITY = 0.7;
  const ITERATIONS = 500;

  /**
   * Helper function to test a specific repulsion configuration
   */
  async function testRepulsionDistribution(
    repulsion: ForceAtlas2Settings["repulsion"],
    repulsionName: string,
  ): Promise<void> {
    const graph = createClusteredGraph(NODES, EDGES, CLUSTERS, CLUSTER_DENSITY);

    const fa2 = new ForceAtlas2GPU(graph, {
      repulsion,
      iterationsPerStep: ITERATIONS,
    });

    fa2.start(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    fa2.stop();

    const xValues: number[] = [];
    const yValues: number[] = [];

    graph.forEachNode((_node, { x, y }) => {
      xValues.push(x);
      yValues.push(y);
    });

    const xTest = isNormalDistribution(xValues);
    const yTest = isNormalDistribution(yValues);

    expect(
      xTest.isNormal,
      `${repulsionName}: X distribution failed normality test: ${JSON.stringify(xTest.stats)}`,
    ).toBe(true);
    expect(
      yTest.isNormal,
      `${repulsionName}: Y distribution failed normality test: ${JSON.stringify(yTest.stats)}`,
    ).toBe(true);
  }

  test<Test>("all-pairs repulsion produces normal distribution", async () => {
    await testRepulsionDistribution({ type: "all-pairs" }, "all-pairs");
  });

  test<Test>("quad-tree repulsion produces normal distribution", async () => {
    await testRepulsionDistribution({ type: "quad-tree", depth: 3, theta: 1.2 }, "quad-tree");
  });

  test<Test>("k-means repulsion produces normal distribution", async () => {
    await testRepulsionDistribution({ type: "k-means", centroids: 50, steps: 5 }, "k-means");
  });

  test<Test>("k-means-grouped repulsion produces normal distribution", async () => {
    await testRepulsionDistribution({ type: "k-means-grouped", centroids: 50, steps: 5 }, "k-means-grouped");
  });
});
