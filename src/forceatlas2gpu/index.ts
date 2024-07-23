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
  // The nodes texture contains 2 (NODES_ATTRIBUTES_IN_METADATA_TEXTURE) floats per node:
  // - edgesOffset: An "integer" pointing at the position of the first of the node neighbors, in the edgesTexture
  // - edgesCount: An "integer" counting the number of this node neighbors
  private nodesMetadataTexture: WebGLTexture;
  // The edges texture indexes each edge in both directions, since each edge impacts both extremities.
  // The edges are grouped by source node.
  // The edges texture contains 2 (EDGES_ATTRIBUTES_IN_TEXTURE) floats per connection:
  // - target: The edge target index (as an "integer") in nodesTexture
  // - weight: The edge weight
  private edgesTexture: WebGLTexture;

  private maxNeighborsCount: number;
  private nodeIndices: Record<string, number>;
  private nodesPositionDataArray: Float32Array;
  private nodesMetadataDataArray: Float32Array;
  private edgesDataArray: Float32Array;

  private outputTexture: WebGLTexture;
  private framebuffer: WebGLFramebuffer;
  private uniformLocations: Record<string, WebGLUniformLocation>;

  constructor(graph: Graph<NodeAttributes, EdgeAttributes>, params: Partial<ForceAtlas2Settings> = {}) {
    // Initialize data:
    this.graph = graph;
    this.params = {
      ...DEFAULT_FORCE_ATLAS_2_SETTINGS,
      ...params,
    };

    // Initialize WebGL2 context and textures:
    this.canvas = document.createElement("canvas");
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
    TEXTURES_NAMES.forEach((textureName) => {
      this.uniformLocations[textureName] = gl.getUniformLocation(this.program, `u_${textureName}`);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      (this[textureName] as WebGLTexture) = texture;
    });
  }

  private refreshTextures() {
    const { gl, graph } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.nodesPositionTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, graph.order, 1, 0, gl.RGBA, gl.FLOAT, this.nodesPositionDataArray);
    gl.bindTexture(gl.TEXTURE_2D, this.nodesMetadataTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, graph.order, 1, 0, gl.RG, gl.FLOAT, this.nodesMetadataDataArray);
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
    let i = 0;
    graph.forEachNode((node) => {
      this.nodeIndices[node] = i;
      neighborsPerSource[i] = [];
      i++;
    });

    // Index edges per sources and targets:
    graph.forEachEdge((_edge, { weight }: { weight: number }, source, target) => {
      const sourceIndex = this.nodeIndices[source];
      const targetIndex = this.nodeIndices[target];

      neighborsPerSource[sourceIndex].push({ weight, index: targetIndex });
      neighborsPerSource[targetIndex].push({ weight, index: sourceIndex });
    });

    // Feed the textures:
    let edgeIndex = 0;
    this.maxNeighborsCount = 0;
    graph.forEachNode((node, { x, y, dx, dy }: { x: number; y: number; dx: number; dy: number }) => {
      const nodeIndex = this.nodeIndices[node];
      const neighbors = neighborsPerSource[nodeIndex];
      const neighborsCount = neighbors.length;
      this.maxNeighborsCount = Math.max(this.maxNeighborsCount, neighborsCount);

      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE] = x;
      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE + 1] = y;
      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE + 2] = dx;
      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE + 3] = dy;

      this.nodesMetadataDataArray[nodeIndex * NODES_ATTRIBUTES_IN_METADATA_TEXTURE] = edgeIndex;
      this.nodesMetadataDataArray[nodeIndex * NODES_ATTRIBUTES_IN_METADATA_TEXTURE + 1] = neighborsCount;

      for (let j = 0; j < neighborsCount; j++) {
        const { weight, index } = neighbors[j];
        this.edgesDataArray[edgeIndex * EDGES_ATTRIBUTES_IN_TEXTURE] = index;
        this.edgesDataArray[edgeIndex * EDGES_ATTRIBUTES_IN_TEXTURE + 1] = weight;
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

    graph.nodes().forEach((n, i) => {
      const x = outputArr[4 * i];
      const y = outputArr[4 * i + 1];
      const dx = outputArr[4 * i + 2];
      const dy = outputArr[4 * i + 3];

      // Update graph:
      if (updateGraph)
        graph.mergeNodeAttributes(n, {
          x,
          y,
          dx,
          dy,
        });

      // Update textures data:
      const nodeIndex = this.nodeIndices[n];
      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE] = x;
      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE + 1] = y;
      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE + 2] = dx;
      this.nodesPositionDataArray[nodeIndex * NODES_ATTRIBUTES_IN_POSITION_TEXTURE + 3] = dy;
    });

    this.refreshTextures();
  }

  private checkGraph() {
    const { graph } = this;
    graph.forEachNode((n, { x, y, dx, dy }: { x?: number; y?: number; dx?: number; dy?: number }) => {
      graph.mergeNodeAttributes(n, {
        x: typeof x === "number" ? x : 0,
        y: typeof y === "number" ? y : 0,
        dx: typeof dx === "number" ? dx : 0,
        dy: typeof dy === "number" ? dy : 0,
      });
    });
    graph.forEachEdge((e, { weight }: { weight?: number }) => {
      graph.mergeEdgeAttributes(e, {
        weight: typeof weight === "number" ? weight : 0,
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
    TEXTURES_NAMES.forEach((texture) => {
      gl.uniform1i(this.uniformLocations[texture], 0);
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
      this.readOutput(false);
    }
    this.readOutput(true);
  }
}
