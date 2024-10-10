import { GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed only once, and returns a texture with 1 pixel,
 * containing: xMin, xMax, yMin, yMax
 */
export function getQuadTreeBoundariesFragmentShader({ nodesCount }: { nodesCount: number }) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define NODES_COUNT ${numberToGLSLFloat(nodesCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(nodesCount))}

// Graph data:
uniform sampler2D u_nodesPositionTexture;

// Output
layout(location = 0) out vec4 boundaries;

// Additional helpers:
${GLSL_getValueInTexture}

void main() {
  vec4 firstNodePosition = getValueInTexture(u_nodesPositionTexture, 0.0, NODES_TEXTURE_SIZE);

  bool hasSetValues = false;
  float xMin;
  float xMax;
  float yMin;
  float yMax;

  for (float i = 0.0; i < NODES_COUNT; i++) {
    vec4 nodePosition = getValueInTexture(u_nodesPositionTexture, i, NODES_TEXTURE_SIZE);

    if (!hasSetValues) {
      xMin = nodePosition.x;
      xMax = nodePosition.x;
      yMin = nodePosition.y;
      yMax = nodePosition.y;
    } else {
      xMin = min(nodePosition.x, xMin);
      xMax = max(nodePosition.x, xMax);
      yMin = min(nodePosition.y, yMin);
      yMax = max(nodePosition.y, yMax);
    }

    hasSetValues = true;
  }

  boundaries = vec4(
    xMin,
    xMax,
    yMin,
    yMax
  );
}`;

  return SHADER;
}
