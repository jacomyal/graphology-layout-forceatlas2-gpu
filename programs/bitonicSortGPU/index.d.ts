import { WebCLProgram } from '../webCLProgram';

export declare class BitonicSortGPU {
    private gl;
    private valuesCount;
    private extendedValuesCount;
    private textureSize;
    private attributesPerItem;
    private bitonicProgram;
    constructor(gl: WebGL2RenderingContext, { valuesCount, attributesPerItem }: {
        valuesCount: number;
        attributesPerItem: number;
    });
    sort(): void;
    setTextures({ valuesTexture, sortOnTexture }: {
        valuesTexture: WebGLTexture;
        sortOnTexture: WebGLTexture;
    }): void;
    getSortedTexture(): WebGLTexture;
    getPrograms(): {
        bitonicProgram: WebCLProgram<"values" | "sortOn", "sortedValue", "pass" | "stage">;
    };
    setData(sortOn: number[], tooHighValue: number): void;
    getSortedValues(): number[];
}
