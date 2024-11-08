import { default as Graph } from '../../../@types/graphology';
import { EdgeDisplayData, NodeDisplayData } from 'sigma/types';
import { ForceAtlas2Settings } from './consts';

export type ForceAtlas2Graph = Graph<NodeDisplayData, EdgeDisplayData & {
    weight?: number;
}>;
export declare class ForceAtlas2GPU {
    private canvas;
    private gl;
    private remainingSteps;
    private running;
    private animationFrameID;
    private params;
    private graph;
    private maxNeighborsCount;
    private outboundAttCompensation;
    private nodeDataCache;
    private nodesPositionArray;
    private nodesMovementArray;
    private nodesMetadataArray;
    private edgesArray;
    private fa2Program;
    private quadTree;
    private kMeans;
    constructor(graph: ForceAtlas2Graph, params?: Partial<ForceAtlas2Settings>);
    private readGraph;
    private updateGraph;
    private swapFA2Textures;
    private step;
    start(steps?: number): void;
    stop(): void;
    run(): void;
    isRunning(): boolean;
}
