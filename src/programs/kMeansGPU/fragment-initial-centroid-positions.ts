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

  // Golden ratio conjugate for Weyl sequence (produces low-discrepancy quasi-random numbers)
  #define ALPHA 0.61803398875

  // Graph data:
  uniform sampler2D u_nodesPositionTexture;
  uniform float u_iterationCount;
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

    // Use deterministic hash for sampling within each centroid's stride
    // Each centroid gets a base position in its own stride region
    float stride = max(floor(NODES_COUNT / CENTROIDS_COUNT), 1.0);
    float basePosition = centroidIndex * stride;

    // Sin-based hash function for deterministic quasi-random offsets
    // Combine iteration and centroid with different primes for good distribution
    float seed = u_iterationCount * 73.0 + centroidIndex * 37.0;
    float hash = fract(sin(seed) * 43758.5453123);
    float offset = floor(hash * stride);

    float nodeCandidateIndex = mod(basePosition + offset, NODES_COUNT);

    vec2 nodePosition = getValueInTexture(u_nodesPositionTexture, nodeCandidateIndex, NODES_TEXTURE_SIZE).xy;
    centroidsPosition.xy = nodePosition;
    centroidsPosition.z = 0.0;
    centroidsPosition.w = 0.0;
  }`;

  return SHADER;
}
