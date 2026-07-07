export type BoundariesNode = {
    x: number;
    y: number;
    mass?: number;
};
export declare class BoundariesGPU {
    private gl;
    private sourceSize;
    private passSizes;
    private initProgram;
    private reduceProgram;
    private initUniformLocations;
    private reduceUniformLocations;
    private vao;
    private nodesTexture;
    private pingTexture;
    private pongTexture;
    private boundariesTexture;
    private pingFramebuffer;
    private pongFramebuffer;
    private boundariesFramebuffer;
    constructor(gl: WebGL2RenderingContext, { nodesTexture, nodesCount }: {
        nodesCount: number;
        nodesTexture?: WebGLTexture;
    });
    wireTextures(nodesTexture?: WebGLTexture): void;
    compute(): void;
    getNodesTexture(): WebGLTexture;
    getBoundariesTexture(): WebGLTexture;
    setNodesData(nodes: BoundariesNode[]): void;
    getBoundaries(): number[];
}
