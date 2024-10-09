import { DATA_TEXTURES_FORMATS, DATA_TEXTURES_LEVELS } from "../forceatlas2gpu/consts";
import { compileShader, getTextureSize } from "./webgl";

export class WebCLProgram<
  DATA_TEXTURE extends string = string,
  OUTPUT_TEXTURE extends string = string,
  UNIFORM extends string = string,
> {
  public program: WebGLProgram;
  public gl: WebGL2RenderingContext;
  public size: number;

  public uniformLocations: Partial<Record<UNIFORM, WebGLUniformLocation>> = {};

  public dataTextures: { name: DATA_TEXTURE; attributesPerItem: number; index: number; texture: WebGLTexture }[];
  public dataTexturesIndex: Record<DATA_TEXTURE, (typeof this.dataTextures)[number]>;

  public outputBuffer: WebGLFramebuffer;
  public outputTextures: {
    name: OUTPUT_TEXTURE;
    attributesPerItem: number;
    index: number;
    texture: WebGLTexture;
  }[];
  public outputTexturesIndex: Record<OUTPUT_TEXTURE, (typeof this.outputTextures)[number]>;

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
    dataTextures: { name: DATA_TEXTURE; attributesPerItem: number }[];
    outputTextures: { name: OUTPUT_TEXTURE; attributesPerItem: number }[];
    fragmentShaderSource: string;
    vertexShaderSource: string;
  }) {
    this.gl = gl;
    this.size = getTextureSize(fragments);
    this.dataTextures = dataTextures.map((spec, index) => ({
      ...spec,
      index,
      texture: gl.createTexture() as WebGLTexture,
    }));
    this.dataTexturesIndex = this.dataTextures.reduce(
      (iter, spec) => ({ ...iter, [spec.name]: spec }),
      {} as typeof this.dataTexturesIndex,
    );
    this.outputTextures = outputTextures.map((spec, index) => ({
      ...spec,
      index,
      texture: gl.createTexture() as WebGLTexture,
    }));
    this.outputTexturesIndex = this.outputTextures.reduce(
      (iter, spec) => ({ ...iter, [spec.name]: spec }),
      {} as typeof this.outputTexturesIndex,
    );

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
    this.outputBuffer = gl.createFramebuffer() as WebGLBuffer;

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
    const { gl, program, size, dataTextures, outputTextures } = this;

    // Handle data textures:
    dataTextures.forEach(({ name, texture, index }) => {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program, `u_${name}Texture`), index);
    });

    // Handle output:
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputBuffer);
    outputTextures.forEach(({ texture, index, attributesPerItem }) => {
      gl.activeTexture(gl.TEXTURE0 + dataTextures.length + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        DATA_TEXTURES_LEVELS[attributesPerItem],
        size,
        size,
        0,
        DATA_TEXTURES_FORMATS[attributesPerItem],
        gl.FLOAT,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl[`COLOR_ATTACHMENT${index}` as "COLOR_ATTACHMENT0"],
        gl.TEXTURE_2D,
        texture,
        0,
      );
    });
    gl.drawBuffers(this.outputTextures.map((_, i) => gl[`COLOR_ATTACHMENT${i}` as "COLOR_ATTACHMENT0"]));
  }

  public setUniforms(uniforms: Record<UNIFORM, unknown>) {
    const { gl } = this;

    for (const uniform in uniforms) {
      const val: unknown = uniforms[uniform];
      const location =
        this.uniformLocations[uniform] || (gl.getUniformLocation(this.program, `u_${uniform}`) as WebGLUniformLocation);
      this.uniformLocations[uniform] = location;

      if (typeof val === "number") {
        gl.uniform1f(location, val);
      } else if (Array.isArray(val) && val.every((v) => typeof v === "number")) {
        if (val.length === 2) gl.uniform2f(location, val[0], val[1]);
        else if (val.length === 3) gl.uniform3f(location, val[0], val[1], val[2]);
        else if (val.length === 4) gl.uniform4f(location, val[0], val[1], val[2], val[3]);
      }
    }
  }

  public setTextureData(textureName: DATA_TEXTURE, data: Float32Array, items: number) {
    const { gl } = this;
    const { index, attributesPerItem, texture } = this.dataTexturesIndex[textureName];
    const textureSize = getTextureSize(items);

    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, texture);
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
    const { gl, outputTextures, dataTextures } = this;

    outputTextures.forEach((outputTexture, i) => {
      gl.activeTexture(gl.TEXTURE0 + dataTextures.length + i);
      gl.bindTexture(gl.TEXTURE_2D, outputTexture.texture);
    });

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  public swapTextures(input: DATA_TEXTURE, output: OUTPUT_TEXTURE) {
    [this.dataTexturesIndex[input].texture, this.outputTexturesIndex[output].texture] = [
      this.outputTexturesIndex[output].texture,
      this.dataTexturesIndex[input].texture,
    ];
  }

  public getOutputs() {
    const res: Partial<Record<OUTPUT_TEXTURE, Float32Array>> = {};
    this.outputTextures.forEach(({ name }) => {
      res[name] = this.getOutput(name);
    });

    return res;
  }

  public getOutput(textureName: OUTPUT_TEXTURE) {
    const { gl, size } = this;
    const { attributesPerItem, index } = this.outputTexturesIndex[textureName];

    const outputArr = new Float32Array(size * size * attributesPerItem);
    gl.readBuffer(gl[`COLOR_ATTACHMENT${index}` as "COLOR_ATTACHMENT0"]);
    gl.readPixels(0, 0, size, size, DATA_TEXTURES_FORMATS[attributesPerItem], gl.FLOAT, outputArr);

    return outputArr;
  }

  public kill() {
    const { gl } = this;
    if (this.program) gl.deleteProgram(this.program);

    this.dataTextures.forEach(({ texture }) => {
      gl.deleteTexture(texture);
    });
    this.dataTextures = [];
    this.dataTexturesIndex = {} as typeof this.dataTexturesIndex;

    gl.deleteBuffer(this.outputBuffer);
    this.outputTextures.forEach(({ texture }) => {
      gl.deleteTexture(texture);
    });
    this.outputTextures = [];
    this.outputTexturesIndex = {} as typeof this.outputTexturesIndex;
  }
}
