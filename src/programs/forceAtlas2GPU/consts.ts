export type ForceAtlas2Settings = {
  linLogMode: boolean;
  adjustSizes: boolean;
  strongGravityMode: boolean;
  outboundAttractionDistribution: boolean;
  repulsion:
    | { type: "all-pairs" }
    | { type: "quad-tree"; depth: number; theta: number }
    | { type: "k-means"; steps: number; centroids: number; reinitialize?: boolean }
    | { type: "k-means-grouped"; steps: number; centroids: number; reinitialize?: boolean };
  edgeWeightInfluence: number;
  scalingRatio: number;
  gravity: number;
  slowDown: number;
  maxForce: number;
  iterationsPerStep: number;
  debug: boolean;
};

export const DEFAULT_FORCE_ATLAS_2_SETTINGS: ForceAtlas2Settings = {
  linLogMode: false,
  adjustSizes: false,
  strongGravityMode: false,
  outboundAttractionDistribution: false,
  repulsion: { type: "all-pairs" },
  edgeWeightInfluence: 1,
  scalingRatio: 1,
  gravity: 1,
  slowDown: 1,
  maxForce: 10,
  iterationsPerStep: 10,
  debug: false,
};
