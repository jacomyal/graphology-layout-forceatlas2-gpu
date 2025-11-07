import { BitonicSortGPU } from '../bitonicSortGPU';
import { KMeansGPU } from '../kMeansGPU';
import { WebCLProgram } from '../webCLProgram';

export declare class KMeansGroupedGPU {
    private name;
    private gl;
    private nodesCount;
    private centroidsCount;
    private debug;
    private kMeans;
    private setupSortProgram;
    private offsetProgram;
    private bitonicSort;
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
    getCentroidsOffsets(): WebGLTexture;
    getNodesInCentroids(): WebGLTexture;
    getClosestCentroid(): WebGLTexture;
    validateCentroidsOffsets(): void;
    validateNodesInCentroids(): void;
    validateSortedArrayConsistency(): void;
    validate(): void;
    getKMeans(): KMeansGPU;
    getOffsetProgram(): WebCLProgram<"centroidsPosition", "centroidsOffsets", string>;
    getBitonicSort(): BitonicSortGPU;
}
