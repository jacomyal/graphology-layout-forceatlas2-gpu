import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each centroid, and returns for each centroid
 * its nodes count and its offset in the sorted nodes array.
 */
export function getKMeansOffsetFragmentShader({ centroidsCount }: { centroidsCount: number }) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define CENTROIDS_COUNT ${numberToGLSLFloat(centroidsCount)}
#define TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(centroidsCount))}

// Graph data:
uniform sampler2D u_centroidsPositionTexture;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 centroidOffset;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

void main() {
  float centroidIndex = getIndex(v_textureCoord, TEXTURE_SIZE);
  if (centroidIndex >= CENTROIDS_COUNT) return;

  float centroidNodesCount = getValueInTexture(u_centroidsPositionTexture, centroidIndex, TEXTURE_SIZE).w;

  float offset = 0.0;
  for (float i = 0.0; i < centroidIndex; i++) {
    float nodesCount = getValueInTexture(u_centroidsPositionTexture, i, TEXTURE_SIZE).w;
    offset += nodesCount;
  }

  centroidOffset.x = centroidNodesCount;
  centroidOffset.y = offset;
}`;

  return SHADER;
}
