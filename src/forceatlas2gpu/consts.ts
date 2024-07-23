export const NODES_ATTRIBUTES_IN_POSITION_TEXTURE = 4;
export const NODES_ATTRIBUTES_IN_METADATA_TEXTURE = 2;
export const EDGES_ATTRIBUTES_IN_TEXTURE = 2;

export type ForceAtlas2Settings = {
  linLogMode: boolean;
  strongGravityMode: boolean;
  edgeWeightInfluence: number;
  scalingRatio: number;
  gravity: number;
  slowDown: number;
  maxForce: number;

  // Not implemented yet:
  // adjustSizes: boolean;
  // outboundAttractionDistribution: boolean;
};

export const DEFAULT_FORCE_ATLAS_2_SETTINGS: ForceAtlas2Settings = {
  linLogMode: false,
  strongGravityMode: false,
  edgeWeightInfluence: 1,
  scalingRatio: 1,
  gravity: 1,
  slowDown: 1,
  maxForce: 10,

  // Not implemented yet:
  // adjustSizes: false,
  // outboundAttractionDistribution: false,
};

export const UNIFORM_SETTINGS: (keyof ForceAtlas2Settings)[] = [
  "edgeWeightInfluence",
  "scalingRatio",
  "gravity",
  "slowDown",
  "maxForce",
];

export const TEXTURES_NAMES = ["nodesPositionTexture", "nodesMetadataTexture", "edgesTexture"];

export type ForceAtlas2RunOptions = {
  iterations: number;
};

export const DEFAULT_FORCE_ATLAS_2_RUN_OPTIONS: ForceAtlas2RunOptions = {
  iterations: 1,
};
