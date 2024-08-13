import Graph from "graphology";

export const DATA_TEXTURES = [
  // For each node: x, y
  "nodesPosition",
  // For each node: mass, size, firstEdgePosition, edgesCount
  "nodesMetadata",
  // For each edge: target, weight
  "edges",
] as const;

export type TextureName = (typeof DATA_TEXTURES)[number];

export const DATA_TEXTURES_SPECS: Record<
  TextureName,
  { attributesPerItem: number; getItemsCount: (graph: Graph) => number }
> = {
  nodesPosition: { attributesPerItem: 2, getItemsCount: (graph: Graph) => graph.order },
  nodesMetadata: { attributesPerItem: 4, getItemsCount: (graph: Graph) => graph.order },
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

export type ForceAtlas2Flags = {
  linLogMode: boolean;
  adjustSizes: boolean;
  strongGravityMode: boolean;
  outboundAttractionDistribution: boolean;
};
export type ForceAtlas2Cursors = {
  edgeWeightInfluence: number;
  scalingRatio: number;
  gravity: number;
  slowDown: number;
  maxForce: number;
  iterationsPerStep: number;
};
export type ForceAtlas2Settings = ForceAtlas2Flags & ForceAtlas2Cursors;

export const DEFAULT_FORCE_ATLAS_2_FLAGS: ForceAtlas2Flags = {
  linLogMode: false,
  adjustSizes: false,
  strongGravityMode: false,
  outboundAttractionDistribution: false,
};
export const DEFAULT_FORCE_ATLAS_2_CURSORS: ForceAtlas2Cursors = {
  edgeWeightInfluence: 1,
  scalingRatio: 1,
  gravity: 1,
  slowDown: 1,
  maxForce: 10,
  iterationsPerStep: 50,
};
export const DEFAULT_FORCE_ATLAS_2_SETTINGS = {
  ...DEFAULT_FORCE_ATLAS_2_FLAGS,
  ...DEFAULT_FORCE_ATLAS_2_CURSORS,
};

export const UNIFORM_SETTINGS = Object.keys(DEFAULT_FORCE_ATLAS_2_CURSORS) as (keyof ForceAtlas2Settings)[];
