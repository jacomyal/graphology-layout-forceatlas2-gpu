export type ForceAtlas2Settings = {
    linLogMode: boolean;
    adjustSizes: boolean;
    strongGravityMode: boolean;
    outboundAttractionDistribution: boolean;
    repulsion: {
        type: "all-pairs";
    } | {
        type: "quad-tree";
        depth: number;
        theta: number;
    } | {
        type: "k-means";
        steps: number;
        centroids: number;
    };
    edgeWeightInfluence: number;
    scalingRatio: number;
    gravity: number;
    slowDown: number;
    maxForce: number;
    iterationsPerStep: number;
};
export declare const DEFAULT_FORCE_ATLAS_2_SETTINGS: ForceAtlas2Settings;
