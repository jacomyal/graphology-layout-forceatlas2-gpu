export const NODES_ATTRIBUTES_IN_POSITION_TEXTURE = 4;
export const NODES_ATTRIBUTES_IN_METADATA_TEXTURE = 2;
export const EDGES_ATTRIBUTES_IN_TEXTURE = 2;

export type ForceAtlas2Settings = {
  linLogMode: boolean;
  outboundAttractionDistribution: boolean;
  edgeWeightInfluence: number;
  scalingRatio: number;
  strongGravityMode: boolean;
  gravity: number;
  slowDown: number;

  // Not implemented yet:
  // adjustSizes: boolean;
};

export const DEFAULT_FORCE_ATLAS_2_SETTINGS: ForceAtlas2Settings = {
  linLogMode: false,
  outboundAttractionDistribution: false,
  edgeWeightInfluence: 1,
  scalingRatio: 1,
  strongGravityMode: false,
  gravity: 1,
  slowDown: 1,

  // Not implemented yet:
  // adjustSizes: false,
};
