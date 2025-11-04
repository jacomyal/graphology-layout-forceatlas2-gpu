export const DATA_TEXTURES_LEVELS: Record<number, number> = {
  1: WebGL2RenderingContext.R32F,
  2: WebGL2RenderingContext.RG32F,
  3: WebGL2RenderingContext.RGB32F,
  4: WebGL2RenderingContext.RGBA32F,
};

export const DATA_TEXTURES_FORMATS: Record<number, number> = {
  1: WebGL2RenderingContext.RED,
  2: WebGL2RenderingContext.RG,
  3: WebGL2RenderingContext.RGB,
  4: WebGL2RenderingContext.RGBA,
};

export function setupWebGL2Context() {
  // Initialize WebGL2 context:
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 is not supported in this browser.");

  // Check for required extension
  const ext = gl.getExtension("EXT_color_buffer_float");
  if (!ext) {
    throw new Error("EXT_color_buffer_float extension not supported");
  }

  return { canvas, gl };
}

export function getTextureSize(itemsCount: number) {
  return Math.ceil(Math.sqrt(itemsCount));
}

export function readTextureData(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  items: number,
  attributesPerItem: number,
): Float32Array {
  const textureSize = getTextureSize(items);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    throw new Error("Failed to create framebuffer for reading texture data.");
  }

  const outputArr = new Float32Array(textureSize * textureSize * attributesPerItem);
  gl.readPixels(0, 0, textureSize, textureSize, DATA_TEXTURES_FORMATS[attributesPerItem], gl.FLOAT, outputArr);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);

  return outputArr;
}

/**
 * Computes the next power of 2 greater than or equal to the given count.
 *
 * This is required for BitonicSort, which only works on arrays whose length
 * is a power of 2. When sorting N items where N is not a power of 2, we must:
 * 1. Extend the array to the next power of 2 (padding with "excess" values)
 * 2. Sort all positions including excess ones
 * 3. Only use the first N sorted values
 *
 * Example: 10,000 nodes → 16,384 (2^14) total positions in sorted array
 *
 * @param itemsCount The actual number of items to sort
 * @returns The next power of 2 >= itemsCount
 */
export function getNextPowerOfTwo(itemsCount: number): number {
  return 2 ** Math.ceil(Math.log2(itemsCount));
}

/**
 * Computes the texture size needed to store a sorted array from BitonicSort.
 *
 * BitonicSort outputs arrays sized to the next power of 2, not the original
 * item count. This function returns the texture dimensions for that output.
 *
 * Example: 10,000 items → 16,384 positions → 128×128 texture
 *
 * @param itemsCount The actual number of items being sorted
 * @returns The texture size (width/height) for the sorted output
 */
export function getSortedTextureSize(itemsCount: number): number {
  return getTextureSize(getNextPowerOfTwo(itemsCount));
}

export function numberToGLSLFloat(n: number): string {
  return n % 1 === 0 ? n.toFixed(1) : n.toString();
}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type) as WebGLShader;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error("Failed to compile shader: " + gl.getShaderInfoLog(shader));
  }

  return shader;
}

export function waitForGPUCompletion(gl: WebGL2RenderingContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) as WebGLSync;
    gl.flush();

    function checkSync() {
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        requestAnimationFrame(checkSync);
      } else if (status === gl.CONDITION_SATISFIED || status === gl.ALREADY_SIGNALED) {
        gl.deleteSync(sync);
        resolve();
      } else {
        gl.deleteSync(sync);
        reject(new Error("Failed to wait for GPU sync"));
      }
    }

    // Start checking the sync status
    checkSync();
  });
}

// language=GLSL
export const GLSL_getValueInTexture = /*glsl*/ `
vec4 getValueInTexture(sampler2D inputTexture, float index, float textureSize) {
  float row = floor(index / textureSize);
  float col = index - row * textureSize;

  return texelFetch(inputTexture, ivec2(int(col), int(row)), 0);
}
`;

// language=GLSL
export const GLSL_getIndex = /*glsl*/ `
float getIndex(vec2 positionInTexture, float textureSize) {
  float col = floor(positionInTexture.x * textureSize);
  float row = floor(positionInTexture.y * textureSize);
  return row * textureSize + col;
}
`;
