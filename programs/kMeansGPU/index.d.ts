export declare class KMeansGPU {
    private name;
    private gl;
    private nodesCount;
    private centroidsCount;
    private debug;
    private iterationCount;
    private initialPositionsProgram;
    private closestCentroidProgram;
    private centroidPositionProgram;
    constructor(gl: WebGL2RenderingContext, { nodesCount, centroidsCount, debug, iterationCount, }: {
        nodesCount: number;
        centroidsCount?: number;
        debug?: boolean;
        iterationCount?: number;
    });
    wireTextures(nodesTexture: WebGLTexture): void;
    initialize(iterationCount?: number): void;
    compute({ steps, reinitialize, iterationCount, }: {
        steps: number;
        reinitialize?: boolean;
        iterationCount?: number;
    }): void;
    getCentroidsPosition(): WebGLTexture;
    getClosestCentroid(): WebGLTexture;
    getCentroidsPositionData(): number[];
    getInitialCentroidsPositionData(): number[];
    getClosestCentroidData(): number[];
    setNodesData(nodes: {
        x: number;
        y: number;
        mass?: number;
    }[]): void;
    private validateCentroidsPosition;
    private validateClosestCentroid;
    validate(): void;
}
