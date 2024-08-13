import { DATA_TEXTURES_FORMATS, DATA_TEXTURES_LEVELS } from "./consts";
import { compileShader, getTextureSize } from "./utils";

export class WebCLProgram<
  DATA_TEXTURE extends string = string,
  OUTPUT_TEXTURE extends string = string,
  UNIFORM extends string = string,
> {
  public program: WebGLProgram;
  public gl: WebGL2RenderingContext;
  public size: number;

  public uniformLocations: Record<UNIFORM, WebGLUniformLocation> = {};

  public dataTexturesNames: DATA_TEXTURE[];
  public dataTextures: Record<DATA_TEXTURE, WebGLTexture> = {};
  public dataTextureIndexes: Record<DATA_TEXTURE, number> = {};

  public outputTexturesNames: OUTPUT_TEXTURE[];
  public outputTextures: Record<OUTPUT_TEXTURE, WebGLTexture>;
  public outputTextureIndexes: Record<OUTPUT_TEXTURE, number> = {};
  public outputBuffer: WebGLFramebuffer;

  constructor({
    gl,
    fragments,
    dataTextures,
    outputTextures,
    fragmentShaderSource,
    vertexShaderSource,
  }: {
    gl: WebGL2RenderingContext;
    fragments: number;
    dataTextures: DATA_TEXTURE[];
    outputTextures: OUTPUT_TEXTURE[];
    fragmentShaderSource: string;
    vertexShaderSource: string;
  }) {
    this.gl = gl;
    this.size = getTextureSize(fragments);
    this.dataTexturesNames = dataTextures;
    this.outputTexturesNames = outputTextures;

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
    this.outputTextures = [];
    this.outputBuffer = gl.createFramebuffer();

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
    const {
      gl,
      program,
      size,
      dataTexturesNames,
      dataTextureIndexes,
      dataTextures,
      outputTexturesNames,
      outputTextureIndexes,
      outputTextures,
    } = this;

    // Handle data textures:
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputBuffer);
    outputTexturesNames.forEach((textureName, index) => {
      if (typeof outputTextureIndexes[textureName] !== "number") outputTextureIndexes[textureName] = index;
      if (!outputTextures[textureName]) outputTextures[textureName] = gl.createTexture();
      const texture = outputTextures[textureName];

      gl.activeTexture(gl.TEXTURE0 + dataTexturesNames.length + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl[`COLOR_ATTACHMENT${index}`], gl.TEXTURE_2D, texture, 0);
    });
    gl.drawBuffers(this.outputTexturesNames.map((_, i) => gl[`COLOR_ATTACHMENT${i}`]));
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
    const { gl, outputTexturesNames, dataTexturesNames, outputTextures } = this;

    outputTexturesNames.forEach((textureName, i) => {
      gl.activeTexture(gl.TEXTURE0 + dataTexturesNames.length + i);
      gl.bindTexture(gl.TEXTURE_2D, outputTextures[textureName]);
    });

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  public getOutputs() {
    const res: Record<OUTPUT_TEXTURE, Float32Array> = {};
    this.outputTexturesNames.forEach((textureName) => {
      res[textureName] = this.getOutput(textureName);
    });

    return res;
  }

  public getOutput(textureName: OUTPUT_TEXTURE) {
    const { gl, outputTextureIndexes, size } = this;

    const outputArr = new Float32Array(size * size * 4);
    gl.readBuffer(gl[`COLOR_ATTACHMENT${outputTextureIndexes[textureName]}`]);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, outputArr);

    return outputArr;
  }

  public kill() {
    const { gl } = this;

    if (this.program) gl.deleteProgram(this.program);
    for (const textureName in this.dataTextures) {
      gl.deleteTexture(this.dataTextures[textureName]);
    }
    this.dataTextures = {};

    gl.deleteBuffer(this.outputBuffer);
    this.outputTexturesNames.forEach((textureName) => {
      gl.deleteTexture(this.outputTextures[textureName]);
    });
    this.outputTextures = {};
    this.outputTexturesNames = [];
  }
}
