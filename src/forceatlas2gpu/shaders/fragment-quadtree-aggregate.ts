import { GLSL_getMortonIdDepth, getRegionsCount } from "../../utils/quadtree";
import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each quadtree region at each depth level (from 0
 * to MAX_DEPTH - 1), and returns for each region the barycenter and the
 * aggregated mass of the region.
 */
export function getQuadTreeAggregateFragmentShader({ nodesCount, depth }: { nodesCount: number; depth: number }) {
  if (depth > 4) throw new Error("QuadTree does not support depth > 4 yet.");

  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define NODES_COUNT ${numberToGLSLFloat(nodesCount)}
#define REGIONS_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(getRegionsCount(depth)))}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(nodesCount))}
#define MAX_DEPTH ${Math.round(depth)}

// Graph data:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesRegionsIDsTexture;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 regionsBarycenters;
layout(location = 1) out vec4 regionsNodesCount;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}
${GLSL_getMortonIdDepth}

void main() {
  float regionIndex = getIndex(v_textureCoord, REGIONS_TEXTURE_SIZE);
  int regionDepth = getMortonIdDepth(int(regionIndex));

  if (regionDepth > MAX_DEPTH) return;

  float aggregatedX = 0.0;
  float aggregatedY = 0.0;
  float aggregatedMass = 0.0;
  float nodesCount = 0.0;

  for (float i = 0.0; i < NODES_COUNT; i++) {
    vec4 nodeRegionIDs = getValueInTexture(u_nodesRegionsIDsTexture, i, NODES_TEXTURE_SIZE);
    float regionAtDepth = nodeRegionIDs[regionDepth - 1];

    // Only add nodes that are in this region at this depth level:
    if (regionAtDepth == regionIndex) {
      vec4 nodePosition = getValueInTexture(u_nodesPositionTexture, i, NODES_TEXTURE_SIZE);
      float x = nodePosition.x;
      float y = nodePosition.y;
      float mass = nodePosition.z;

      aggregatedX += x * mass;
      aggregatedY += y * mass;
      aggregatedMass += mass;
      nodesCount++;
    }
  }

  if (nodesCount > 0.0) {
    aggregatedX /= aggregatedMass;
    aggregatedY /= aggregatedMass;

    regionsBarycenters.x = aggregatedX;
    regionsBarycenters.y = aggregatedY;
    regionsBarycenters.z = aggregatedMass;
    regionsBarycenters.w = nodesCount;
  }
}`;

  return SHADER;
}
