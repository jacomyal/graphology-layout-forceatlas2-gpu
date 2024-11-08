export declare class KMeansGPU {
    private gl;
    private nodesCount;
    private centroidsCount;
    private initialPositionsProgram;
    private closestCentroidProgram;
    private centroidPositionProgram;
    constructor(gl: WebGL2RenderingContext, { nodesCount, centroidsCount, nodesTexture, }: {
        nodesCount: number;
        centroidsCount?: number;
        nodesTexture?: WebGLTexture;
    });
    initialize(): void;
    wireTextures(nodesTexture?: WebGLTexture): void;
    compute({ steps }?: {
        steps?: number;
    }): void;
    getCentroidsPosition(): WebGLTexture;
}
