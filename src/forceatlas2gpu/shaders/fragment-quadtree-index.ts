import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is executed for each node, and sets for each node and for each
 * depth (from 0 to MAX_DEPTH - 1) the ID of the related region, using Morton
 * IDs:
 */
export function getQuadTreeIndexFragmentShader({ nodesCount, depth }: { nodesCount: number; depth: number }) {
  if (depth > 4) throw new Error("QuadTree does not support depth > 4 yet.");

  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
  precision highp float;

  #define NODES_COUNT ${numberToGLSLFloat(nodesCount)}
  #define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(nodesCount))}
  #define MAX_DEPTH ${Math.round(depth)}

  // Graph data:
  uniform sampler2D u_nodesPositionTexture;
  uniform sampler2D u_boundariesTexture;
  in vec2 v_textureCoord;

  // Output
  layout(location = 0) out vec4 nodesRegionsIDs;

  // Additional helpers:
  ${GLSL_getValueInTexture}
  ${GLSL_getIndex}

  void main() {
    float nodeIndex = getIndex(v_textureCoord, NODES_TEXTURE_SIZE);
    if (nodeIndex >= NODES_COUNT) return;

    vec4 nodePosition = getValueInTexture(u_nodesPositionTexture, nodeIndex, NODES_TEXTURE_SIZE);
    float x = nodePosition.x;
    float y = nodePosition.y;
    
    vec4 boundaries = getValueInTexture(u_boundariesTexture, 0.0, 1.0);
    float xMin = boundaries[0];
    float xMax = boundaries[1];
    float yMin = boundaries[2];
    float yMax = boundaries[3];

    // Compute Morton IDs for each level:
    // - First, the first level is indexed:
    //   0, 1
    //   2, 3
    // - Then, increments continue to next level:
    //    4,  5,  8,  9
    //    6,  7, 10, 11
    //   12, 13, 16, 17
    //   14, 15, 18, 19
    // - Next level:
    //   20, 21, 24, 25, 36, 37, 40, 41
    //   22, 23, 26, 27, 38, 39, 42, 43
    //   28, 29, 32, 33, 44, 45, 48, 49
    //   30, 31, 34, 35, 46, 47, 50, 51
    //   52, 53, 56, 57, 68, 69, 72, 73
    //   54, 55, 58, 59, 70, 71, 74, 75
    //   60, 61, 64, 65, 76, 77, 80, 81
    //   62, 63, 66, 67, 78, 79, 82, 83
    // - Etc...
    float mortonID = 0.0;
    for (int i = 0; i < MAX_DEPTH; i++) {
      float centerX = (xMax + xMin) / 2.0;
      float centerY = (yMax + yMin) / 2.0;
      float quadrant = 0.0;

      // Determine the quadrant of the current point relative to the center of the parent region.
      if (x >= centerX) {
        quadrant += 1.0;
        xMin = centerX;
      } else {
        xMax = centerX;
      }

      if (y >= centerY) {
        quadrant += 2.0;
        yMin = centerY;
      } else {
        yMax = centerY;
      }

      // This formula gives 0, 4, 20, 84...
      float baseID = (pow(4.0, (float(i) + 1.0)) - 4.0) / 3.0;
      // Compute the base ID for the current depth:
      mortonID = quadrant + mortonID * 4.0;

      // Add the base ID to the stored ID (so that the ID contains the depth as well):
      float id = mortonID + baseID;
      if (i == 0) {
        nodesRegionsIDs[0] = id;
      } else if (i == 1) {
        nodesRegionsIDs[1] = id;
      } else if (i == 2) {
        nodesRegionsIDs[2] = id;
      } else if (i == 3) {
        nodesRegionsIDs[3] = id;
      }
    }
  }`;

  return SHADER;
}
