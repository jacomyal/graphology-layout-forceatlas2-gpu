import { chunk, flatten, range } from "lodash";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getMortonIdDepth, getRegionsCount } from "../../utils/quadtree";
import { setupWebGL2Context, waitForGPUCompletion } from "../../utils/webgl";
import { QuadTreeGPU, QuadTreeNode } from "./index";

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

describe("Quad-tree GPU Program", () => {
  test<Test>("It should properly index the points", async ({ gl }) => {
    const depth = 3;
    const regionsCount = getRegionsCount(depth);

    // Nodes are on a [-16,16]x[0,8] rectangle:
    const nodes: QuadTreeNode[] = [
      { x: -16, y: 0 }, // Top-left
      { x: 16, y: 0 }, // Top-right
      { x: -16, y: 8 }, // Bottom-left

      { x: -2, y: 3.5, mass: 2 }, // Just top-left of center
      { x: 2, y: 4.5, mass: 3 }, // Just bottom-right of center
      { x: -6, y: 2.5, mass: 4 }, // Just bottom-right of center of top-left quadrant
    ];

    // Index nodes in the quad-tree:
    const quadTree = new QuadTreeGPU(gl, { nodesCount: nodes.length }, { depth });
    quadTree.setNodesData(nodes);
    quadTree.compute();
    await waitForGPUCompletion(gl);

    // Check boundaries:
    const expectedBoundaries = [-16, 16, 0, 8];
    expect(quadTree.getBoundaries()).toEqual(expectedBoundaries);

    // Check nodes regions:
    // Those are filled by hand, using this grid as reference:
    // - First level:
    //   0, 1
    //   2, 3
    // - Second level:
    //    4,  5,  8,  9
    //    6,  7, 10, 11
    //   12, 13, 16, 17
    //   14, 15, 18, 19
    // - Third level:
    //   20, 21, 24, 25, 36, 37, 40, 41
    //   22, 23, 26, 27, 38, 39, 42, 43
    //   28, 29, 32, 33, 44, 45, 48, 49
    //   30, 31, 34, 35, 46, 47, 50, 51
    //   52, 53, 56, 57, 68, 69, 72, 73
    //   54, 55, 58, 59, 70, 71, 74, 75
    //   60, 61, 64, 65, 76, 77, 80, 81
    //   62, 63, 66, 67, 78, 79, 82, 83
    const expectedNodesRegions = [
      // Corner points:
      [0, 4, 20],
      [1, 9, 41],
      [2, 14, 62],

      // Additional points:
      [0, 7, 35],
      [3, 16, 68],
      [0, 7, 32],
    ];
    expect(quadTree.getNodesRegions().slice(0, nodes.length * 4)).toEqual(
      flatten(expectedNodesRegions.map((arr) => arr.concat(0))),
    );

    // Check barycenters:
    const expectedRegionsBarycenter = range(regionsCount).map((regionId) => {
      const regionDepth = getMortonIdDepth(regionId);
      const barycenter: QuadTreeNode & { nodesCount: number } = {
        x: 0,
        y: 0,
        mass: 0,
        nodesCount: 0,
      };

      // Find all nodes in the region:
      const nodesInRegion = nodes.filter((_, index) => expectedNodesRegions[index][regionDepth - 1] === regionId);
      const extents = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
      nodesInRegion.forEach(({ x, y, mass }) => {
        mass = mass || 1;
        barycenter.x += x * mass;
        barycenter.y += y * mass;
        barycenter.mass = (barycenter.mass || 0) + mass;
        extents.x[0] = Math.min(extents.x[0], x);
        extents.x[1] = Math.max(extents.x[1], x);
        extents.y[0] = Math.min(extents.y[0], y);
        extents.y[1] = Math.max(extents.y[1], y);
      });

      if (barycenter.mass) {
        barycenter.x /= barycenter.mass;
        barycenter.y /= barycenter.mass;
        barycenter.nodesCount = nodesInRegion.length;
      }

      return barycenter;
    });
    expect(chunk(quadTree.getRegionsBarycenters().slice(0, regionsCount * 4), 4)).toEqual(
      expectedRegionsBarycenter.map((barycenter) => [
        expect.closeTo(barycenter.x, 3),
        expect.closeTo(barycenter.y, 3),
        barycenter.mass,
        barycenter.nodesCount,
      ]),
    );

    // Check offsets:
    let offset = 0;
    const expectedOffsets = expectedRegionsBarycenter.map(({ nodesCount }, regionId) => {
      const regionDepth = getMortonIdDepth(regionId);
      const res = [nodesCount, offset];
      if (regionDepth === depth) offset += nodesCount;
      return res;
    });
    const allRegionsOffsetData = quadTree.getRegionsOffsets();
    const regionsOffsets = range(0, regionsCount).map((i) => [
      allRegionsOffsetData[i * 2],
      allRegionsOffsetData[i * 2 + 1],
    ]);

    expect(regionsOffsets).toEqual(expectedOffsets);

    // Check sorted node IDs:
    const sortedNodeIDs = quadTree.getNodesInRegions().slice(nodes.length);
    expectedOffsets.forEach(([from, count], regionIndex) => {
      const regionDepth = getMortonIdDepth(regionIndex);
      sortedNodeIDs.slice(from, from + count).forEach((nodeIndex) => {
        expect(expectedNodesRegions[nodeIndex][regionDepth - 1]).toEqual(regionIndex);
      });
    });
  });
});
