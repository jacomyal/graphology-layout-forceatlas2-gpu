import Graph from "graphology";

export const DATA_TEXTURES = [
  // For each node: x, y, dx, dy
  "nodesPosition",
  // For each node: mass, size, convergenceScore
  "nodesDimensions",
  // For each node: firstEdgePosition, edgesCount
  "nodesEdgesPointers",
  // For each edge: target, weight
  "edges",
] as const;

export type TextureName = (typeof DATA_TEXTURES)[number];

export const DATA_TEXTURES_SPECS: Record<
  TextureName,
  { attributesPerItem: number; getItemsCount: (graph: Graph) => number }
> = {
  nodesPosition: { attributesPerItem: 4, getItemsCount: (graph: Graph) => graph.order },
  nodesDimensions: { attributesPerItem: 3, getItemsCount: (graph: Graph) => graph.order },
  nodesEdgesPointers: { attributesPerItem: 2, getItemsCount: (graph: Graph) => graph.order },
  edges: { attributesPerItem: 2, getItemsCount: (graph: Graph) => graph.size * 2 },
};

export const DATA_TEXTURES_LEVELS = {
  1: WebGL2RenderingContext.R32F,
  2: WebGL2RenderingContext.RG32F,
  3: WebGL2RenderingContext.RGB32F,
  4: WebGL2RenderingContext.RGBA32F,
};

export const DATA_TEXTURES_FORMATS = {
  1: WebGL2RenderingContext.RED,
  2: WebGL2RenderingContext.RG,
  3: WebGL2RenderingContext.RGB,
  4: WebGL2RenderingContext.RGBA,
};

export type ForceAtlas2Settings = {
  linLogMode: boolean;
  adjustSizes: boolean;
  strongGravityMode: boolean;
  edgeWeightInfluence: number;
  scalingRatio: number;
  gravity: number;
  slowDown: number;
  maxForce: number;

  // Not implemented yet:
  // outboundAttractionDistribution: boolean;
};

export const DEFAULT_FORCE_ATLAS_2_SETTINGS: ForceAtlas2Settings = {
  linLogMode: false,
  adjustSizes: false,
  strongGravityMode: false,
  edgeWeightInfluence: 1,
  scalingRatio: 1,
  gravity: 1,
  slowDown: 1,
  maxForce: 10,

  // Not implemented yet:
  // outboundAttractionDistribution: false,
};

export const UNIFORM_SETTINGS: (keyof ForceAtlas2Settings)[] = [
  "edgeWeightInfluence",
  "scalingRatio",
  "gravity",
  "slowDown",
  "maxForce",
];

export type ForceAtlas2RunOptions = {
  iterationsPerStep: number;
};

export const DEFAULT_FORCE_ATLAS_2_RUN_OPTIONS: ForceAtlas2RunOptions = {
  iterationsPerStep: 1,
};
