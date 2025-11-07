import { WebCLProgram } from '../webCLProgram';

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
    compute(): void;
    getNodesRegionsTexture(): WebGLTexture;
    getRegionsBarycentersTexture(): WebGLTexture;
    getRegionsOffsetsTexture(): WebGLTexture;
    getNodesInRegionsTexture(): WebGLTexture;
    getBoundariesTexture(): WebGLTexture;
    getPrograms(): {
        bitonicProgram: WebCLProgram<"values" | "sortOn", "sortedValue", "pass" | "stage">;
        boundariesProgram: WebCLProgram<"nodesPosition", "boundaries", string>;
        indexProgram: WebCLProgram<"nodesPosition" | "boundaries", "nodesRegionsIDs", string>;
        aggregateProgram: WebCLProgram<"nodesPosition" | "nodesRegionsIDs", "regionsBarycenters", string>;
        offsetProgram: WebCLProgram<"regionsBarycenters", "regionsOffsets", string>;
        setupSortProgram: WebCLProgram<"nodesRegionsIDs", "values" | "sortOn", string>;
    };
    setNodesData(nodes: QuadTreeNode[]): void;
    getBoundaries(): number[];
    getNodesRegions(): number[];
    getRegionsBarycenters(): number[];
    getRegionsOffsets(): number[];
    getNodesInRegions(): number[];
}
