import Graph from "graphology";
import { Attributes } from "graphology-types";

import {
  DATA_TEXTURES,
  DATA_TEXTURES_FORMATS,
  DATA_TEXTURES_LEVELS,
  DATA_TEXTURES_SPECS,
  DEFAULT_FORCE_ATLAS_2_RUN_OPTIONS,
  DEFAULT_FORCE_ATLAS_2_SETTINGS,
  ForceAtlas2RunOptions,
  ForceAtlas2Settings,
  TextureName,
  UNIFORM_SETTINGS,
} from "./consts";
import { getFragmentShader } from "./shader-fragment";
import { getVertexShader } from "./shader-vertex";
import { getTextureSize } from "./utils";

export class ForceAtlas2GPU<
  NodeAttributes extends Attributes = Attributes,
  EdgeAttributes extends Attributes = Attributes,
> {
  private isRunning = false;
  private graph: Graph<NodeAttributes, EdgeAttributes>;
  private params: ForceAtlas2Settings;
  private nodeDataCache: Record<
    string,
    {
      index: number;
      convergence: number;
      mass: number;
    }
  >;

  // WebGL:
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;

  // Program input data
  private dataTextures: Record<TextureName, WebGLTexture>;
  private dataArrays: Record<TextureName, Float32Array>;
  private maxNeighborsCount: number;
  private outboundAttCompensation: number;

  // Program input attributes and uniforms
  private positionLocation: number;
  private positionBuffer: WebGLBuffer;
  private textureCoordLocation: number;
  private textureCoordBuffer: WebGLBuffer;
  private uniformLocations: Record<string, WebGLUniformLocation>;

  // Program output
  private outputTexture: WebGLTexture;
  private framebuffer: WebGLFramebuffer;

  constructor(graph: Graph<NodeAttributes, EdgeAttributes>, params: Partial<ForceAtlas2Settings> = {}) {
    // Initialize data:
    this.graph = graph;
    this.params = {
      ...DEFAULT_FORCE_ATLAS_2_SETTINGS,
      ...params,
    };

    this.nodeDataCache = {};

    // Initialize WebGL2 context and textures:
    this.canvas = document.createElement("canvas");
    this.canvas.width = graph.order;
    this.canvas.height = 1;
    const gl = this.canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 is not supported in this browser.");
    this.gl = gl;

    // Check for required extension
    const ext = gl.getExtension("EXT_color_buffer_float");
    if (!ext) {
      throw new Error("EXT_color_buffer_float extension not supported");
    }

    // Create framebuffer:
    this.framebuffer = gl.createFramebuffer();

    // Create renderable texture
    this.outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, graph.order, 1, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach the renderable texture to the framebuffer's color attachment
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

    // Check the framebuffer status
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer not complete: ${status.toString(16)}`);
    }

    // Unbind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Read graph:
    this.refreshTexturesData();

    // Initialize WebGL program:
    this.setProgram();
  }

  /**
   * Private lifecycle functions:
   * ****************************
   */
  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type) as WebGLShader;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error("Failed to compile shader: " + gl.getShaderInfoLog(shader));
    }

    return shader;
  }

  private setProgram() {
    const gl = this.gl;

    const fragmentShaderSource = getFragmentShader({
      graph: this.graph,
      maxNeighborsCount: this.maxNeighborsCount,
      strongGravityMode: this.params.strongGravityMode,
      linLogMode: this.params.linLogMode,
      adjustSizes: this.params.adjustSizes,
      outboundAttractionDistribution: this.params.outboundAttractionDistribution,
    });
    const vertexShaderSource = getVertexShader();

    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);

    this.program = gl.createProgram() as WebGLProgram;

    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error("Failed to link program: " + gl.getProgramInfoLog(this.program));
    }

    gl.useProgram(this.program);

    // Bind all required uniforms (example, adapt based on actual shader code):
    this.uniformLocations = {};
    this.uniformLocations.outboundAttCompensation = gl.getUniformLocation(this.program, `u_outboundAttCompensation`);
    UNIFORM_SETTINGS.forEach((setting) => {
      this.uniformLocations[setting] = gl.getUniformLocation(this.program, `u_${setting}`);
    });

    this.dataTextures = {} as typeof this.dataTextures;
    DATA_TEXTURES.forEach((textureName, index) => {
      this.uniformLocations[textureName] = gl.getUniformLocation(this.program, `u_${textureName}Texture`);
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this.uniformLocations[textureName], index);

      this.dataTextures[textureName] = texture;
    });

    // Activate the output texture
    gl.activeTexture(gl.TEXTURE0 + DATA_TEXTURES.length);
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_outputTexture"), DATA_TEXTURES.length);

    this.positionLocation = gl.getAttribLocation(this.program, "a_position");
    this.textureCoordLocation = gl.getAttribLocation(this.program, "a_textureCoord");

    // Initialize buffers for attributes
    this.initBuffers();
  }

  private initBuffers() {
    const gl = this.gl;

    // Create a buffer for the positions.
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);

    const positions = new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // Create a buffer for the texture coordinates.
    this.textureCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureCoordBuffer);

    const textureCoordinates = new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
    gl.bufferData(gl.ARRAY_BUFFER, textureCoordinates, gl.STATIC_DRAW);
  }

  private enableVertexAttributes() {
    const gl = this.gl;

    // Bind the position buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.positionLocation);

    // Bind the texture coordinate buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureCoordBuffer);
    gl.vertexAttribPointer(this.textureCoordLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.textureCoordLocation);
  }

  private refreshTextures() {
    const { gl, graph } = this;

    DATA_TEXTURES.forEach((textureName, i) => {
      const { attributesPerItem, getItemsCount } = DATA_TEXTURES_SPECS[textureName];
      const itemsCount = getItemsCount(graph);
      const textureSize = getTextureSize(itemsCount);

      gl.activeTexture(gl.TEXTURE0 + i);
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
        this.dataArrays[textureName],
      );
    });
  }

  private refreshTexturesData() {
    const { graph } = this;

    this.dataArrays = {} as typeof this.dataArrays;
    DATA_TEXTURES.forEach((textureName) => {
      const { attributesPerItem, getItemsCount } = DATA_TEXTURES_SPECS[textureName];

      const textureSize = getTextureSize(getItemsCount(graph));
      this.dataArrays[textureName] = new Float32Array(textureSize ** 2 * attributesPerItem);
    });
    const neighborsPerSource: { weight: number; index: number }[][] = [];

    // Index nodes per order:
    this.nodeDataCache = {};
    graph.nodes().forEach((node, i) => {
      this.nodeDataCache[node] = {
        index: i,
        mass: 1,
        convergence: 1,
      };

      neighborsPerSource[i] = [];
      i++;
    });

    // Index edges per sources and targets:
    graph.forEachEdge((_edge, { weight }: { weight: number }, source, target) => {
      const sourceIndex = this.nodeDataCache[source].index;
      const targetIndex = this.nodeDataCache[target].index;

      neighborsPerSource[sourceIndex].push({ weight, index: targetIndex });
      neighborsPerSource[targetIndex].push({ weight, index: sourceIndex });
      this.nodeDataCache[source].mass += weight;
      this.nodeDataCache[target].mass += weight;
    });

    // Feed the textures:
    let k = 0;
    let edgeIndex = 0;
    this.maxNeighborsCount = 0;
    this.outboundAttCompensation = 0;
    graph.forEachNode((node, { x, y, size }: { x: number; y: number; size: number }) => {
      const { index, mass, convergence } = this.nodeDataCache[node];
      const neighbors = neighborsPerSource[index];
      const neighborsCount = neighbors.length;
      this.maxNeighborsCount = Math.max(this.maxNeighborsCount, neighborsCount);

      k = index * DATA_TEXTURES_SPECS.nodesPosition.attributesPerItem;
      this.dataArrays.nodesPosition[k++] = x;
      this.dataArrays.nodesPosition[k++] = y;
      this.dataArrays.nodesPosition[k++] = 0;
      this.dataArrays.nodesPosition[k++] = 0;

      k = index * DATA_TEXTURES_SPECS.nodesDimensions.attributesPerItem;
      this.dataArrays.nodesDimensions[k++] = mass;
      this.dataArrays.nodesDimensions[k++] = size;
      this.dataArrays.nodesDimensions[k++] = convergence;
      this.outboundAttCompensation += mass;

      k = index * DATA_TEXTURES_SPECS.nodesEdgesPointers.attributesPerItem;
      this.dataArrays.nodesEdgesPointers[k++] = edgeIndex;
      this.dataArrays.nodesEdgesPointers[k++] = neighborsCount;

      for (let j = 0; j < neighborsCount; j++) {
        const { weight, index } = neighbors[j];
        k = edgeIndex * DATA_TEXTURES_SPECS.edges.attributesPerItem;
        this.dataArrays.edges[k++] = index;
        this.dataArrays.edges[k++] = weight;
        edgeIndex++;
      }
    });

    this.outboundAttCompensation /= graph.order / 10;
  }

  private readOutput(updateGraph?: boolean) {
    const { gl, graph } = this;
    const nodesCount = graph.order;
    const outputArr = new Float32Array(nodesCount * 4);

    // Bind the framebuffer before reading pixels
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

    // Read from the renderable texture attached to the framebuffer
    gl.readPixels(0, 0, nodesCount, 1, gl.RGBA, gl.FLOAT, outputArr);

    // Unbind the framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    graph.forEachNode((n, { x: oldX, y: oldY }) => {
      const { index } = this.nodeDataCache[n];
      const x = outputArr[4 * index];
      const y = outputArr[4 * index + 1];
      const convergence = outputArr[4 * index + 2];

      const dx = x - oldX;
      const dy = y - oldY;

      this.nodeDataCache[n].convergence = convergence;

      // Update graph:
      if (updateGraph)
        graph.mergeNodeAttributes(n, {
          x,
          y,
        });

      // Update textures data:
      let k = index * DATA_TEXTURES_SPECS.nodesPosition.attributesPerItem;
      this.dataArrays.nodesPosition[k++] = x;
      this.dataArrays.nodesPosition[k++] = y;
      this.dataArrays.nodesPosition[k++] = dx;
      this.dataArrays.nodesPosition[k++] = dy;

      k = index * DATA_TEXTURES_SPECS.nodesDimensions.attributesPerItem;
      this.dataArrays.nodesDimensions[k + 2] = convergence;
    });

    this.refreshTextures();
  }

  private checkGraph() {
    const { graph } = this;
    graph.forEachNode((n, { x, y }: { x?: number; y?: number }) => {
      graph.mergeNodeAttributes(n, {
        x: typeof x === "number" ? x : 0,
        y: typeof y === "number" ? y : 0,
      });
    });
    graph.forEachEdge((e, { weight }: { weight?: number }) => {
      graph.mergeEdgeAttributes(e, {
        weight: typeof weight === "number" ? weight : 1,
      });
    });
  }

  private kill() {
    const { gl } = this;

    if (this.program) gl.deleteProgram(this.program);
    DATA_TEXTURES.forEach((textureName) => {
      if (this.dataTextures[textureName]) gl.deleteTexture(this.dataTextures[textureName]);
    });

    if (this.outputTexture) gl.deleteTexture(this.outputTexture);

    const extension = gl.getExtension("WEBGL_lose_context");
    if (extension) {
      extension.loseContext();
    }

    (this as { gl?: unknown }).gl = null;
  }

  private setUniforms() {
    const { gl } = this;
    gl.uniform1f(this.uniformLocations.outboundAttCompensation, this.outboundAttCompensation);
    UNIFORM_SETTINGS.forEach((setting: keyof ForceAtlas2Settings) => {
      gl.uniform1f(this.uniformLocations[setting], this.params[setting] as number);
    });
  }

  private runProgram() {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

    // Attach the texture to the framebuffer's color attachment
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

    // Check the framebuffer status
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Framebuffer is not complete");
    }

    // Set active texture for the output texture
    gl.activeTexture(gl.TEXTURE0 + DATA_TEXTURES.length);
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_outputTexture"), DATA_TEXTURES.length);

    // Enable vertex attributes
    this.enableVertexAttributes();

    // Run the WebGL program
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Unbind the framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private step(iterations = 1) {
    let iterationsLeft = iterations;
    if (!this.isRunning) return;

    while (iterationsLeft-- > 0) {
      this.runProgram();
      if (iterationsLeft > 0) this.readOutput(false);
    }
    this.readOutput(true);

    requestAnimationFrame(() => this.step(iterations));
  }

  /**
   * Public API:
   * ***********
   */
  public start(opts: Partial<ForceAtlas2RunOptions> = {}) {
    const { iterationsPerStep }: ForceAtlas2RunOptions = {
      ...DEFAULT_FORCE_ATLAS_2_RUN_OPTIONS,
      ...opts,
    };

    this.checkGraph();
    this.setUniforms();
    this.refreshTexturesData();
    this.refreshTextures();

    this.isRunning = true;
    this.step(iterationsPerStep);
  }

  public stop() {
    this.isRunning = false;
  }
}
