import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each node, and returns on a texture its index,
 * and on another texture its closest centroid ID.
 */
export function getKMeansSetupSortFragmentShader({
  nodesCount,
  centroidsCount,
}: {
  nodesCount: number;
  centroidsCount: number;
}) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define VALUE_FOR_EXCESS_NODE ${numberToGLSLFloat(centroidsCount + 1)}
#define NODES_COUNT ${numberToGLSLFloat(nodesCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(nodesCount))}

// Graph data:
uniform sampler2D u_closestCentroidTexture;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 values;
layout(location = 1) out vec4 sortOn;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

void main() {
  float nodeIndex = getIndex(v_textureCoord, NODES_TEXTURE_SIZE);

  if (nodeIndex < NODES_COUNT) {
    float closestCentroidID = getValueInTexture(u_closestCentroidTexture, nodeIndex, NODES_TEXTURE_SIZE).x;
    values.x = nodeIndex;
    sortOn.x = closestCentroidID;
  }
  // In case the nodeIndex is too high, we still setup a value, and a sortOn that is also too high:
  else {
    values.x = nodeIndex;
    sortOn.x = VALUE_FOR_EXCESS_NODE;
  }
}`;

  return SHADER;
}
