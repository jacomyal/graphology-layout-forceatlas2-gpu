import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each centroid, and returns the position and
 * mass of the barycenters of its nodes.
 */
export function getCentroidPositionFragmentShader({
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
uniform sampler2D u_closestCentroidTexture;
uniform sampler2D u_centroidsPositionTexture;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 centroidsPosition;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

void main() {
  float centroidIndex = getIndex(v_textureCoord, CENTROIDS_TEXTURE_SIZE);

  // Out-of-bounds fragments: write sentinel values
  if (centroidIndex >= CENTROIDS_COUNT) {
    centroidsPosition = vec4(-1.0, -1.0, -1.0, -1.0);
    return;
  }

  vec2 position = vec2(0.0, 0.0);
  float mass = 0.0;
  float size = 0.0;
  for (float nodeIndex = 0.0; nodeIndex < NODES_COUNT; nodeIndex++) {
    float closestCentroidIndex = getValueInTexture(u_closestCentroidTexture, nodeIndex, NODES_TEXTURE_SIZE).x;
    
    if (closestCentroidIndex == centroidIndex) {
      vec3 nodePosition = getValueInTexture(u_nodesPositionTexture, nodeIndex, NODES_TEXTURE_SIZE).xyz;
      position += nodePosition.xy;
      mass += nodePosition.z;
      size++;
    }
  }
  
  if (size > 0.0) {
    position /= size;
    centroidsPosition.xy = position;
    centroidsPosition.z = mass;
    centroidsPosition.w = size;
  } else {
    vec2 previousPosition = getValueInTexture(u_centroidsPositionTexture, centroidIndex, CENTROIDS_TEXTURE_SIZE).xy;
    centroidsPosition.xy = previousPosition;
    centroidsPosition.z = 0.0;
    centroidsPosition.w = 0.0;
  }
}`;

  return SHADER;
}
