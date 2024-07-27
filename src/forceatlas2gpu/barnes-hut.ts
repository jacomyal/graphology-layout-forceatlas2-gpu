import Graph from "graphology";

import {
  ATTRIBUTES_PER_REGION,
  MAX_SUBDIVISION_ATTEMPTS,
  REGION_CENTER_X,
  REGION_CENTER_Y,
  REGION_FIRST_CHILD,
  REGION_MASS,
  REGION_MASS_CENTER_X,
  REGION_MASS_CENTER_Y,
  REGION_NEXT_SIBLING,
  REGION_NODE,
  REGION_SIZE,
} from "./consts";

/**
 * This function takes a graph and a record with nodes index and masses, and
 * returns a flat matrix of Barnes-Hut regions.
 */
export function getBarnesHutQuadTree(
  graph: Graph,
  nodesDataCache: Record<
    string,
    {
      index: number;
      mass: number;
    }
  >,
): Float32Array {
  const regions = [];
  const nodes = graph.nodes();

  // Setting up
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Computing min and max values
  graph.forEachNode((n, { x, y }) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  // Squarify bounds, it's a quadtree
  const dx = maxX - minX;
  const dy = maxY - minY;
  if (dx > dy) {
    minY -= (dx - dy) / 2;
    maxY = minY + dx;
  } else {
    minX -= (dy - dx) / 2;
    maxX = minX + dy;
  }

  // Build the Barnes Hut root region
  let regionIndex = 0;
  let regionMatrixIndex = regionIndex * ATTRIBUTES_PER_REGION;
  regions[regionMatrixIndex + REGION_NODE] = -1;
  regions[regionMatrixIndex + REGION_CENTER_X] = (minX + maxX) / 2;
  regions[regionMatrixIndex + REGION_CENTER_Y] = (minY + maxY) / 2;
  regions[regionMatrixIndex + REGION_SIZE] = Math.max(maxX - minX, maxY - minY);
  regions[regionMatrixIndex + REGION_NEXT_SIBLING] = -1;
  regions[regionMatrixIndex + REGION_FIRST_CHILD] = -1;
  regions[regionMatrixIndex + REGION_MASS] = 0;
  regions[regionMatrixIndex + REGION_MASS_CENTER_X] = 0;
  regions[regionMatrixIndex + REGION_MASS_CENTER_Y] = 0;

  // Add each node in the tree
  let regionsCount = 1;
  graph.forEachNode((n, { x: nodeX, y: nodeY }) => {
    const { mass: nodeMass, index: nodeIndex } = nodesDataCache[n];

    // Current region, starting with root
    regionIndex = 0;
    regionMatrixIndex = regionIndex * ATTRIBUTES_PER_REGION;

    let quadrantIndex: number;
    let subdivisionAttempts = MAX_SUBDIVISION_ATTEMPTS;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Are there sub-regions? We look at first child index

      // There are sub-regions
      if (regions[regionMatrixIndex + REGION_FIRST_CHILD] >= 0) {
        // We just iterate to find a "leaf" of the tree
        // that is an empty region or a region with a single node
        // (see next case)

        // Find the quadrant of n
        if (nodeX < regions[regionMatrixIndex + REGION_CENTER_X]) {
          if (nodeY < regions[regionMatrixIndex + REGION_CENTER_Y]) {
            // Top Left quarter
            quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD];
          } else {
            // Bottom Left quarter
            quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 1;
          }
        } else {
          if (nodeY < regions[regionMatrixIndex + REGION_CENTER_Y]) {
            // Top Right quarter
            quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 2;
          } else {
            // Bottom Right quarter
            quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 3;
          }
        }

        // Update center of mass and mass (we only do it for non-leave regions)
        regions[regionMatrixIndex + REGION_MASS_CENTER_X] =
          (regions[regionMatrixIndex + REGION_MASS_CENTER_X] * regions[regionMatrixIndex + REGION_MASS] +
            nodeX * nodeMass) /
          (regions[regionMatrixIndex + REGION_MASS] + nodeMass);

        regions[regionMatrixIndex + REGION_MASS_CENTER_Y] =
          (regions[regionMatrixIndex + REGION_MASS_CENTER_Y] * regions[regionMatrixIndex + REGION_MASS] +
            nodeY * nodeMass) /
          (regions[regionMatrixIndex + REGION_MASS] + nodeMass);

        regions[regionMatrixIndex + REGION_MASS] += nodeMass;

        // Iterate on the right quadrant
        regionIndex = quadrantIndex;
        regionMatrixIndex = regionIndex * ATTRIBUTES_PER_REGION;
      }

      // There are no sub-regions: we are in a "leaf"
      else {
        // Is there a node in this leave?

        // There is no node in region:
        // we record node n and go on
        if (regions[regionMatrixIndex + REGION_NODE] < 0) {
          regions[regionMatrixIndex + REGION_NODE] = nodeIndex;
          break;
        }

        // There is a node in this region
        else {
          const nodeID = nodes[regions[regionMatrixIndex + REGION_NODE]];
          const { x: otherNodeX, y: otherNodeY } = graph.getNodeAttributes(nodeID);
          const { mass: otherNodeMass } = nodesDataCache[nodeID];

          // We will need to create sub-regions, stick the two
          // nodes (the old one r[0] and the new one n) in two
          // subregions. If they fall in the same quadrant,
          // we will iterate.

          // Create sub-regions
          regions[regionMatrixIndex + REGION_FIRST_CHILD] = regionsCount;
          const size = regions[regionMatrixIndex + REGION_SIZE] / 2; // new size (half)

          // NOTE: we use screen coordinates
          // from Top Left to Bottom Right

          // Top Left sub-region
          let childRegionIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD];
          let childRegionMatrixIndex = childRegionIndex * ATTRIBUTES_PER_REGION;

          regions[childRegionMatrixIndex + REGION_NODE] = -1;
          regions[childRegionMatrixIndex + REGION_CENTER_X] = regions[regionMatrixIndex + REGION_CENTER_X] - size;
          regions[childRegionMatrixIndex + REGION_CENTER_Y] = regions[regionMatrixIndex + REGION_CENTER_Y] - size;
          regions[childRegionMatrixIndex + REGION_SIZE] = size;
          regions[childRegionMatrixIndex + REGION_NEXT_SIBLING] = childRegionIndex + 1;
          regions[childRegionMatrixIndex + REGION_FIRST_CHILD] = -1;
          regions[childRegionMatrixIndex + REGION_MASS] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_X] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_Y] = 0;

          // Bottom Left sub-region
          childRegionIndex++;
          childRegionMatrixIndex = childRegionIndex * ATTRIBUTES_PER_REGION;
          regions[childRegionMatrixIndex + REGION_NODE] = -1;
          regions[childRegionMatrixIndex + REGION_CENTER_X] = regions[regionMatrixIndex + REGION_CENTER_X] - size;
          regions[childRegionMatrixIndex + REGION_CENTER_Y] = regions[regionMatrixIndex + REGION_CENTER_Y] + size;
          regions[childRegionMatrixIndex + REGION_SIZE] = size;
          regions[childRegionMatrixIndex + REGION_NEXT_SIBLING] = childRegionIndex + 1;
          regions[childRegionMatrixIndex + REGION_FIRST_CHILD] = -1;
          regions[childRegionMatrixIndex + REGION_MASS] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_X] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_Y] = 0;

          // Top Right sub-region
          childRegionIndex++;
          childRegionMatrixIndex = childRegionIndex * ATTRIBUTES_PER_REGION;
          regions[childRegionMatrixIndex + REGION_NODE] = -1;
          regions[childRegionMatrixIndex + REGION_CENTER_X] = regions[regionMatrixIndex + REGION_CENTER_X] + size;
          regions[childRegionMatrixIndex + REGION_CENTER_Y] = regions[regionMatrixIndex + REGION_CENTER_Y] - size;
          regions[childRegionMatrixIndex + REGION_SIZE] = size;
          regions[childRegionMatrixIndex + REGION_NEXT_SIBLING] = childRegionIndex + 1;
          regions[childRegionMatrixIndex + REGION_FIRST_CHILD] = -1;
          regions[childRegionMatrixIndex + REGION_MASS] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_X] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_Y] = 0;

          // Bottom Right sub-region
          childRegionIndex++;
          childRegionMatrixIndex = childRegionIndex * ATTRIBUTES_PER_REGION;
          regions[childRegionMatrixIndex + REGION_NODE] = -1;
          regions[childRegionMatrixIndex + REGION_CENTER_X] = regions[regionMatrixIndex + REGION_CENTER_X] + size;
          regions[childRegionMatrixIndex + REGION_CENTER_Y] = regions[regionMatrixIndex + REGION_CENTER_Y] + size;
          regions[childRegionMatrixIndex + REGION_SIZE] = size;
          regions[childRegionMatrixIndex + REGION_NEXT_SIBLING] = regions[regionMatrixIndex + REGION_NEXT_SIBLING];
          regions[childRegionMatrixIndex + REGION_FIRST_CHILD] = -1;
          regions[childRegionMatrixIndex + REGION_MASS] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_X] = 0;
          regions[childRegionMatrixIndex + REGION_MASS_CENTER_Y] = 0;

          regionsCount += 4;

          // Now the goal is to find two different sub-regions
          // for the two nodes: the one previously recorded (r[0])
          // and the one we want to add (n)

          // Find the quadrant of the old node
          if (otherNodeX < regions[regionMatrixIndex + REGION_CENTER_X]) {
            if (otherNodeY < regions[regionMatrixIndex + REGION_CENTER_Y]) {
              // Top Left quarter
              quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD];
            } else {
              // Bottom Left quarter
              quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 1;
            }
          } else {
            if (otherNodeY < regions[regionMatrixIndex + REGION_CENTER_Y]) {
              // Top Right quarter
              quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 2;
            } else {
              // Bottom Right quarter
              quadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 3;
            }
          }

          // We remove r[0] from the region r, add its mass to r and record it in q
          regions[regionMatrixIndex + REGION_MASS] = otherNodeMass;
          regions[regionMatrixIndex + REGION_MASS_CENTER_X] = otherNodeX;
          regions[regionMatrixIndex + REGION_MASS_CENTER_Y] = otherNodeY;

          const quadrantMatrixIndex = quadrantIndex * ATTRIBUTES_PER_REGION;
          regions[quadrantMatrixIndex + REGION_NODE] = regions[regionMatrixIndex + REGION_NODE];
          regions[regionMatrixIndex + REGION_NODE] = -1;

          // Find the quadrant of n
          let nodeQuadrantIndex: number;
          if (nodeX < regions[regionMatrixIndex + REGION_CENTER_X]) {
            if (nodeY < regions[regionMatrixIndex + REGION_CENTER_Y]) {
              // Top Left quarter
              nodeQuadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD];
            } else {
              // Bottom Left quarter
              nodeQuadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 1;
            }
          } else {
            if (nodeY < regions[regionMatrixIndex + REGION_CENTER_Y]) {
              // Top Right quarter
              nodeQuadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 2;
            } else {
              // Bottom Right quarter
              nodeQuadrantIndex = regions[regionMatrixIndex + REGION_FIRST_CHILD] + 3;
            }
          }

          if (quadrantIndex === nodeQuadrantIndex) {
            // If both nodes are in the same quadrant,
            // we have to try it again on this quadrant
            if (subdivisionAttempts-- > 0) {
              regionIndex = quadrantIndex;
              regionMatrixIndex = regionIndex * ATTRIBUTES_PER_REGION;
              continue;
            } else {
              // we are out of precision here, and we cannot subdivide anymore
              // but we have to break the loop anyway
              subdivisionAttempts = MAX_SUBDIVISION_ATTEMPTS;
              break;
            }
          }

          // If both quadrants are different, we record n
          // in its quadrant
          const nodeQuadrantMatrixIndex = nodeQuadrantIndex * ATTRIBUTES_PER_REGION;
          regions[nodeQuadrantMatrixIndex + REGION_NODE] = nodeIndex;
          break;
        }
      }
    }
  });

  return new Float32Array(regions);
}
