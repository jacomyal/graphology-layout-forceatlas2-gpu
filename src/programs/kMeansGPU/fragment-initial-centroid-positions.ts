import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each centroid, and returns an initial position
 * for each centroid.
 */
export function getCentroidInitialPositionFragmentShader({
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

    float nodeCandidateIndex = round(NODES_COUNT / CENTROIDS_COUNT * centroidIndex);
    vec2 nodePosition = getValueInTexture(u_nodesPositionTexture, nodeCandidateIndex, NODES_TEXTURE_SIZE).xy;
    centroidsPosition.xy = nodePosition;
    centroidsPosition.z = 0.0;
    centroidsPosition.w = 0.0;
  }`;

  return SHADER;
}
