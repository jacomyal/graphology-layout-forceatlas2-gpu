export const DATA_TEXTURES_LEVELS: Record<number, number> = {
  1: WebGL2RenderingContext.R32F,
  2: WebGL2RenderingContext.RG32F,
  3: WebGL2RenderingContext.RGB32F,
  4: WebGL2RenderingContext.RGBA32F,
};

export const DATA_TEXTURES_FORMATS: Record<number, number> = {
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
  enableQuadTree: boolean;
};
export type ForceAtlas2Cursors = {
  edgeWeightInfluence: number;
  scalingRatio: number;
  gravity: number;
  slowDown: number;
  maxForce: number;
  iterationsPerStep: number;
  quadTreeDepth: number;
  quadTreeTheta: number;
};
export type ForceAtlas2Settings = ForceAtlas2Flags & ForceAtlas2Cursors;

export const DEFAULT_FORCE_ATLAS_2_FLAGS: ForceAtlas2Flags = {
  linLogMode: false,
  adjustSizes: false,
  strongGravityMode: false,
  outboundAttractionDistribution: false,
  enableQuadTree: false,
};
export const DEFAULT_FORCE_ATLAS_2_CURSORS: ForceAtlas2Cursors = {
  edgeWeightInfluence: 1,
  scalingRatio: 1,
  gravity: 1,
  slowDown: 1,
  maxForce: 10,
  iterationsPerStep: 10,
  quadTreeDepth: 3,
  quadTreeTheta: 0.5,
};
export const DEFAULT_FORCE_ATLAS_2_SETTINGS = {
  ...DEFAULT_FORCE_ATLAS_2_FLAGS,
  ...DEFAULT_FORCE_ATLAS_2_CURSORS,
};

export const UNIFORM_SETTINGS = Object.keys(DEFAULT_FORCE_ATLAS_2_CURSORS) as (keyof ForceAtlas2Cursors)[];
