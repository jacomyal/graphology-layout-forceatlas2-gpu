import Graph, { UndirectedGraph } from "graphology";
import clusters from "graphology-generators/random/clusters";
import random from "graphology-layout/random";

/**
 * Simple seeded random number generator using mulberry32
 */
function seededRandom(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a clustered graph with random positions.
 * This is the same function used in the example.
 *
 * @param order - Number of nodes
 * @param size - Number of edges
 * @param clustersCount - Number of clusters
 * @param clusterDensity - Density within clusters (0-1)
 * @param seed - Optional seed for deterministic graph generation
 */
export function getClustersGraph(
  order: number,
  size: number,
  clustersCount: number,
  clusterDensity: number,
  seed?: number,
): Graph {
  // If seed is provided, temporarily replace Math.random
  const originalRandom = Math.random;
  if (seed !== undefined) {
    Math.random = seededRandom(seed);
  }

  try {
    const graph = clusters(UndirectedGraph, { size, order, clusters: clustersCount, clusterDensity });
    random.assign(graph, {
      scale: 1000,
      center: 0,
    });

    const colors: Record<string, string> = {};
    for (let i = 0; i < clustersCount; i++) {
      colors[i] = "#" + Math.floor(Math.random() * 16777215).toString(16);
    }

    let i = 0;
    graph.forEachNode((node, { cluster }) => {
      graph.mergeNodeAttributes(node, {
        size: graph.degree(node) / 3,
        label: `Node n°${++i}, in cluster n°${cluster}`,
        color: colors[cluster + ""],
      });
    });

    return graph;
  } finally {
    // Restore original Math.random
    if (seed !== undefined) {
      Math.random = originalRandom;
    }
  }
}
