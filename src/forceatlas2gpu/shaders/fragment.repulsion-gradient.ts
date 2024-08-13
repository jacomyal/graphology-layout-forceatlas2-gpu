import Graph from "graphology";

import { getTextureSize, numberToGLSLFloat } from "../utils";

export function getRepulsionGradientFragmentShader({
  graph,
  gradientTextureSize,
}: {
  graph: Graph;
  gradientTextureSize: number;
}) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define NODES_COUNT ${numberToGLSLFloat(graph.order)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.order))}
#define GRADIENT_TEXTURE_SIZE ${numberToGLSLFloat(gradientTextureSize)}

// Textures management:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesMetadataTexture;
uniform sampler2D u_relevantGridPointsTexture;
uniform vec2 u_stageOffset;
uniform vec2 u_stageDimensions;
in vec2 v_textureCoord;

// Output
out vec4 algoOutput;

vec4 getValueInTexture(sampler2D inputTexture, float index, float textureSize) {
  float row = floor(index / textureSize);
  float col = index - row * textureSize;
  return texture(
    inputTexture,
    vec2(
      (col + 0.5) / textureSize,
      (row + 0.5) / textureSize
    )
  );
}

void main() {
  float fx = 0.0;
  float fy = 0.0;
  vec2 fragmentPosition = v_textureCoord * u_stageDimensions + u_stageOffset;

  float isPointRelevant = texture(u_relevantGridPointsTexture, fragmentPosition).x;
  if (isPointRelevant == 0.0) return;
  

  for (float j = 0.0; j < NODES_COUNT - 1.0; j++) {
    vec2 nodePosition = getValueInTexture(u_nodesPositionTexture, j, NODES_TEXTURE_SIZE).xy;
    
    vec4 nodeDimensions = getValueInTexture(u_nodesMetadataTexture, j, NODES_TEXTURE_SIZE);
    float nodeMass = nodeDimensions.r;
    float nodeSize = nodeDimensions.g;

    vec2 diff = nodePosition - fragmentPosition.xy;
    float factor = 0.0;
    
    // Linear Repulsion
    float dSquare = dot(diff, diff);
    if (dSquare > 0.0) {
      factor = nodeMass / dSquare;
      fx += diff.x * factor;
      fy += diff.y * factor;
    }
  }

  algoOutput.x = fx;
  algoOutput.y = fy;
}`;

  return SHADER;
}
