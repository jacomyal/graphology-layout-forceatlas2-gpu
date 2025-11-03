import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each node and returns the ID of its closest
 * centroid.
 */
export function getClosestCentroidFragmentShader({
  nodesCount,
  centroidsCount,
}: {
  nodesCount: number;
  centroidsCount: number;
}) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define NODES_COUNT ${numberToGLSLFloat(nodesCount)}
#define CENTROIDS_COUNT ${numberToGLSLFloat(centroidsCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(nodesCount))}
#define CENTROIDS_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(centroidsCount))}

// Graph data:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_centroidsPositionTexture;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 closestCentroid;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

void main() {
  float nodeIndex = getIndex(v_textureCoord, NODES_TEXTURE_SIZE);

  // Out-of-bounds fragments: write sentinel value
  if (nodeIndex >= NODES_COUNT) {
    closestCentroid.x = -1.0;
    return;
  }

  vec2 position = getValueInTexture(u_nodesPositionTexture, nodeIndex, NODES_TEXTURE_SIZE).xy;
  float closestCentroidID = 0.0;
  float distanceToClosestCentroid = distance(
    position,
    getValueInTexture(u_centroidsPositionTexture, closestCentroidID, CENTROIDS_TEXTURE_SIZE).xy
  );

  for (float centroidID = 1.0; centroidID < CENTROIDS_COUNT; centroidID++) {
    float distanceToCentroid = distance(
      position,
      getValueInTexture(u_centroidsPositionTexture, centroidID, CENTROIDS_TEXTURE_SIZE).xy
    );

    if (distanceToCentroid < distanceToClosestCentroid) {
      distanceToClosestCentroid = distanceToCentroid;
      closestCentroidID = centroidID;
    }
  }

  closestCentroid.x = closestCentroidID;
}`;

  return SHADER;
}
