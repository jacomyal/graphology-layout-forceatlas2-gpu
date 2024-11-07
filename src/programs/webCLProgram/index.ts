import { compileShader, getTextureSize } from "../../utils/webgl";

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

export class WebCLProgram<
  DATA_TEXTURE extends string = string,
  OUTPUT_TEXTURE extends string = string,
  UNIFORM extends string = string,
> {
  public name: string;

  public program: WebGLProgram;
  public gl: WebGL2RenderingContext;
  public size: number;
  public fragments: number;

  public uniformLocations: Partial<Record<UNIFORM, WebGLUniformLocation>> = {};

  public dataTextures: {
    name: DATA_TEXTURE;
    attributesPerItem: number;
    items: number;
    index: number;
    texture: WebGLTexture;
  }[];
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
    name,
  }: {
    gl: WebGL2RenderingContext;
    fragments: number;
    dataTextures: { name: DATA_TEXTURE; attributesPerItem: number; items: number }[];
    outputTextures: { name: OUTPUT_TEXTURE; attributesPerItem: number }[];
    fragmentShaderSource: string;
    vertexShaderSource: string;
    name: string;
  }) {
    console.log({ name, fragmentShaderSource });

    this.gl = gl;
    this.name = name;
    this.size = getTextureSize(fragments);
    this.fragments = fragments;
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
    const { gl, outputBuffer, outputTexturesIndex, size } = this;
    const { attributesPerItem, index } = this.outputTexturesIndex[textureName];

    // Bind the framebuffer that contains the output textures
    gl.bindFramebuffer(gl.FRAMEBUFFER, outputBuffer);

    // Ensure the output texture exists
    const outputTexture = outputTexturesIndex[textureName];
    if (!outputTexture) {
      throw new Error(`Output texture at index ${textureName} does not exist.`);
    }

    // Check the framebuffer status
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error("Framebuffer is not complete");
    }

    // Bind the output texture as the current read buffer
    gl.readBuffer(gl[`COLOR_ATTACHMENT${index}` as "COLOR_ATTACHMENT0"]);

    // Create a Float32Array to hold the data
    const outputArr = new Float32Array(size * size * attributesPerItem); // Assuming RGBA float data

    // Read the pixels from the framebuffer
    gl.readPixels(0, 0, size, size, DATA_TEXTURES_FORMATS[attributesPerItem], gl.FLOAT, outputArr);

    // Unbind the framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return outputArr;
  }

  // For testing purpose only
  public getInput(textureName: DATA_TEXTURE) {
    const { gl } = this;
    const { attributesPerItem, items, index, texture } = this.dataTexturesIndex[textureName];
    const textureSize = getTextureSize(items);

    gl.activeTexture(gl.TEXTURE0 + index);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error("Failed to create framebuffer for reading texture data.");
    }

    const outputArr = new Float32Array(textureSize * textureSize * attributesPerItem);
    gl.readPixels(0, 0, textureSize, textureSize, DATA_TEXTURES_FORMATS[attributesPerItem], gl.FLOAT, outputArr);

    // Cleanup:
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);

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

  public static wirePrograms(programs: Record<string, WebCLProgram>): void {
    const outputTextures: Record<string, { texture: WebGLTexture; items: number; name: string }> = {};
    const inputTextures: Record<string, { texture: WebGLTexture; items: number; name: string }> = {};

    // For each input texture:
    // - Use existing output texture if any
    // - Else, use existing input texture if any
    // - Else, save input texture for later
    // Then, index all output textures
    for (const name in programs) {
      const program = programs[name];

      for (const textureName in program.dataTexturesIndex) {
        if (outputTextures[textureName]) {
          if (outputTextures[textureName].items !== program.dataTexturesIndex[textureName].items)
            throw new Error(
              `Cannot bind output texture "${textureName}" from "${outputTextures[textureName].name}" to "${name}": Size mismatch (${outputTextures[textureName].name}: ${outputTextures[textureName].items}, ${name}: ${program.dataTexturesIndex[textureName].items})`,
            );
          program.dataTexturesIndex[textureName].texture = outputTextures[textureName].texture;
        } else if (inputTextures[textureName]) {
          if (inputTextures[textureName].items !== program.dataTexturesIndex[textureName].items)
            throw new Error(
              `Cannot bind data texture "${textureName}" from "${inputTextures[textureName].name}" to "${name}": Size mismatch (${inputTextures[textureName].name}: ${inputTextures[textureName].items}, ${name}: ${program.dataTexturesIndex[textureName].items})`,
            );
          program.dataTexturesIndex[textureName].texture = inputTextures[textureName].texture;
        } else {
          inputTextures[textureName] = {
            texture: program.dataTexturesIndex[textureName].texture,
            items: program.dataTexturesIndex[textureName].items,
            name,
          };
        }
      }

      for (const textureName in program.outputTexturesIndex) {
        outputTextures[textureName] = {
          texture: program.outputTexturesIndex[textureName].texture,
          items: program.fragments,
          name,
        };
      }
    }
  }
}
