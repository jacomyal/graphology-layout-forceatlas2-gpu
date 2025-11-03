import { getRegionsCount } from "../../utils/quadtree";
import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each quadtree region, and returns for each
 * region its nodes count and its offset (
 */
export function getQuadTreeOffsetFragmentShader({ depth }: { depth: number }) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define DEPTH ${Math.round(depth)}
#define DEPTH_OFFSET ${numberToGLSLFloat(getRegionsCount(depth - 1))}
#define TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(getRegionsCount(depth)))}

// Graph data:
uniform sampler2D u_regionsBarycentersTexture;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 regionOffset;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

void main() {
  float regionIndex = getIndex(v_textureCoord, TEXTURE_SIZE);
  float regionNodesCount = getValueInTexture(u_regionsBarycentersTexture, regionIndex, TEXTURE_SIZE).w;

  float offset = 0.0;
  for (float i = DEPTH_OFFSET; i < regionIndex; i++) {
    float nodesCount = getValueInTexture(u_regionsBarycentersTexture, i, TEXTURE_SIZE).w;
    offset += nodesCount;
  }

  regionOffset.x = regionNodesCount;
  regionOffset.y = offset;
}`;

  return SHADER;
}
