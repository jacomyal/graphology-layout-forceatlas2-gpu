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

export function waitForNextRender() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export function waitForGPUCompletion(gl: WebGL2RenderingContext) {
  return new Promise((resolve, reject) => {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
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
