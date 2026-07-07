import Graph from "graphology";

import { getDefaultQuadTreeDepth } from "../quadTreeGPU";
import {
  GLSL_getIndex,
  GLSL_getValueInTexture,
  getSortedTextureSize,
  getTextureSize,
  numberToGLSLFloat,
} from "../../utils/webgl";
import { ForceAtlas2Settings } from "./consts";

export function getForceAtlas2FragmentShader({
  graph,
  linLogMode,
  adjustSizes,
  strongGravityMode,
  outboundAttractionDistribution,
  repulsion,
}: {
  graph: Graph;
} & ForceAtlas2Settings) {
  const kMeansCentroids = repulsion.type === "k-means" ? repulsion.centroids : 1;
  const quadTreeDepth = repulsion.type === "quad-tree" ? (repulsion.depth ?? getDefaultQuadTreeDepth(graph.order)) : 1;
  // Cells more than quadTreeRing cells away (Chebyshev distance) are
  // considered "well separated", like Barnes-Hut cells passing the
  // size/distance < theta test (on a uniform grid, this is a distance in
  // cells: ceil(1/theta)):
  const quadTreeRing = repulsion.type === "quad-tree" ? Math.max(1, Math.ceil(1 / (repulsion.theta ?? 1))) : 1;

  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define NODES_COUNT ${numberToGLSLFloat(graph.order)}
#define NODES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.order))}
#define SORTED_TEXTURE_SIZE ${numberToGLSLFloat(getSortedTextureSize(graph.order))}
#define EDGES_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(graph.size * 2))}
#define K_MEANS_CENTROIDS_COUNT ${numberToGLSLFloat(kMeansCentroids)}
#define K_MEANS_CENTROIDS_TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(kMeansCentroids))}
#define QUAD_TREE_DEPTH ${Math.floor(quadTreeDepth)}
#define QUAD_TREE_RING ${Math.floor(quadTreeRing)}
${linLogMode ? "#define LINLOG_MODE" : ""}
${adjustSizes ? "#define ADJUST_SIZES" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE" : ""}
${outboundAttractionDistribution ? "#define OUTBOUND_ATTRACTION_DISTRIBUTION" : ""}
${repulsion.type === "quad-tree" ? "#define QUAD_TREE_ENABLED" : ""}
${repulsion.type === "k-means" && !repulsion.nodeToNodeRepulsion ? "#define K_MEANS_ENABLED" : ""}
${repulsion.type === "k-means" && repulsion.nodeToNodeRepulsion ? "#define K_MEANS_GROUPED_ENABLED" : ""}

// Graph data
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesMovementTexture;
uniform sampler2D u_nodesMetadataTexture;
uniform sampler2D u_edgesTexture;

// Quad-tree
uniform sampler2D u_boundariesTexture;
uniform sampler2D u_quadTreeTexture;

// K-means
uniform sampler2D u_centroidsPositionTexture;

// K-means-grouped
uniform sampler2D u_centroidsOffsetsTexture;
uniform sampler2D u_nodesInCentroidsTexture;
uniform sampler2D u_closestCentroidTexture;

in vec2 v_textureCoord;

// Settings management:
uniform float u_edgeWeightInfluence;
uniform float u_scalingRatio;
uniform float u_gravity;
uniform float u_maxForce;
uniform float u_slowDown;

#if defined(OUTBOUND_ATTRACTION_DISTRIBUTION)
  uniform float u_outboundAttCompensation;
#endif

// Output
layout(location = 0) out vec4 positionOutput;
layout(location = 1) out vec4 movementOutput;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

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

  #if defined(K_MEANS_ENABLED)
    // Node-to-centroid repulsion (k-means):
    for (float j = 0.0; j < K_MEANS_CENTROIDS_COUNT; j++) {
      vec4 centroidData = getValueInTexture(u_centroidsPositionTexture, j, K_MEANS_CENTROIDS_TEXTURE_SIZE);
      vec2 centroidPosition = centroidData.xy;
      float centroidMass = centroidData.z;

      vec2 diff = nodePosition.xy - centroidPosition.xy;
      float factor = 0.0;

      // Linear Repulsion
      float dSquare = dot(diff, diff);
      if (dSquare > 0.0) {
        factor = repulsionCoefficient * nodeMass * centroidMass / dSquare;
      }

      dx += diff.x * factor;
      dy += diff.y * factor;
    }

  #elif defined(K_MEANS_GROUPED_ENABLED)
    // Hybrid k-means repulsion with intra-cluster node-to-node:
    float nodeClosestCentroidID = getValueInTexture(u_closestCentroidTexture, nodeIndex, NODES_TEXTURE_SIZE).x;

    // 1. Inter-cluster: Node-to-centroid repulsion for OTHER centroids
    for (float centroidID = 0.0; centroidID < K_MEANS_CENTROIDS_COUNT; centroidID++) {
      if (centroidID == nodeClosestCentroidID) continue;

      vec4 centroidData = getValueInTexture(u_centroidsPositionTexture, centroidID, K_MEANS_CENTROIDS_TEXTURE_SIZE);
      vec2 centroidPosition = centroidData.xy;
      float centroidMass = centroidData.z;

      vec2 diff = nodePosition.xy - centroidPosition.xy;
      float factor = 0.0;

      // Linear Repulsion
      float dSquare = dot(diff, diff);
      if (dSquare > 0.0) {
        factor = repulsionCoefficient * nodeMass * centroidMass / dSquare;
      }

      dx += diff.x * factor;
      dy += diff.y * factor;
    }

    // 2. Intra-cluster: Node-to-node repulsion within same centroid
    vec2 centroidOffset = getValueInTexture(u_centroidsOffsetsTexture, nodeClosestCentroidID, K_MEANS_CENTROIDS_TEXTURE_SIZE).xy;
    float startIndex = centroidOffset.y;
    float endIndex = startIndex + centroidOffset.x;

    for (float j = startIndex; j < endIndex; j++) {
      float otherNodeIndex = getValueInTexture(u_nodesInCentroidsTexture, j, SORTED_TEXTURE_SIZE).x;
      if (otherNodeIndex == nodeIndex) continue;

      vec4 otherNodePosition = getValueInTexture(u_nodesPositionTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
      vec4 otherNodeMetadata = getValueInTexture(u_nodesMetadataTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
      float otherNodeMass = otherNodePosition.z;
      float otherNodeSize = otherNodeMetadata.r;

      vec2 diff = nodePosition.xy - otherNodePosition.xy;
      float factor = 0.0;

      #if defined(ADJUST_SIZES)
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

  #elif defined(QUAD_TREE_ENABLED)
    // Quadtree repulsion:
    // The quadtree is complete, so each level is a 2^(level+1) x 2^(level+1)
    // grid of cells, whose centers of mass are read from the atlas texture.
    // For a given node, at each level, the cells "well separated" from the
    // node (more than QUAD_TREE_RING cells away, i.e. passing the
    // size/distance < theta test) but not already handled at a coarser
    // level (inside its parent's neighborhood, refined) are used as single
    // bodies. At the finest level, the remaining neighborhood is used as
    // well, with the node's own contribution removed from its own cell.
    // Square bounding box (must match the splat vertex shader):
    vec4 boundaries = getValueInTexture(u_boundariesTexture, 0.0, 1.0);
    vec2 bbCenter = vec2((boundaries.x + boundaries.y) / 2.0, (boundaries.z + boundaries.w) / 2.0);
    float bbSide = max(max(boundaries.y - boundaries.x, boundaries.w - boundaries.z), 1e-6);
    vec2 relativePosition = clamp((nodePosition.xy - bbCenter) / bbSide + 0.5, 0.0, 0.999999);

    for (int level = 0; level < QUAD_TREE_DEPTH; level++) {
      int gridSize = 1 << (level + 1);
      int rowOffset = gridSize - 2;
      ivec2 cell = ivec2(floor(relativePosition * float(gridSize)));
      ivec2 blockMin = (cell / 2 - QUAD_TREE_RING) * 2;
      bool isFinestLevel = level == QUAD_TREE_DEPTH - 1;

      // The block of cells covering the node's parent cell's neighborhood at
      // the previous level:
      for (int i = 0; i < 4 * QUAD_TREE_RING + 2; i++) {
        for (int j = 0; j < 4 * QUAD_TREE_RING + 2; j++) {
          ivec2 otherCell = blockMin + ivec2(i, j);
          if (otherCell.x < 0 || otherCell.y < 0 || otherCell.x >= gridSize || otherCell.y >= gridSize) continue;

          bool isNeighborCell = abs(otherCell.x - cell.x) <= QUAD_TREE_RING && abs(otherCell.y - cell.y) <= QUAD_TREE_RING;
          if (isNeighborCell && !isFinestLevel) continue;

          vec4 cellData = texelFetch(u_quadTreeTexture, ivec2(otherCell.x, rowOffset + otherCell.y), 0);
          vec2 cellMassSum = cellData.rg;
          float cellMass = cellData.b;

          // Remove the node's own contribution from its own cell:
          if (isFinestLevel && all(equal(otherCell, cell))) {
            cellMassSum -= nodePosition.xy * nodeMass;
            cellMass -= nodeMass;
          }
          if (cellMass <= 0.0) continue;

          vec2 diff = nodePosition.xy - cellMassSum / cellMass;
          float dSquare = dot(diff, diff);
          if (dSquare <= 0.0) {
            // Coincident positions: use a deterministic tiny offset to break the tie
            float angle = nodeIndex * 2.399963229728653;
            diff = vec2(cos(angle), sin(angle)) * bbSide / float(gridSize) * 0.01;
            dSquare = dot(diff, diff);
          }

          // Linear Repulsion
          float factor = repulsionCoefficient * nodeMass * cellMass / dSquare;
          dx += diff.x * factor;
          dy += diff.y * factor;
        }
      }
    }

  #else
    // Node-to-node repulsion (no quad tree):
    for (float j = 0.0; j < NODES_COUNT; j++) {
      if (j == nodeIndex) continue;
    
      vec4 otherNodePosition = getValueInTexture(u_nodesPositionTexture, j, NODES_TEXTURE_SIZE);
      vec4 otherNodeMetadata = getValueInTexture(u_nodesMetadataTexture, j, NODES_TEXTURE_SIZE);
      float otherNodeMass = otherNodePosition.z;
      float otherNodeSize = otherNodeMetadata.r;
  
      vec2 diff = nodePosition.xy - otherNodePosition.xy;
      float factor = 0.0;
  
      #if defined(ADJUST_SIZES)
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
  #endif

  // GRAVITY:
  float distanceToCenter = sqrt(x * x + y * y);
  float gravityFactor = 0.0;
  #if defined(STRONG_GRAVITY_MODE)
    if (distanceToCenter > 0.0) gravityFactor = nodeMass * u_gravity;
  #else
    if (distanceToCenter > 0.0) gravityFactor = nodeMass * u_gravity / distanceToCenter;
  #endif

  dx -= x * gravityFactor;
  dy -= y * gravityFactor;

  // ATTRACTION:
  #if defined(OUTBOUND_ATTRACTION_DISTRIBUTION)
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

    #if defined(ADJUST_SIZES)
      vec4 otherNodeMetadata = getValueInTexture(u_nodesMetadataTexture, otherNodeIndex, NODES_TEXTURE_SIZE);
      float otherNodeSize = otherNodeMetadata.r;
      float d = sqrt(dot(diff, diff)) - nodeSize - otherNodeSize;
    #else
      float d = sqrt(dot(diff, diff));
    #endif

    float attractionFactor = 0.0;
    #if defined(LINLOG_MODE)
      #if defined(OUTBOUND_ATTRACTION_DISTRIBUTION)
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
      #if defined(ADJUST_SIZES)
      #else
        // NOTE: Distance is set to 1 to override next condition
        d = 1.0;
      #endif

      #if defined(OUTBOUND_ATTRACTION_DISTRIBUTION)
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

  #if defined(ADJUST_SIZES)
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
