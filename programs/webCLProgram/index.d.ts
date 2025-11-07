export declare class WebCLProgram<DATA_TEXTURE extends string = string, OUTPUT_TEXTURE extends string = string, UNIFORM extends string = string> {
    name: string;
    program: WebGLProgram;
    gl: WebGL2RenderingContext;
    size: number;
    fragments: number;
    uniformLocations: Partial<Record<UNIFORM, WebGLUniformLocation>>;
    dataTextures: {
        name: DATA_TEXTURE;
        attributesPerItem: number;
        items: number;
        index: number;
        texture: WebGLTexture;
    }[];
    dataTexturesIndex: Record<DATA_TEXTURE, (typeof this.dataTextures)[number]>;
    outputBuffer: WebGLFramebuffer;
    outputTextures: {
        name: OUTPUT_TEXTURE;
        attributesPerItem: number;
        index: number;
        texture: WebGLTexture;
        isAllocated: boolean;
    }[];
    outputTexturesIndex: Record<OUTPUT_TEXTURE, (typeof this.outputTextures)[number]>;
    constructor({ gl, fragments, dataTextures, outputTextures, fragmentShaderSource, vertexShaderSource, name, }: {
        gl: WebGL2RenderingContext;
        fragments: number;
        dataTextures: {
            name: DATA_TEXTURE;
            attributesPerItem: number;
            items: number;
        }[];
        outputTextures: {
            name: OUTPUT_TEXTURE;
            attributesPerItem: number;
        }[];
        fragmentShaderSource: string;
        vertexShaderSource: string;
        name: string;
    });
    activate(): void;
    prepare(): void;
    setUniforms(uniforms: Record<UNIFORM, unknown>): void;
    setTextureData(textureName: DATA_TEXTURE, data: Float32Array, items: number): void;
    compute(): void;
    swapTextures(input: DATA_TEXTURE, output: OUTPUT_TEXTURE): void;
    getOutputs(): Partial<Record<OUTPUT_TEXTURE, Float32Array>>;
    getOutput(textureName: OUTPUT_TEXTURE): Float32Array;
    getInput(textureName: DATA_TEXTURE): Float32Array;
    kill(): void;
    static wirePrograms(programs: Record<string, WebCLProgram>): void;
}
