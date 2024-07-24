import Graph from "graphology";

import { getTextureSize, numberToGLSLFloat } from "./utils";

export function getFragmentShader({
  graph,
  maxNeighborsCount,
  strongGravityMode,
  linLogMode,
  adjustSizes,
  outboundAttractionDistribution,
}: {
  graph: Graph;
  maxNeighborsCount: number;
  strongGravityMode?: boolean;
  linLogMode?: boolean;
  adjustSizes?: boolean;
  outboundAttractionDistribution?: boolean;
}) {
  // language=GLSL
  const SHADER = /*glsl*/ `
precision highp float;

#define EPSILON 0.01
#define NODES_COUNT ${numberToGLSLFloat(graph.order)}
#define EDGES_COUNT ${numberToGLSLFloat(graph.size)}
#define MAX_NEIGHBORS_COUNT ${numberToGLSLFloat(maxNeighborsCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.order))}
#define EDGES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.size * 2))}
${linLogMode ? "#define LINLOG_MODE" : ""}
${adjustSizes ? "#define ADJUST_SIZES" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE" : ""}
${outboundAttractionDistribution ? "#define OUTBOUND_ATTRACTION_DISTRIBUTION" : ""}

// Textures management:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesDimensionsTexture;
uniform sampler2D u_nodesEdgesPointersTexture;
uniform sampler2D u_edgesTexture;
varying vec2 v_textureCoord;

// Settings management:
uniform float u_edgeWeightInfluence;
uniform float u_scalingRatio;
uniform float u_gravity;
uniform float u_maxForce;
uniform float u_slowDown;

#ifdef OUTBOUND_ATTRACTION_DISTRIBUTION
  uniform float u_outboundAttCompensation;
#endif

vec4 readTexture(sampler2D texture, float index, float textureSize) {
  float row = floor(index / textureSize);
  float col = index - row * textureSize;
  return texture2D(
    texture,
    vec2(
      (col + 0.5) / textureSize,
      (row + 0.5) / textureSize
    )
  );
}

void main() {
  float nodeIndex = floor(v_textureCoord.s * NODES_COUNT - 0.5 + EPSILON);
  if (nodeIndex > NODES_COUNT) return;

  vec4 nodePosition = readTexture(u_nodesPositionTexture, nodeIndex, NODES_TEXTURE_SIZE);
  float x = nodePosition.x;
  float y = nodePosition.y;
  float oldDx = nodePosition.b;
  float oldDy = nodePosition.a;
  float dx = 0.0;
  float dy = 0.0;

  vec3 nodeDimensions = readTexture(u_nodesDimensionsTexture, nodeIndex, NODES_TEXTURE_SIZE).rgb;
  float nodeMass = nodeDimensions.r;
  float nodeSize = nodeDimensions.g;
  float nodeConvergence = nodeDimensions.b;

  vec2 nodeEdgesPointers = readTexture(u_nodesEdgesPointersTexture, nodeIndex, NODES_TEXTURE_SIZE).xy;
  float edgesOffset = nodeEdgesPointers.r;
  float neighborsCount = nodeEdgesPointers.g;

  // REPULSION:
  float repulsionCoefficient = u_scalingRatio;
  for (float j = 0.0; j < NODES_COUNT; j++) {
    if (j != nodeIndex) {
      vec4 otherNodePosition = readTexture(u_nodesPositionTexture, j, NODES_TEXTURE_SIZE);
      vec3 otherNodeDimensions = readTexture(u_nodesDimensionsTexture, j, NODES_TEXTURE_SIZE).rgb;
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

    vec2 edgeData = readTexture(u_edgesTexture, j + edgesOffset, EDGES_TEXTURE_SIZE).xy;
    float otherNodeIndex = edgeData.x;
    float weight = edgeData.y;
    float edgeWeightInfluence = pow(weight, u_edgeWeightInfluence);

    vec4 otherNodePosition = readTexture(u_nodesPositionTexture, otherNodeIndex, NODES_TEXTURE_SIZE);

    vec2 diff = nodePosition.xy - otherNodePosition.xy;

    #ifdef ADJUST_SIZES
      vec4 otherNodeDimensions = readTexture(u_nodesDimensionsTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
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
    gl_FragColor.z = min(
      1.0,
      sqrt(nodeSpeed * forceSquared * swingingFactor)
    );
  #endif

  gl_FragColor.x = x + dx * nodeSpeed / u_slowDown;
  gl_FragColor.y = y + dy * nodeSpeed / u_slowDown;
}`;

  return SHADER;
}
