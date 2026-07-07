export type ForceAtlas2Settings = {
  linLogMode: boolean;
  adjustSizes: boolean;
  strongGravityMode: boolean;
  outboundAttractionDistribution: boolean;
  repulsion:
    | { type: "all-pairs" }
    | { type: "quad-tree"; depth?: number; theta?: number }
    | { type: "k-means"; steps: number; centroids: number; resetCentroids: boolean; nodeToNodeRepulsion: boolean; centroidUpdateInterval: number };
  edgeWeightInfluence: number;
  scalingRatio: number;
  gravity: number;
  slowDown: number;
  maxForce: number;
  // Iterations issued per animation frame (GPU work only, never blocks):
  iterationsPerFrame: number;
  // Minimum delay (in ms) between two syncs of the positions back to the
  // graphology instance:
  syncInterval: number;
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
  iterationsPerFrame: 10,
  syncInterval: 200,
  debug: false,
};
