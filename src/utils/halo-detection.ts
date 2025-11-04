import { mean } from "lodash";

import { ForceAtlas2Graph } from "../programs/forceAtlas2GPU";

/**
 * Helper to calculate nearest neighbor distance for each node
 */
export function calculateNearestNeighborDistances(graph: ForceAtlas2Graph): number[] {
  const distances: number[] = [];

  graph.forEachNode((node, { x, y }) => {
    let minDistance = Infinity;

    graph.forEachNode((otherNode, { x: otherX, y: otherY }) => {
      if (node === otherNode) return;

      const dx = x - otherX;
      const dy = y - otherY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
      }
    });

    distances.push(minDistance);
  });

  return distances;
}

/**
 * Detects nodes with empty halos (unusually large nearest neighbor distances).
 *
 * A node has an empty halo when its nearest neighbor distance is significantly
 * higher than the average nearest neighbor distance across all nodes.
 * This indicates excessive repulsion or isolation around that node.
 *
 * @param distances - Array of nearest neighbor distances for each node
 * @param thresholdMultiplier - How many times the average distance to consider as a halo (default: 2.0)
 * @returns Object containing count, threshold, and indices of nodes with halos
 */
export function detectEmptyHalos(
  distances: number[],
  thresholdMultiplier: number = 2.0,
): {
  count: number;
  threshold: number;
  outlierIndices: number[];
} {
  const avgDistance = mean(distances);

  // A node has an empty halo if its nearest neighbor is more than
  // thresholdMultiplier times farther than the average
  const threshold = avgDistance * thresholdMultiplier;
  const outlierIndices: number[] = [];

  distances.forEach((distance, index) => {
    if (distance > threshold) {
      outlierIndices.push(index);
    }
  });

  return {
    count: outlierIndices.length,
    threshold,
    outlierIndices,
  };
}
