import Graph from "graphology";

import { ForceAtlas2Flags } from "../consts";
import { getTextureSize, numberToGLSLFloat } from "../utils";

export function getForceAtlas3FragmentShader({
  graph,
  maxNeighborsCount,
  linLogMode,
  adjustSizes,
  strongGravityMode,
  gradientTextureSize,
}: {
  graph: Graph;
  gradientTextureSize: number;
  maxNeighborsCount: number;
} & ForceAtlas2Flags) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define NODES_COUNT ${numberToGLSLFloat(graph.order)}
#define EDGES_COUNT ${numberToGLSLFloat(graph.size)}
#define MAX_NEIGHBORS_COUNT ${numberToGLSLFloat(maxNeighborsCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.order))}
#define EDGES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.size * 2))}
#define GRADIENT_TEXTURE_SIZE ${numberToGLSLFloat(gradientTextureSize)}
${linLogMode ? "#define LINLOG_MODE" : ""}
${adjustSizes ? "#define ADJUST_SIZES" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE" : ""}

// Graph data:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesMetadataTexture;
uniform sampler2D u_edgesTexture;
in vec2 v_textureCoord;

// Repulsion gradient:
uniform sampler2D u_repulsionGradientTexture;
uniform vec2 u_stageOffset;
uniform vec2 u_stageDimensions;

// Settings management:
uniform float u_edgeWeightInfluence;
uniform float u_scalingRatio;
uniform float u_gravity;
uniform float u_maxForce;
uniform float u_slowDown;

#ifdef OUTBOUND_ATTRACTION_DISTRIBUTION
  uniform float u_outboundAttCompensation;
#endif

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

vec2 roundValueInTexture(sampler2D inputTexture, vec2 coordinatesInTexture, float textureSize) {
  // Find surrounding corners coordinates:
  vec2 coordinates00 = floor(coordinatesInTexture * textureSize);
  coordinates00.x = clamp(coordinates00.x, 0.0, textureSize - 2.0);
  coordinates00.y = clamp(coordinates00.y, 0.0, textureSize - 2.0);
  vec2 coordinates10 = coordinates00 + vec2(1.0, 0.0);
  vec2 coordinates01 = coordinates00 + vec2(0.0, 1.0);
  vec2 coordinates11 = coordinates00 + vec2(1.0, 1.0);
  
  // Find surrounding corners values:
  vec2 corner00 = texture(inputTexture, coordinates00 / textureSize).xy;
  vec2 corner10 = texture(inputTexture, coordinates10 / textureSize).xy;
  vec2 corner01 = texture(inputTexture, coordinates01 / textureSize).xy;
  vec2 corner11 = texture(inputTexture, coordinates11 / textureSize).xy;
  
  // Find coordinates in square formed by 4 corners:
  vec2 coordinatesInSquare = coordinatesInTexture * textureSize - coordinates00;
  float x = coordinatesInSquare.x;
  float y = coordinatesInSquare.y;
  
  // Interpolate between 4 corners:
  return (1.0 - x) * (1.0 - y) * corner00 + x * (1.0 - y) * corner10 + (1.0 - x) * y * corner01 + x * y * corner11;
}

float getIndex(vec2 positionInTexture, float textureSize) {
  float col = floor(positionInTexture.x * textureSize);
  float row = floor(positionInTexture.y * textureSize);
  return row * textureSize + col;
}

void main() {
  float nodeIndex = getIndex(v_textureCoord, NODES_TEXTURE_SIZE);
  if (nodeIndex > NODES_COUNT) return;

  vec2 nodePosition = getValueInTexture(u_nodesPositionTexture, nodeIndex, NODES_TEXTURE_SIZE).xy;
  float x = nodePosition.x;
  float y = nodePosition.y;
  float dx = 0.0;
  float dy = 0.0;

  vec4 nodeMetadata = getValueInTexture(u_nodesMetadataTexture, nodeIndex, NODES_TEXTURE_SIZE);
  float nodeMass = nodeMetadata.r;
  float nodeSize = nodeMetadata.g;
  float edgesOffset = nodeMetadata.b;
  float neighborsCount = nodeMetadata.a;

  // REPULSION:
  float repulsionCoefficient = u_scalingRatio;
  vec2 gradient = roundValueInTexture(u_repulsionGradientTexture, nodePosition / u_stageDimensions, GRADIENT_TEXTURE_SIZE);
  dx += repulsionCoefficient * nodeMass * gradient.x;
  dy += repulsionCoefficient * nodeMass * gradient.y;

  // GRAVITY:
  float distanceToCenter = sqrt(x * x + y * y);
  float gravityFactor = 0.0;
  float gravityCoefficient = u_scalingRatio;
  float g = u_gravity / u_scalingRatio;
  #ifdef STRONG_GRAVITY_MODE
    if (distanceToCenter > 0.0) gravityFactor = gravityCoefficient * nodeMass * g;
  #else
    if (distanceToCenter > 0.0) gravityFactor = gravityCoefficient * nodeMass * g / distanceToCenter;
  #endif

  dx -= x * gravityFactor;
  dy -= y * gravityFactor;

  // ATTRACTION:
  #ifdef OUTBOUND_ATTRACTION_DISTRIBUTION
    float attractionCoefficient = u_outboundAttCompensation;
  #else
    float attractionCoefficient = 1.0;
  #endif

  for (float j = 0.0; j < MAX_NEIGHBORS_COUNT; j++) {
    if (j >= neighborsCount) break;

    vec2 edgeData = getValueInTexture(u_edgesTexture, j + edgesOffset, EDGES_TEXTURE_SIZE).xy;
    float otherNodeIndex = edgeData.x;
    float weight = edgeData.y;
    float edgeWeightInfluence = pow(weight, u_edgeWeightInfluence);

    vec4 otherNodePosition = getValueInTexture(u_nodesPositionTexture, otherNodeIndex, NODES_TEXTURE_SIZE);

    vec2 diff = nodePosition.xy - otherNodePosition.xy;
    float attractionFactor = 0.0;

    #ifdef LINLOG_MODE
      float d = sqrt(dot(diff, diff));

      #ifdef OUTBOUND_ATTRACTION_DISTRIBUTION
        // LinLog Degree Distributed Anti-collision Attraction
        if (d > 0.0) {
          attractionFactor = (-attractionCoefficient * edgeWeightInfluence * log(1 + d)) / d / nodeMass;
        }

      #else
        // LinLog Anti-collision Attraction
        if (d > 0.0) {
          attractionFactor = (-attractionCoefficient * edgeWeightInfluence * log(1 + d)) / d;
        }
      #endif

    #else
      // NOTE: Distance is set to 1 to override next condition
      float d = 1.0;

      #ifdef OUTBOUND_ATTRACTION_DISTRIBUTION
        // Linear Degree Distributed Anti-collision Attraction
        attractionFactor = -(attractionCoefficient * edgeWeightInfluence) / nodeMass;

      #else
        // Linear Anti-collision Attraction
        attractionFactor = -attractionCoefficient * edgeWeightInfluence;
      #endif
    #endif

    if (d > 0.0) {
      dx += diff.x * attractionFactor;
      dy += diff.y * attractionFactor;
    }
  }

  // APPLY FORCES:
  float forceSquared = pow(dx, 2.0) + pow(dy, 2.0);
  float force = sqrt(forceSquared);
  if (force > u_maxForce) {
    dx = dx * u_maxForce / force;
    dy = dy * u_maxForce / force;
  }

  algoOutput.x = x + dx / u_slowDown;
  algoOutput.y = y + dy / u_slowDown;
}`;

  return SHADER;
}
