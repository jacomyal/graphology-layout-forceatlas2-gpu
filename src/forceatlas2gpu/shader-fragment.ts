import Graph from "graphology";

import { getTextureSize, numberToGLSLFloat } from "./utils";

export function getFragmentShader({
  graph,
  maxNeighborsCount,
  strongGravityMode,
  linLogMode,
}: {
  graph: Graph;
  maxNeighborsCount: number;
  strongGravityMode?: boolean;
  linLogMode?: boolean;
}) {
  // language=GLSL
  const SHADER = /*glsl*/ `
precision highp float;

#define EPSILON 0.01
#define NODES_COUNT ${numberToGLSLFloat(graph.order)}
#define EDGES_COUNT ${numberToGLSLFloat(graph.size)}
#define MAX_NEIGHBORS_COUNT ${numberToGLSLFloat(maxNeighborsCount)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.order))}
#define EDGES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.size))}
${linLogMode ? "#define LINLOG_MODE" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE" : ""}

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
  for (float j = 0.0; j < NODES_COUNT; j++) {
    if (j != nodeIndex) {
      vec4 otherNodePosition = readTexture(u_nodesPositionTexture, j, NODES_TEXTURE_SIZE);
      vec3 otherNodeDimensions = readTexture(u_nodesDimensionsTexture, j, NODES_TEXTURE_SIZE).rgb;
    
      float otherNodeMass = otherNodeDimensions.r;
      vec2 diff = nodePosition.xy - otherNodePosition.xy;
      float dSquare = dot(diff, diff);

      if (dSquare > 0.0) {
        float factor = u_scalingRatio * nodeMass * otherNodeMass / dSquare;
        dx += diff.x * factor;
        dy += diff.y * factor;
      }
    }
  }

  // GRAVITY:
  float distanceToCenter = sqrt(x * x + y * y);
  float gravityFactor = 0.0;
  #ifdef STRONG_GRAVITY_MODE
  gravityFactor = u_gravity * nodeMass;
  #else
  if (distanceToCenter > 0.0) gravityFactor = u_gravity * nodeMass / distanceToCenter;
  #endif

  dx -= x * gravityFactor;
  dy -= y * gravityFactor;

  // ATTRACTION:
  for (float j = 0.0; j < MAX_NEIGHBORS_COUNT; j++) {
    if (j >= neighborsCount) break;

    vec2 edgeData = readTexture(u_edgesTexture, j + edgesOffset, EDGES_TEXTURE_SIZE).xy;
    float otherNodeIndex = edgeData.x;
    float weight = edgeData.y;
    vec4 otherNodePosition = readTexture(u_nodesPositionTexture, otherNodeIndex, NODES_TEXTURE_SIZE);

    vec2 diff = nodePosition.xy - otherNodePosition.xy;
    float d = sqrt(dot(diff, diff));
    float edgeWeightInfluence = pow(weight, u_edgeWeightInfluence);

    float attractionFactor = 0.0;
    #ifdef LINLOG_MODE
    // LinLog Degree Distributed Anti-collision Attraction
    if (d > 0.0) {
      attractionFactor = (-edgeWeightInfluence * log(1 + d)) / d;
    }
    #else
    // Linear Degree Distributed Anti-collision Attraction
    attractionFactor = -edgeWeightInfluence;
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
  float nodeSpeed = (nodeConvergence * log(1.0 + traction)) * swingingFactor;

  gl_FragColor.x = x + dx * nodeSpeed / u_slowDown;
  gl_FragColor.y = y + dy * nodeSpeed / u_slowDown;
  
  // Store new node convergence:
  gl_FragColor.z = min(
    1.0,
    sqrt(nodeSpeed * forceSquared * swingingFactor)
  );
}`;

  return SHADER;
}
