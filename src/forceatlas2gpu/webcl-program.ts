import { DATA_TEXTURES_FORMATS, DATA_TEXTURES_LEVELS } from "./consts";
import { compileShader, getTextureSize } from "./utils";

export class WebCLProgram<DATA_TEXTURE extends string = string, UNIFORM extends string = string> {
  public program: WebGLProgram;
  public gl: WebGL2RenderingContext;
  public size: number;

  public dataTexturesNames: DATA_TEXTURE[];
  public uniformLocations: Record<UNIFORM, WebGLUniformLocation> = {};
  public dataTextures: Record<DATA_TEXTURE, WebGLTexture> = {};
  public dataTextureIndexes: Record<DATA_TEXTURE, number> = {};
  public outputTexture: WebGLTexture;
  public outputFrameBuffer: WebGLFramebuffer;

  constructor({
    gl,
    cells,
    dataTextures,
    fragmentShaderSource,
    vertexShaderSource,
  }: {
    gl: WebGL2RenderingContext;
    cells: number;
    dataTextures: DATA_TEXTURE[];
    fragmentShaderSource: string;
    vertexShaderSource: string;
  }) {
    this.gl = gl;
    this.size = getTextureSize(cells);
    this.dataTexturesNames = dataTextures;

    // Instantiate program:
    this.program = gl.createProgram() as WebGLProgram;

    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);

    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error("Failed to link program: " + gl.getProgramInfoLog(this.program));
    }

    // Handle output:
    this.outputFrameBuffer = gl.createFramebuffer();
    this.outputTexture = gl.createTexture();

    // Create a buffer for the positions.
    const positionLocation = gl.getAttribLocation(this.program, "a_position");
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLocation);

    this.prepare();
  }

  /**
   * Public API:
   * ***********
   */
  public activate() {
    const { gl } = this;

    gl.useProgram(this.program);
    gl.viewport(0, 0, this.size, this.size);
  }

  public prepare() {
    const { gl, program, dataTexturesNames, dataTextureIndexes, dataTextures } = this;

    this.activate();

    dataTexturesNames.forEach((textureName, index) => {
      if (typeof dataTextureIndexes[textureName] !== "number") dataTextureIndexes[textureName] = index;
      if (!dataTextures[textureName]) dataTextures[textureName] = gl.createTexture();
      const texture = dataTextures[textureName];

      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program, `u_${textureName}Texture`), index);
    });

    // Handle output:
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.size, this.size, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFrameBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

    // Clean:
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  public setUniforms(uniforms: Record<UNIFORM, unknown>) {
    const { gl } = this;

    for (const uniform in uniforms) {
      const val: unknown = uniforms[uniform];
      const location = this.uniformLocations[uniform] || gl.getUniformLocation(this.program, `u_${uniform}`);
      this.uniformLocations[uniform] = location;

      if (typeof val === "number") {
        gl.uniform1f(location, val);
      } else if (Array.isArray(val) && val.every((v) => typeof v === "number")) {
        if (val.length === 2) gl.uniform2f(location, ...val);
        else if (val.length === 3) gl.uniform3f(location, ...val);
        else if (val.length === 4) gl.uniform4f(location, ...val);
      }
    }
  }

  public setTextureData(textureName: DATA_TEXTURE, data: Float32Array, items: number, attributesPerItem: number) {
    const { gl } = this;
    const index = this.dataTextureIndexes[textureName];
    const textureSize = getTextureSize(items);

    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTextures[textureName]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      DATA_TEXTURES_LEVELS[attributesPerItem],
      textureSize,
      textureSize,
      0,
      DATA_TEXTURES_FORMATS[attributesPerItem],
      gl.FLOAT,
      data,
    );
  }

  public compute() {
    const { gl } = this;

    gl.activeTexture(gl.TEXTURE0 + this.dataTexturesNames.length);
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFrameBuffer);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public getOutput() {
    const { gl } = this;
    const outputArr = new Float32Array(this.size * this.size * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFrameBuffer);
    gl.readPixels(0, 0, this.size, this.size, gl.RGBA, gl.FLOAT, outputArr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return outputArr;
  }

  public kill() {
    const { gl } = this;

    if (this.program) gl.deleteProgram(this.program);
    for (const textureName in this.dataTextures) {
      if (this.dataTextures[textureName]) gl.deleteTexture(this.dataTextures[textureName]);
    }

    if (this.outputTexture) gl.deleteTexture(this.outputTexture);
  }
}
