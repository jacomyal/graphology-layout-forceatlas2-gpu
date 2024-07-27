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
  // Check the end of this file to see all data about each region
  "regions",
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
  regions: { attributesPerItem: 3, getItemsCount: () => 2 },
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

export type ForceAtlas2Flags = {
  linLogMode: boolean;
  adjustSizes: boolean;
  strongGravityMode: boolean;
  outboundAttractionDistribution: boolean;
  barnesHutOptimize: boolean;
};
export type ForceAtlas2Cursors = {
  edgeWeightInfluence: number;
  scalingRatio: number;
  gravity: number;
  slowDown: number;
  maxForce: number;
  barnesHutTheta: number;
};
export type ForceAtlas2Settings = ForceAtlas2Flags & ForceAtlas2Cursors;

export const DEFAULT_FORCE_ATLAS_2_FLAGS: ForceAtlas2Flags = {
  linLogMode: false,
  adjustSizes: false,
  strongGravityMode: false,
  outboundAttractionDistribution: false,
  barnesHutOptimize: false,
};
export const DEFAULT_FORCE_ATLAS_2_CURSORS: ForceAtlas2Cursors = {
  edgeWeightInfluence: 1,
  scalingRatio: 1,
  gravity: 1,
  slowDown: 1,
  maxForce: 10,
  barnesHutTheta: 0.5,
};
export const DEFAULT_FORCE_ATLAS_2_SETTINGS = {
  ...DEFAULT_FORCE_ATLAS_2_FLAGS,
  ...DEFAULT_FORCE_ATLAS_2_CURSORS,
};

export const UNIFORM_SETTINGS: (keyof ForceAtlas2Settings)[] = [
  "edgeWeightInfluence",
  "barnesHutTheta",
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

// Barnes-Hut regions management:
export const MAX_SUBDIVISION_ATTEMPTS = 3;
export const ATTRIBUTES_PER_REGION = 9;

// List of regions attributes:
export const REGION_NODE = 0;
export const REGION_CENTER_X = 1;
export const REGION_CENTER_Y = 2;
export const REGION_SIZE = 3;
export const REGION_NEXT_SIBLING = 4;
export const REGION_FIRST_CHILD = 5;
export const REGION_MASS_CENTER_X = 6;
export const REGION_MASS_CENTER_Y = 7;
export const REGION_MASS = 8;
