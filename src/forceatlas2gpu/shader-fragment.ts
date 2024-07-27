import Graph from "graphology";

import { ForceAtlas2Flags, REGION_NODE } from "./consts";
import { getTextureSize, numberToGLSLFloat } from "./utils";

export function getFragmentShader({
  graph,
  maxNeighborsCount,
  linLogMode,
  adjustSizes,
  barnesHutOptimize,
  strongGravityMode,
  outboundAttractionDistribution,
}: {
  graph: Graph;
  maxNeighborsCount: number;
} & ForceAtlas2Flags) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define EPSILON 0.01
#define NODES_COUNT ${numberToGLSLFloat(graph.order)}
#define EDGES_COUNT ${numberToGLSLFloat(graph.size)}
#define MAX_NEIGHBORS_COUNT ${numberToGLSLFloat(maxNeighborsCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.order))}
#define EDGES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.size * 2))}
#define MAX_BARNES_HUT_REGIONS ${numberToGLSLFloat(Math.log(graph.order + 1))}
${linLogMode ? "#define LINLOG_MODE" : ""}
${adjustSizes ? "#define ADJUST_SIZES" : ""}
${barnesHutOptimize ? "#define BARNES_HUT" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE" : ""}
${outboundAttractionDistribution ? "#define OUTBOUND_ATTRACTION_DISTRIBUTION" : ""}

// Textures management:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesDimensionsTexture;
uniform sampler2D u_nodesEdgesPointersTexture;
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
  
#ifdef BARNES_HUT
  uniform sampler2D u_regionsTexture;
  uniform float u_regionsTextureSize;
  uniform float u_barnesHutTheta;
#endif

// Output
out vec4 fragColor;

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
  float oldDx = nodePosition.b;
  float oldDy = nodePosition.a;
  float dx = 0.0;
  float dy = 0.0;
  
  vec3 nodeDimensions = getValueInTexture(u_nodesDimensionsTexture, nodeIndex, NODES_TEXTURE_SIZE).rgb;
  float nodeMass = nodeDimensions.r;
  float nodeSize = nodeDimensions.g;
  float nodeConvergence = nodeDimensions.b;

  vec2 nodeEdgesPointers = getValueInTexture(u_nodesEdgesPointersTexture, nodeIndex, NODES_TEXTURE_SIZE).xy;
  float edgesOffset = nodeEdgesPointers.r;
  float neighborsCount = nodeEdgesPointers.g;

  #ifdef BARNES_HUT
    float thetaSquared = pow(u_barnesHutTheta, 2.0);
  #endif

  // REPULSION:
  float repulsionCoefficient = u_scalingRatio;
  #ifdef BARNES_HUT
    float regionIndex = 0.0; // Starting with root region
  
    for (float j = 0.0; j < MAX_BARNES_HUT_REGIONS; j++) {
      // Retrieve data from the regions texture:
      vec3 regionData1 = getValueInTexture(u_regionsTexture, regionIndex * 3.0, u_regionsTextureSize).rgb;
      float regionNodeIndex = regionData1.r;
      
      vec3 regionData2 = getValueInTexture(u_regionsTexture, regionIndex * 3.0 + 1.0, u_regionsTextureSize).rgb;
      float regionSize = regionData2.r;
      float regionNextSibling = regionData2.g;
      float regionFirstChildIndex = regionData2.b;
      
      vec3 regionData3 = getValueInTexture(u_regionsTexture, regionIndex * 3.0 + 2.0, u_regionsTextureSize).rgb;
      vec2 regionMassCenter = regionData3.xy;
      float regionMass = regionData3.z;

      // The region has sub-regions
      if (regionFirstChildIndex >= 0.0) {
        // We run the Barnes Hut test to see if we are at the right distance
        vec2 diff = vec2(x, y) - regionMassCenter;
        float d = sqrt(dot(diff, diff));

        // We treat the region as a single body, and we repulse
        if ((4.0 * regionSize * regionSize) / d < thetaSquared) {
          if (d > 0.0) {
            float factor = repulsionCoefficient * nodeMass * regionMass / d;
            dx += diff.x * factor;
            dy += diff.y * factor;
          }

          // When this is done, we iterate. We have to look at the next sibling.
          regionIndex = regionNextSibling;
          if (regionIndex <= 0.0) break; // No next sibling: we have finished the tree
        }
        
        // The region is too close and we have to look at sub-regions
        else {
          regionIndex = regionFirstChildIndex;
        }
      }

      // The region has no sub-region
      // If there is a node r[0] and it is not n, then repulse
      else {
        if (regionNodeIndex >= 0.0 && regionNodeIndex != nodeIndex) {
          vec4 regionNodePosition = getValueInTexture(
            u_nodesPositionTexture,
            regionNodeIndex,
            NODES_TEXTURE_SIZE
          );
          vec4 regionNodeDimensions = getValueInTexture(
            u_nodesDimensionsTexture,
            regionNodeIndex,
            NODES_TEXTURE_SIZE
          );
          float regionNodeMass = regionNodeDimensions.r;
          vec2 diff = vec2(x, y) - regionNodePosition.xy;
          float d = sqrt(dot(diff, diff));

          if (d > 0.0) {
            float factor = repulsionCoefficient * nodeMass * regionNodeMass / d;
            dx += diff.x * factor;
            dy += diff.y * factor;
          }
        }
        
        // When this is done, we iterate. We have to look at the next sibling.
        regionIndex = regionNextSibling;
        if (regionIndex <= 0.0) break; // No next sibling: we have finished the tree
      }
    }

  #else
    for (float j = 0.0; j < NODES_COUNT; j++) {
      if (j != nodeIndex) {
        vec4 otherNodePosition = getValueInTexture(u_nodesPositionTexture, j, NODES_TEXTURE_SIZE);
        vec3 otherNodeDimensions = getValueInTexture(u_nodesDimensionsTexture, j, NODES_TEXTURE_SIZE).rgb;
        float otherNodeMass = otherNodeDimensions.r;
        float otherNodeSize = otherNodeDimensions.g;
  
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
  #endif

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
      vec4 otherNodeDimensions = getValueInTexture(u_nodesDimensionsTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
      float otherNodeSize = otherNodeDimensions.g;
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
    fragColor.z = min(
      1.0,
      sqrt(nodeSpeed * forceSquared * swingingFactor)
    );
  #endif

  fragColor.x = x + dx * nodeSpeed / u_slowDown;
  fragColor.y = y + dy * nodeSpeed / u_slowDown;
}`;

  return SHADER;
}
