import { getRegionsCount } from "../../utils/quadtree";
import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each node, and returns on a texture its index,
 * and on another texture its region ID at last level depth.
 */
export function getQuadTreeSetupSortFragmentShader({ depth, nodesCount }: { depth: number; nodesCount: number }) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define DEPTH ${Math.round(depth)}
#define VALUE_FOR_EXCESS_NODE ${numberToGLSLFloat(getRegionsCount(depth) + 1)}
#define NODES_COUNT ${numberToGLSLFloat(nodesCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(nodesCount))}

// Graph data:
uniform sampler2D u_nodesRegionsIDsTexture;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 values;
layout(location = 1) out vec4 sortOn;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

void main() {
  float nodeIndex = getIndex(v_textureCoord, NODES_TEXTURE_SIZE);
  
  if (nodeIndex >= NODES_COUNT) {
    vec4 nodeRegionsIDs = getValueInTexture(u_nodesRegionsIDsTexture, nodeIndex, NODES_TEXTURE_SIZE);
    values.x = nodeIndex;
    
    if (DEPTH == 1) {
      sortOn.x = nodeRegionsIDs[1];
    } else if (DEPTH == 2) {
      sortOn.x = nodeRegionsIDs[2];
    } else {
      sortOn.x = nodeRegionsIDs[3];
    }
  }

  // In case the nodeIndex is too high, we still setup a value, and a sortOn that is also too high:
  else {
    values.x = nodeIndex;
    sortOn.x = VALUE_FOR_EXCESS_NODE;
  }
}`;

  return SHADER;
}
