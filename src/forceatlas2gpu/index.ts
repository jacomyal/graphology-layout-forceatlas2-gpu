import Graph from "graphology";
import { Attributes } from "graphology-types";

import {
  DEFAULT_FORCE_ATLAS_2_RUN_OPTIONS,
  DEFAULT_FORCE_ATLAS_2_SETTINGS,
  EDGES_ATTRIBUTES_IN_TEXTURE,
  ForceAtlas2RunOptions,
  ForceAtlas2Settings,
  NODES_ATTRIBUTES_IN_METADATA_TEXTURE,
  NODES_ATTRIBUTES_IN_POSITION_TEXTURE,
  TEXTURES_NAMES,
  UNIFORM_SETTINGS,
} from "./consts";
import { getFragmentShader } from "./shader-fragment";
import { getVertexShader } from "./shader-vertex";

export class ForceAtlas2GPU<
  NodeAttributes extends Attributes = Attributes,
  EdgeAttributes extends Attributes = Attributes,
> {
  private graph: Graph<NodeAttributes, EdgeAttributes>;
  private params: ForceAtlas2Settings;

  // WebGL:
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  // This texture contains 4 (NODES_ATTRIBUTES_IN_POSITION_TEXTURE) floats per node:
  // - x and y: The position of the node
  // - dx and dy: The speed of the node
  private nodesPositionTexture: WebGLTexture;
  // The nodes texture contains 3 (NODES_ATTRIBUTES_IN_METADATA_TEXTURE) floats per node:
  // - edgesOffset: An "integer" pointing at the position of the first of the node neighbors, in the edgesTexture
  // - edgesCount: An "integer" counting the number of this node neighbors
  // - convergence: An internal score that allows slowing nodes on some circumstances
  // - mass: An internal score that increases for more connected nodes
  private nodesMetadataTexture: WebGLTexture;
  // The edges texture indexes each edge in both directions, since each edge impacts both extremities.
  // The edges are grouped by source node.
  // The edges texture contains 2 (EDGES_ATTRIBUTES_IN_TEXTURE) floats per connection:
  // - target: The edge target index (as an "integer") in nodesTexture
  // - weight: The edge weight
  private edgesTexture: WebGLTexture;

  private maxNeighborsCount: number;
  private nodeIndices: Record<string, number>;
  private nodeConvergences: Record<string, number>;
  private nodeMasses: Record<string, number>;
  private nodesPositionDataArray: Float32Array;
  private nodesMetadataDataArray: Float32Array;
  private edgesDataArray: Float32Array;

  private outputTexture: WebGLTexture;
  private framebuffer: WebGLFramebuffer;
  private uniformLocations: Record<string, WebGLUniformLocation>;

  private positionLocation: number;
  private positionBuffer: WebGLBuffer;
  private textureCoordLocation: number;
  private textureCoordBuffer: WebGLBuffer;

  constructor(graph: Graph<NodeAttributes, EdgeAttributes>, params: Partial<ForceAtlas2Settings> = {}) {
    // Initialize data:
    this.graph = graph;
    this.params = {
      ...DEFAULT_FORCE_ATLAS_2_SETTINGS,
      ...params,
    };

    this.nodeConvergences = {};
    this.nodeMasses = {};

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
      nodesCount: this.graph.order,
      edgesCount: this.graph.size,
      maxNeighborsCount: this.maxNeighborsCount,
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
    UNIFORM_SETTINGS.forEach((setting) => {
      this.uniformLocations[setting] = gl.getUniformLocation(this.program, `u_${setting}`);
    });
    TEXTURES_NAMES.forEach((textureName, index) => {
      this.uniformLocations[textureName] = gl.getUniformLocation(this.program, `u_${textureName}`);
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this.uniformLocations[textureName], index);

      (this[textureName] as WebGLTexture) = texture;
    });

    // Activate the output texture
    gl.activeTexture(gl.TEXTURE0 + TEXTURES_NAMES.length);
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_outputTexture"), TEXTURES_NAMES.length);

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

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.nodesPositionTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, graph.order, 1, 0, gl.RGBA, gl.FLOAT, this.nodesPositionDataArray);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, this.nodesMetadataTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, graph.order, 1, 0, gl.RGBA, gl.FLOAT, this.nodesMetadataDataArray);
    gl.activeTexture(gl.TEXTURE0 + 2);
    gl.bindTexture(gl.TEXTURE_2D, this.edgesTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, graph.size * 2, 1, 0, gl.RG, gl.FLOAT, this.edgesDataArray);
  }

  private refreshTexturesData() {
    const { graph } = this;

    this.nodesPositionDataArray = new Float32Array(graph.order * NODES_ATTRIBUTES_IN_POSITION_TEXTURE);
    this.nodesMetadataDataArray = new Float32Array(graph.order * NODES_ATTRIBUTES_IN_METADATA_TEXTURE);
    this.edgesDataArray = new Float32Array(graph.size * 2 * EDGES_ATTRIBUTES_IN_TEXTURE);
    const neighborsPerSource: { weight: number; index: number }[][] = [];

    // Index nodes per order:
    this.nodeIndices = {};
    this.nodeMasses = {};
    let i = 0;
    graph.forEachNode((node) => {
      this.nodeIndices[node] = i;
      this.nodeMasses[node] = 1;
      neighborsPerSource[i] = [];
      i++;
    });

    // Index edges per sources and targets:
    graph.forEachEdge((_edge, { weight }: { weight: number }, source, target) => {
      const sourceIndex = this.nodeIndices[source];
      const targetIndex = this.nodeIndices[target];

      neighborsPerSource[sourceIndex].push({ weight, index: targetIndex });
      neighborsPerSource[targetIndex].push({ weight, index: sourceIndex });
      this.nodeMasses[source] += weight;
      this.nodeMasses[target] += weight;
    });

    // Feed the textures:
    let k = 0;
    let edgeIndex = 0;
    this.maxNeighborsCount = 0;
    graph.forEachNode((node, { x, y }: { x: number; y: number }) => {
      const nodeIndex = this.nodeIndices[node];
      const neighbors = neighborsPerSource[nodeIndex];
      const neighborsCount = neighbors.length;
      this.maxNeighborsCount = Math.max(this.maxNeighborsCount, neighborsCount);

      k = nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE;
      this.nodesPositionDataArray[k++] = x;
      this.nodesPositionDataArray[k++] = y;
      this.nodesPositionDataArray[k++] = 0;
      this.nodesPositionDataArray[k++] = 0;

      k = nodeIndex * NODES_ATTRIBUTES_IN_METADATA_TEXTURE;
      this.nodesMetadataDataArray[k++] = edgeIndex;
      this.nodesMetadataDataArray[k++] = neighborsCount;
      this.nodesMetadataDataArray[k++] = this.nodeConvergences[node] || 1;
      this.nodesMetadataDataArray[k++] = this.nodeMasses[node] || 1;

      for (let j = 0; j < neighborsCount; j++) {
        const { weight, index } = neighbors[j];
        k = edgeIndex * EDGES_ATTRIBUTES_IN_TEXTURE;
        this.edgesDataArray[k++] = index;
        this.edgesDataArray[k++] = weight;
        edgeIndex++;
      }
    });
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
      const nodeIndex = this.nodeIndices[n];
      const x = outputArr[4 * nodeIndex];
      const y = outputArr[4 * nodeIndex + 1];
      const convergence = outputArr[4 * nodeIndex + 2];
      const dx = x - oldX;
      const dy = y - oldY;

      this.nodeConvergences[n] = convergence;

      // Update graph:
      if (updateGraph)
        graph.mergeNodeAttributes(n, {
          x,
          y,
        });

      // Update textures data:
      let k = nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE;
      this.nodesPositionDataArray[k++] = x;
      this.nodesPositionDataArray[k++] = y;
      this.nodesPositionDataArray[k++] = dx;
      this.nodesPositionDataArray[k++] = dy;

      k = nodeIndex * NODES_ATTRIBUTES_IN_METADATA_TEXTURE;
      this.nodesMetadataDataArray[k + 2] = convergence;
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
    if (this.nodesPositionTexture) gl.deleteTexture(this.nodesPositionTexture);
    if (this.nodesMetadataTexture) gl.deleteTexture(this.nodesMetadataTexture);
    if (this.edgesTexture) gl.deleteTexture(this.edgesTexture);
    if (this.outputTexture) gl.deleteTexture(this.outputTexture);

    const extension = gl.getExtension("WEBGL_lose_context");
    if (extension) {
      extension.loseContext();
    }

    (this as { gl?: unknown }).gl = null;
  }

  private setUniforms() {
    const { gl } = this;
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
    gl.activeTexture(gl.TEXTURE0 + TEXTURES_NAMES.length);
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_outputTexture"), TEXTURES_NAMES.length);

    // Enable vertex attributes
    this.enableVertexAttributes();

    // Run the WebGL program
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Unbind the framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Public API:
   * ***********
   */
  public run(opts: Partial<ForceAtlas2RunOptions> = {}) {
    const options: ForceAtlas2RunOptions = {
      ...DEFAULT_FORCE_ATLAS_2_RUN_OPTIONS,
      ...opts,
    };
    let iterationsLeft = options.iterations;

    this.checkGraph();
    this.setUniforms();
    this.refreshTexturesData();
    this.refreshTextures();
    while (iterationsLeft-- > 0) {
      this.runProgram();
      if (iterationsLeft) this.readOutput(false);
    }
    this.readOutput(true);
  }
}
