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
