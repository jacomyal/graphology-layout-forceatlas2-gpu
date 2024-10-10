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
export declare const DEFAULT_FORCE_ATLAS_2_FLAGS: ForceAtlas2Flags;
export declare const DEFAULT_FORCE_ATLAS_2_CURSORS: ForceAtlas2Cursors;
export declare const DEFAULT_FORCE_ATLAS_2_SETTINGS: {
    edgeWeightInfluence: number;
    scalingRatio: number;
    gravity: number;
    slowDown: number;
    maxForce: number;
    iterationsPerStep: number;
    quadTreeDepth: number;
    quadTreeTheta: number;
    linLogMode: boolean;
    adjustSizes: boolean;
    strongGravityMode: boolean;
    outboundAttractionDistribution: boolean;
    enableQuadTree: boolean;
};
export declare const UNIFORM_SETTINGS: (keyof ForceAtlas2Cursors)[];
