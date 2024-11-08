export declare function setupWebGL2Context(): {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
};
export declare function getTextureSize(itemsCount: number): number;
export declare function numberToGLSLFloat(n: number): string;
export declare function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader;
export declare function waitForGPUCompletion(gl: WebGL2RenderingContext): Promise<void>;
export declare const GLSL_getValueInTexture = "\nvec4 getValueInTexture(sampler2D inputTexture, float index, float textureSize) {\n  float row = floor(index / textureSize);\n  float col = index - row * textureSize;\n\n  return texelFetch(inputTexture, ivec2(int(col), int(row)), 0);\n}\n";
export declare const GLSL_getIndex = "\nfloat getIndex(vec2 positionInTexture, float textureSize) {\n  float col = floor(positionInTexture.x * textureSize);\n  float row = floor(positionInTexture.y * textureSize);\n  return row * textureSize + col;\n}\n";
