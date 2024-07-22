import {
  EDGES_ATTRIBUTES_IN_TEXTURE,
  NODES_ATTRIBUTES_IN_METADATA_TEXTURE,
  NODES_ATTRIBUTES_IN_POSITION_TEXTURE,
} from "./consts";

export function getFragmentShader({
  nodesCount,
  edgesCount,
  maxNeighborsCount,
  strongGravityMode,
  linLogMode,
}: {
  nodesCount: number;
  edgesCount: number;
  maxNeighborsCount: number;
  strongGravityMode?: boolean;
  linLogMode?: boolean;
}) {
  // language=GLSL
  const SHADER = /*glsl*/ `
precision highp float;

#define NODES_COUNT ${nodesCount}
#define EDGES_COUNT ${edgesCount}
#define NODES_POSITION_TEXTURE_SIZE ${nodesCount * NODES_ATTRIBUTES_IN_POSITION_TEXTURE}
#define NODES_METADATA_TEXTURE_SIZE ${nodesCount * NODES_ATTRIBUTES_IN_METADATA_TEXTURE}
#define EDGES_TEXTURE_SIZE ${edgesCount * EDGES_ATTRIBUTES_IN_TEXTURE}
#define MAX_NEIGHBORS_COUNT ${maxNeighborsCount}
${linLogMode ? "#define LINLOG_MODE;\n" : ""}
${strongGravityMode ? "#define STRONG_GRAVITY_MODE;\n" : ""}

// Textures management:
uniform sampler2D u_nodesPositionTexture;
uniform sampler2D u_nodesMetadataTexture;
uniform sampler2D u_edgesTexture;
varying vec2 v_textureCoord;

// Settings management:
uniform float u_edgeWeightInfluence;
uniform float u_edgesTexture;
uniform float u_gravity;
uniform float u_maxForce;
uniform float u_scalingRatio;
uniform float u_slowdown;

void main() {
  vec4 nodePosition = texture2D(
    u_nodesPositionTexture,
    vec2(int(floor(v_textureCoord.s * float(NODES_POSITION_TEXTURE_SIZE) + 0.5)), 1)
  );
  vec2 nodeMetadata = texture2D(
    u_nodesMetadataTexture,
    vec2(int(floor(v_textureCoord.s * float(NODES_METADATA_TEXTURE_SIZE) + 0.5)), 1)
  );

  float x = nodePosition.x;
  float x = nodePosition.y;
  float oldDx = nodePosition.b;
  float oldDy = nodePosition.a;
  float dx = 0.0;
  float dy = 0.0;

  // REPULSION:
  for (int j = 0; j < NODES_COUNT; j++) {
    if (i != j + 1) {
      vec4 otherNodePosition = texture2D(
        u_nodesPositionTexture,
        vec2((float(j) + 0.5) / float(NODES_POSITION_TEXTURE_SIZE), 1)
      );
      vec2 diff = nodePosition.xy - otherNodePosition.xy;
      float dSquare = dot(diff, diff);

      if (dSquare > 0.0) {
        float factor = u_scalingRatio / dSquare;
        dx += diff.x * factor;
        dy += diff.y * factor;
      }
    }
  }

  // GRAVITY:
  float distanceToCenter = sqrt(x * x + y * y);
  if (STRONG_GRAVITY_MODE) {
    if (distanceToCenter > 0.0) factor = u_gravity;
  } else {
    if (distanceToCenter > 0.0) factor = u_gravity / distanceToCenter;
  }
  dx -= x * factor;
  dy -= y * factor;

  // ATTRACTION:
  int edgesOffset = int(nodeMetadata.x);
  int neighborsCount = int(nodeMetadata.y);
  for (int j = 0; j < MAX_NEIGHBORS_COUNT; j++) {
    if (j >= neighborsCount) break;
    
    vec2 edgeData = texture2D(u_edgesTexture, vec2((float(j) + 0.5) / float(EDGES_TEXTURE_SIZE), 1));
    float otherNodeIndex = edgeData.x;
    float weight = edgeData.y;
    vec4 otherNodePosition = texture2D(
      u_nodesPositionTexture,
      vec2((otherNodeIndex + 0.5) / float(NODES_POSITION_TEXTURE_SIZE), 1)
    );

    vec2 diff = nodePosition.xy - otherNodePosition.xy;
    float d = sqrt(dot(diff, diff));
    
    float edgeWeightInfluence = pow(weight, u_edgeWeightInfluence);

    float factor;
    if (LINLOG_MODE) {
      // LinLog Degree Distributed Anti-collision Attraction
      if (d > 0.0) {
        factor = (-u_scalingRatio * edgeWeightInfluence * log(1 + d)) / d;
      }
    } else {
      // Linear Degree Distributed Anti-collision Attraction
      if (d > 0.0) {
        factor = -u_scalingRatio * edgeWeightInfluence;
      }
    }

    if (d > 0.0) {
      dx += diff.x * factor;
      dy += diff.y * factor;
    }
  }
  
  // APPLY FORCES:
  float force = sqrt(
    pow(dx, 2.0)
    + pow(dy, 2.0)
  );
  if (force > u_maxForce) {
    dx = dx * u_maxForce / force;
    dy = dy * u_maxForce / force;
  }
  
  float swinging = sqrt(
    pow(oldDx - dx, 2.0)
    + pow(oldDy - dy, 2.0)
  );
  float traction = sqrt(
    pow(oldDx + dx, 2.0)
    + pow(oldDy + dy, 2.0)
  ) / 2;
  float nodeSpeed = (0.1 * log(1.0 + traction)) / (1.0 + sqrt(swinging)) / u_slowdown;

  gl_FragColor.x = x + dx * nodeSpeed;
  gl_FragColor.y = y + dy * nodeSpeed;
}`;

  return SHADER;
}
