import Graph from "graphology";

import {
  GLSL_getMortonIdDepth,
  GLSL_getParentMortonId,
  GLSL_getRegionsCount,
  getRegionsCount,
} from "../../utils/quadtree";
import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";
import { ForceAtlas2Flags } from "../consts";

export function getForceAtlas2FragmentShader({
  graph,
  quadTreeDepth,
  quadTreeTheta,
  linLogMode,
  adjustSizes,
  strongGravityMode,
  outboundAttractionDistribution,
  enableQuadTree,
}: {
  graph: Graph;
  quadTreeDepth: number;
  quadTreeTheta: number;
} & ForceAtlas2Flags) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define NODES_COUNT ${numberToGLSLFloat(graph.order)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.order))}
#define EDGES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.size * 2))}
#define QUAD_TREE_DEPTH ${Math.floor(quadTreeDepth)}
#define QUAD_TREE_REGIONS_COUNT ${Math.floor(getRegionsCount(quadTreeDepth))}
#define QUAD_TREE_REGIONS_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(getRegionsCount(quadTreeDepth)))}
#define QUAD_TREE_THETA_SQUARED ${numberToGLSLFloat(quadTreeTheta * quadTreeTheta)}
${linLogMode ? "#define LINLOG_MODE" : ""}
${adjustSizes ? "#define ADJUST_SIZES" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE" : ""}
${outboundAttractionDistribution ? "#define OUTBOUND_ATTRACTION_DISTRIBUTION" : ""}
${enableQuadTree ? "#define QUAD_TREE_ENABLED" : ""}

// Graph data:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesMovementTexture;
uniform sampler2D u_nodesMetadataTexture;
uniform sampler2D u_edgesTexture;

uniform sampler2D u_nodesRegionsTexture;
uniform sampler2D u_regionsBarycentersTexture;

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
layout(location = 1) out vec4 movementOutput;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

${GLSL_getRegionsCount}
${GLSL_getMortonIdDepth}
${GLSL_getParentMortonId}

// To set a region as used:
int usedRegions[${Math.floor(getRegionsCount(quadTreeDepth) / 32)}]; // 9 * 32 = 288 bits, which covers 264 regions.
void setRegionUsed(int regionId) {
  int index = regionId / 32; // Find the relevant int in the array.
  int bit = regionId % 32;   // Find the bit within that int.
  usedRegions[index] |= (1 << bit);
}

// To check if a region is used:
bool isRegionUsed(int regionId) {
  int index = regionId / 32;
  int bit = regionId % 32;
  return (usedRegions[index] & (1 << bit)) != 0;
}

void main() {
  float nodeIndex = getIndex(v_textureCoord, NODES_TEXTURE_SIZE);
  if (nodeIndex >= NODES_COUNT) return;

  vec4 nodePosition = getValueInTexture(u_nodesPositionTexture, nodeIndex, NODES_TEXTURE_SIZE);
  float x = nodePosition.x;
  float y = nodePosition.y;
  float nodeMass = nodePosition.z;

  vec4 nodeMovement = getValueInTexture(u_nodesMovementTexture, nodeIndex, NODES_TEXTURE_SIZE);
  float oldDx = nodeMovement.x;
  float oldDy = nodeMovement.y;
  float nodeConvergence = nodeMovement.z;
  float dx = 0.0;
  float dy = 0.0;

  vec4 nodeMetadata = getValueInTexture(u_nodesMetadataTexture, nodeIndex, NODES_TEXTURE_SIZE);
  float nodeSize = nodeMetadata.r;
  float edgesOffset = nodeMetadata.g;
  float neighborsCount = nodeMetadata.b;

  // REPULSION:
  float repulsionCoefficient = u_scalingRatio;

  #ifdef QUAD_TREE_ENABLED
    // Region-to-node repulsion (using quad tree):
    for (int regionId = 0; regionId < QUAD_TREE_REGIONS_COUNT; regionId++) {
      int depth = getMortonIdDepth(regionId);
      int parentId = getParentMortonId(regionId);
    
      // Skip regions whose parents have been used for repulsion:
      if (depth > 1 && isRegionUsed(parentId)) {
        setRegionUsed(regionId);
        continue;
      }
    
      vec4 regionBarycenter = getValueInTexture(u_regionsBarycentersTexture, float(regionId), QUAD_TREE_REGIONS_TEXTURE_SIZE);
      vec2 regionCoordinates = regionBarycenter.xy;
      float regionMass = regionBarycenter.z;
      float regionSizeSquare = regionBarycenter.w;
    
      vec2 diff = nodePosition.xy - regionCoordinates;
      float dSquare = dot(diff, diff);
    
      // Barnes-Hut Theta test:
      if (4.0 * regionSizeSquare / dSquare < QUAD_TREE_THETA_SQUARED) {
        setRegionUsed(regionId);
        float factor = repulsionCoefficient * nodeMass * regionMass / dSquare;
        dx += diff.x * factor;
        dy += diff.y * factor;
      }
    }
  #endif

  // Node-to-node repulsion (no quad tree):
  for (float j = 0.0; j < NODES_COUNT; j++) {
    if (j == nodeIndex) continue;

    #ifdef QUAD_TREE_ENABLED
      vec4 otherNodeRegions = getValueInTexture(u_nodesRegionsTexture, j, NODES_TEXTURE_SIZE);
      if (isRegionUsed(int(otherNodeRegions[QUAD_TREE_DEPTH]))) {
        continue;
      }
    #endif
  
    vec4 otherNodePosition = getValueInTexture(u_nodesPositionTexture, j, NODES_TEXTURE_SIZE);
    vec4 otherNodeMetadata = getValueInTexture(u_nodesMetadataTexture, j, NODES_TEXTURE_SIZE);
    float otherNodeMass = otherNodePosition.z;
    float otherNodeSize = otherNodeMetadata.r;

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

  // GRAVITY:
  float distanceToCenter = sqrt(x * x + y * y);
  float gravityFactor = 0.0;
  #ifdef STRONG_GRAVITY_MODE
    if (distanceToCenter > 0.0) gravityFactor = nodeMass * u_gravity;
  #else
    if (distanceToCenter > 0.0) gravityFactor = nodeMass * u_gravity / distanceToCenter;
  #endif

  dx -= x * gravityFactor;
  dy -= y * gravityFactor;

  // ATTRACTION:
  #ifdef OUTBOUND_ATTRACTION_DISTRIBUTION
    float attractionCoefficient = u_outboundAttCompensation;
  #else
    float attractionCoefficient = 1.0;
  #endif

  for (float j = 0.0; j < neighborsCount; j++) {
    vec2 edgeData = getValueInTexture(u_edgesTexture, edgesOffset + j, EDGES_TEXTURE_SIZE).xy;
    float otherNodeIndex = edgeData.x;
    float weight = edgeData.y;
    float edgeWeightInfluence = pow(weight, u_edgeWeightInfluence);

    vec4 otherNodePosition = getValueInTexture(u_nodesPositionTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
    vec2 diff = nodePosition.xy - otherNodePosition.xy;

    #ifdef ADJUST_SIZES
      vec4 otherNodeMetadata = getValueInTexture(u_nodesMetadataTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
      float otherNodeSize = otherNodeMetadata.r;
      float d = sqrt(dot(diff, diff)) - nodeSize - otherNodeSize;
    #else
      float d = sqrt(dot(diff, diff));
    #endif

    float attractionFactor = 0.0;
    #ifdef LINLOG_MODE
      #ifdef OUTBOUND_ATTRACTION_DISTRIBUTION
        // LinLog Degree Distributed Anti-collision Attraction
        if (d > 0.0) {
          attractionFactor = (-attractionCoefficient * edgeWeightInfluence * log(1.0 + d)) / d / nodeMass;
        }

      #else
        // LinLog Anti-collision Attraction
        if (d > 0.0) {
          attractionFactor = (-attractionCoefficient * edgeWeightInfluence * log(1.0 + d)) / d;
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
    movementOutput.z = min(
      1.0,
      sqrt(nodeSpeed * forceSquared * swingingFactor)
    );
  #endif

  dx = dx * nodeSpeed / u_slowDown;
  dy = dy * nodeSpeed / u_slowDown;

  positionOutput.x = x + dx;
  positionOutput.y = y + dy;
  positionOutput.z = nodeMass;

  movementOutput.x = dx;
  movementOutput.y = dy;
}`;

  return SHADER;
}
