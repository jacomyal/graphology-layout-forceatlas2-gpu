import { Index } from '../webCLProgram';

export type QuadTreeGPUSettings = {
    depth: number;
};
export type QuadTreeNode = {
    x: number;
    y: number;
    mass?: number;
};
export declare const DEFAULT_QUAD_TREE_GPU_SETTINGS: QuadTreeGPUSettings;
export declare class QuadTreeGPU {
    private gl;
    private nodesCount;
    private params;
    private boundariesProgram;
    private indexProgram;
    private aggregateProgram;
    private offsetProgram;
    private setupSortProgram;
    private bitonicSort;
    constructor(gl: WebGL2RenderingContext, { nodesTexture, nodesCount }: {
        nodesCount: number;
        nodesTexture?: WebGLTexture;
    }, params?: Partial<QuadTreeGPUSettings>);
    wireTextures(nodesTexture?: WebGLTexture): void;
    compute(): Promise<void>;
    getNodesRegionsTexture(): WebGLTexture;
    getRegionsBarycentersTexture(): WebGLTexture;
    getRegionsOffsetsTexture(): WebGLTexture;
    getNodesInRegionsTexture(): WebGLTexture;
    getBoundariesTexture(): WebGLTexture;
    getPrograms(): {
        bitonicProgram: Index<"values" | "sortOn", "sortedValue", "pass" | "stage">;
        boundariesProgram: Index<"nodesPosition", "boundaries", string>;
        indexProgram: Index<"nodesPosition" | "boundaries", "nodesRegionsIDs", string>;
        aggregateProgram: Index<"nodesPosition" | "nodesRegionsIDs", "regionsBarycenters", string>;
        offsetProgram: Index<"regionsBarycenters", "regionsOffsets", string>;
        setupSortProgram: Index<"nodesRegionsIDs", "values" | "sortOn", string>;
    };
    setNodesData(nodes: QuadTreeNode[]): void;
    getBoundaries(): number[];
    getNodesRegions(): number[];
    getRegionsBarycenters(): number[];
    getRegionsOffsets(): number[];
    getNodesInRegions(): number[];
}
