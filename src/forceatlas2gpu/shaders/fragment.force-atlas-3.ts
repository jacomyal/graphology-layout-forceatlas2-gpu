import Graph from "graphology";

import { ForceAtlas2Flags } from "../consts";
import { getTextureSize, numberToGLSLFloat } from "../utils";

export function getForceAtlas3FragmentShader({
  graph,
  maxNeighborsCount,
  linLogMode,
  adjustSizes,
  strongGravityMode,
}: {
  graph: Graph;
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
${linLogMode ? "#define LINLOG_MODE" : ""}
${adjustSizes ? "#define ADJUST_SIZES" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE" : ""}

// Graph data:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesMetadataTexture;
uniform sampler2D u_nodesConvergenceTexture;
uniform sampler2D u_edgesTexture;
in vec2 v_textureCoord;

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
layout(location = 0) out vec4 positionOutput;
layout(location = 1) out vec4 convergenceOutput;

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

float getIndex(vec2 positionInTexture, float textureSize) {
  float col = floor(positionInTexture.x * textureSize);
  float row = floor(positionInTexture.y * textureSize);
  return row * textureSize + col;
}

void main() {
  float nodeIndex = getIndex(v_textureCoord, NODES_TEXTURE_SIZE);
  if (nodeIndex > NODES_COUNT) return;

  vec4 nodePosition = getValueInTexture(u_nodesPositionTexture, nodeIndex, NODES_TEXTURE_SIZE);
  float x = nodePosition.x;
  float y = nodePosition.y;
  float oldDx = nodePosition.z;
  float oldDy = nodePosition.w;
  float dx = 0.0;
  float dy = 0.0;
  
  vec4 nodeMetadata = getValueInTexture(u_nodesMetadataTexture, nodeIndex, NODES_TEXTURE_SIZE);
  float nodeMass = nodeMetadata.r;
  float nodeSize = nodeMetadata.g;
  float edgesOffset = nodeMetadata.b;
  float neighborsCount = nodeMetadata.a;

  float nodeConvergence = getValueInTexture(u_nodesConvergenceTexture, nodeIndex, NODES_TEXTURE_SIZE).x;

  // REPULSION:
  float repulsionCoefficient = u_scalingRatio;
  for (float j = 0.0; j < NODES_COUNT; j++) {
    if (j != nodeIndex) {
      vec4 otherNodePosition = getValueInTexture(u_nodesPositionTexture, j, NODES_TEXTURE_SIZE);
      vec3 otherNodeMetadata = getValueInTexture(u_nodesMetadataTexture, j, NODES_TEXTURE_SIZE).rgb;
      float otherNodeMass = otherNodeMetadata.r;
      float otherNodeSize = otherNodeMetadata.g;

      vec2 diff = nodePosition.xy - otherNodePosition.xy;
      float factor = 0.0;

      #ifdef ADJUST_SIZES
      // Anticollision Linear Repulsion
      float d = sqrt(dot(diff, diff)) - nodeSize - otherNodeSize;
      if (d > 0.0) {
        factor = repulsionCoefficient * nodeMass * otherNodeMass / (d * d);
      } else if (d < 0.0) {
        factor = 100.0 * repulsionCoefficient * nodeMass * otherNodeMass;
      }

      #else
      // Linear Repulsion
      float dSquare = dot(diff, diff);
      if (dSquare > 0.0) {
        factor = repulsionCoefficient * nodeMass * otherNodeMass / dSquare;
      }
      #endif

      dx += diff.x * factor;
      dy += diff.y * factor;
    }
  }

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

    #ifdef ADJUST_SIZES
      vec4 otherNodeMetadata = getValueInTexture(u_nodesMetadataTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
      float otherNodeSize = otherNodeMetadata.g;
      float d = sqrt(dot(diff, diff)) - nodeSize - otherNodeSize;
    #else
      float d = sqrt(dot(diff, diff));
    #endif

    float attractionFactor = 0.0;
    #ifdef LINLOG_MODE
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
      #ifdef ADJUST_SIZES
      #else
        // NOTE: Distance is set to 1 to override next condition
        d = 1.0;
      #endif

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

  float swinging = nodeMass * sqrt(
    pow(oldDx - dx, 2.0)
    + pow(oldDy - dy, 2.0)
  );
  float swingingFactor = 1.0 / (1.0 + sqrt(swinging));
  float traction = sqrt(
    pow(oldDx + dx, 2.0)
    + pow(oldDy + dy, 2.0)
  ) / 2.0;

  #ifdef ADJUST_SIZES
    float nodeSpeed = (0.1 * log(1.0 + traction)) * swingingFactor;
    // No convergence when adjustSizes is true

  #else
    float nodeSpeed = (nodeConvergence * log(1.0 + traction)) * swingingFactor;
    // Store new node convergence:
    convergenceOutput.x = min(
      1.0,
      sqrt(nodeSpeed * forceSquared * swingingFactor)
    );
  #endif
  
  // Store new node coordinates:
  dx = dx * nodeSpeed / u_slowDown;
  dy = dy * nodeSpeed / u_slowDown;
  positionOutput.x = x + dx;
  positionOutput.y = y + dy;
  positionOutput.z = dx;
  positionOutput.w = dy;
}`;

  return SHADER;
}
