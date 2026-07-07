import { createFloatTexture, createFramebuffer, createProgram, getTextureSize } from "../../utils/webgl";
import { getVertexShader } from "../webCLProgram/vertex";
import { getBoundariesInitFragmentShader } from "./fragment-init";
import { getBoundariesReduceFragmentShader } from "./fragment-reduce";

const REDUCE_FACTOR = 4;

export type BoundariesNode = { x: number; y: number; mass?: number };

/**
 * This class computes the bounding box (xMin, xMax, yMin, yMax) of the nodes,
 * as a 1x1 RGBA32F texture, using a parallel min/max reduction: each pass
 * merges 4x4 blocks of the previous pass, so the whole computation takes
 * O(log(nodesCount)) small fully-parallel draw calls, instead of one
 * O(nodesCount) serial loop in a single fragment.
 */
export class BoundariesGPU {
  private gl: WebGL2RenderingContext;
  private sourceSize: number;
  private passSizes: number[];

  // Programs:
  private initProgram: WebGLProgram;
  private reduceProgram: WebGLProgram;
  private initUniformLocations: { nodesPositionTexture: WebGLUniformLocation | null };
  private reduceUniformLocations: {
    inputTexture: WebGLUniformLocation | null;
    inputSize: WebGLUniformLocation | null;
  };
  private vao: WebGLVertexArrayObject;

  // Textures:
  private nodesTexture: WebGLTexture;
  private pingTexture: WebGLTexture;
  private pongTexture: WebGLTexture;
  private boundariesTexture: WebGLTexture;
  private pingFramebuffer: WebGLFramebuffer;
  private pongFramebuffer: WebGLFramebuffer;
  private boundariesFramebuffer: WebGLFramebuffer;

  constructor(gl: WebGL2RenderingContext, { nodesTexture, nodesCount }: { nodesCount: number; nodesTexture?: WebGLTexture }) {
    this.gl = gl;
    this.sourceSize = getTextureSize(nodesCount);

    // Sizes of each pass output, down to 1:
    this.passSizes = [Math.ceil(this.sourceSize / REDUCE_FACTOR)];
    while (this.passSizes[this.passSizes.length - 1] > 1) {
      this.passSizes.push(Math.ceil(this.passSizes[this.passSizes.length - 1] / REDUCE_FACTOR));
    }

    // Programs:
    this.initProgram = createProgram(gl, getVertexShader(), getBoundariesInitFragmentShader({ nodesCount }), "boundaries init program");
    this.reduceProgram = createProgram(gl, getVertexShader(), getBoundariesReduceFragmentShader(), "boundaries reduce program");
    this.initUniformLocations = {
      nodesPositionTexture: gl.getUniformLocation(this.initProgram, "u_nodesPositionTexture"),
    };
    this.reduceUniformLocations = {
      inputTexture: gl.getUniformLocation(this.reduceProgram, "u_inputTexture"),
      inputSize: gl.getUniformLocation(this.reduceProgram, "u_inputSize"),
    };

    // Quad geometry, in a dedicated VAO so that the attribute 0 state shared
    // by all WebCLPrograms (on the default VAO) is left untouched:
    this.vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(this.vao);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Textures and framebuffers:
    this.nodesTexture = createFloatTexture(gl, this.sourceSize);
    const pingPongSize = this.passSizes[0];
    this.pingTexture = createFloatTexture(gl, pingPongSize);
    this.pongTexture = createFloatTexture(gl, pingPongSize);
    this.boundariesTexture = createFloatTexture(gl, 1);
    this.pingFramebuffer = createFramebuffer(gl, this.pingTexture, "BoundariesGPU ping framebuffer");
    this.pongFramebuffer = createFramebuffer(gl, this.pongTexture, "BoundariesGPU pong framebuffer");
    this.boundariesFramebuffer = createFramebuffer(gl, this.boundariesTexture, "BoundariesGPU boundaries framebuffer");

    // Initial data textures rebind:
    this.wireTextures(nodesTexture);
  }

  /**
   * Public API:
   * ***********
   */
  public wireTextures(nodesTexture?: WebGLTexture) {
    if (nodesTexture) this.nodesTexture = nodesTexture;
  }

  public compute() {
    const { gl, passSizes } = this;

    gl.bindVertexArray(this.vao);

    passSizes.forEach((size, passIndex) => {
      const isLastPass = size === 1;

      if (passIndex === 0) {
        gl.useProgram(this.initProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.nodesTexture);
        gl.uniform1i(this.initUniformLocations.nodesPositionTexture, 0);
      } else {
        gl.useProgram(this.reduceProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, passIndex % 2 === 1 ? this.pingTexture : this.pongTexture);
        gl.uniform1i(this.reduceUniformLocations.inputTexture, 0);
        gl.uniform1i(this.reduceUniformLocations.inputSize, passSizes[passIndex - 1]);
      }

      const framebuffer = isLastPass
        ? this.boundariesFramebuffer
        : passIndex % 2 === 0
          ? this.pingFramebuffer
          : this.pongFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, size, size);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // These methods are for the WebGL pipelines:
  public getNodesTexture(): WebGLTexture {
    return this.nodesTexture;
  }
  public getBoundariesTexture(): WebGLTexture {
    return this.boundariesTexture;
  }

  // These methods are for using the boundaries directly (and for testing):
  public setNodesData(nodes: BoundariesNode[]) {
    const { gl, sourceSize } = this;
    const nodesByteArray = new Float32Array(4 * sourceSize ** 2);

    nodes.forEach(({ x, y, mass }, i) => {
      nodesByteArray[i * 4] = x;
      nodesByteArray[i * 4 + 1] = y;
      nodesByteArray[i * 4 + 2] = mass || 1;
    });

    gl.bindTexture(gl.TEXTURE_2D, this.nodesTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sourceSize, sourceSize, 0, gl.RGBA, gl.FLOAT, nodesByteArray);
  }
  public getBoundaries(): number[] {
    const { gl } = this;
    const outputArr = new Float32Array(4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.boundariesFramebuffer);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, outputArr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return Array.from(outputArr);
  }
}
