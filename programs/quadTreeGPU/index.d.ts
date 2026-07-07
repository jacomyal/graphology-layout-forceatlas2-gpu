export type QuadTreeGPUSettings = {
    depth: number;
};
export type QuadTreeNode = {
    x: number;
    y: number;
    mass?: number;
};
export declare function getDefaultQuadTreeDepth(nodesCount: number): number;
export declare function getQuadTreeLevelSize(level: number): number;
export declare function getQuadTreeLevelRowOffset(level: number): number;
export declare function getQuadTreeAtlasWidth(depth: number): number;
export declare function getQuadTreeAtlasHeight(depth: number): number;
export declare class QuadTreeGPU {
    private gl;
    private nodesCount;
    private params;
    private boundaries;
    private splatProgram;
    private splatVAO;
    private splatUniformLocations;
    private atlasTexture;
    private atlasFramebuffer;
    constructor(gl: WebGL2RenderingContext, { nodesTexture, nodesCount }: {
        nodesCount: number;
        nodesTexture?: WebGLTexture;
    }, params: QuadTreeGPUSettings);
    wireTextures(nodesTexture?: WebGLTexture): void;
    compute(): void;
    getAtlasTexture(): WebGLTexture;
    getBoundariesTexture(): WebGLTexture;
    getDepth(): number;
    setNodesData(nodes: QuadTreeNode[]): void;
    getBoundaries(): number[];
    getLevelData(level: number): Float32Array;
}
