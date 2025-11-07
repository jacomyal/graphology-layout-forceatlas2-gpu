import { ForceAtlas2Graph } from '../programs/forceAtlas2GPU';

export declare function calculateNearestNeighborDistances(graph: ForceAtlas2Graph): number[];
export declare function detectEmptyHalos(distances: number[], thresholdMultiplier?: number): {
    count: number;
    threshold: number;
    outlierIndices: number[];
};
