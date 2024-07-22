import Graph from "graphology";
import { Attributes } from "graphology-types";

import {
  DEFAULT_FORCE_ATLAS_2_SETTINGS,
  EDGES_ATTRIBUTES_IN_TEXTURE,
  ForceAtlas2Settings,
  NODES_ATTRIBUTES_IN_METADATA_TEXTURE,
  NODES_ATTRIBUTES_IN_POSITION_TEXTURE,
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
      maxNeighborsCount: 1, // TODO: Fix this
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
    // gl.uniform1i(gl.getUniformLocation(this.program, "u_sampler"), 0);
    // gl.uniform1i(gl.getUniformLocation(this.program, "u_textureSize"), this.textureSize);
  }

  private refreshTextures() {
    const { gl, graph } = this;

    const nodesPositionDataArray = new Float32Array(graph.order * NODES_ATTRIBUTES_IN_POSITION_TEXTURE);
    const nodesMetadataDataArray = new Float32Array(graph.order * NODES_ATTRIBUTES_IN_METADATA_TEXTURE);
    const edgesDataArray = new Float32Array(graph.size * 2 * EDGES_ATTRIBUTES_IN_TEXTURE);

    // Index nodes per order:
    const nodeIndices: Record<string, number> = {};
    let i = 0;
    graph.forEachNode((node) => {
      nodeIndices[node] = i;
      neighborsPerSource[i] = [];
      i++;
    });

    // Index edges per sources and targets:
    const neighborsPerSource: { weight: number; index: number }[][] = [];
    graph.forEachEdge((_edge, { weight }: { weight: number }, source, target) => {
      const sourceIndex = nodeIndices[source];
      const targetIndex = nodeIndices[target];

      neighborsPerSource[sourceIndex].push({ weight, index: targetIndex });
      neighborsPerSource[targetIndex].push({ weight, index: sourceIndex });
    });

    // Feed the textures:
    let edgeIndex = 0;
    graph.forEachNode((node, { x, y, dx, dy }: { x: number; y: number; dx: number; dy: number }) => {
      const nodeIndex = nodeIndices[node];
      const neighbors = neighborsPerSource[nodeIndex];
      const neighborsCount = neighbors.length;

      nodesPositionDataArray[nodeIndex] = x;
      nodesPositionDataArray[nodeIndex + 1] = y;
      nodesPositionDataArray[nodeIndex + 2] = dx;
      nodesPositionDataArray[nodeIndex + 3] = dy;

      nodesMetadataDataArray[nodeIndex] = edgeIndex;
      nodesMetadataDataArray[nodeIndex + 1] = neighborsCount;

      for (let j = 0; j < neighborsCount; j++) {
        const { weight, index } = neighbors[j];
        edgesDataArray[edgeIndex] = index;
        edgesDataArray[edgeIndex + 1] = weight;
        edgeIndex++;
      }
    });

    gl.bindTexture(gl.TEXTURE_2D, this.nodesPositionTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, graph.order, 1, 0, gl.RGBA, gl.FLOAT, nodesPositionDataArray);
    gl.bindTexture(gl.TEXTURE_2D, this.edgesTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, graph.size * 2, 1, 0, gl.RGBA, gl.FLOAT, edgesDataArray);
  }

  private updateGraph() {
    const { gl, graph } = this;
    const nodesCount = graph.order;
    const outputArr = new Float32Array(nodesCount * 4);
    gl.readPixels(0, 0, nodesCount, 1, gl.RGBA, gl.FLOAT, outputArr);

    graph.nodes().forEach((n, i) => {
      graph.mergeNodeAttributes(n, {
        x: outputArr[4 * i],
        y: outputArr[4 * i + 1],
        dx: outputArr[4 * i + 2],
        dy: outputArr[4 * i + 3],
      });
    });
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
    const gl = this.gl;

    if (this.program) {
      gl.deleteProgram(this.program);
    }

    if (this.nodesPositionTexture) {
      gl.deleteTexture(this.nodesPositionTexture);
    }

    if (this.edgesTexture) {
      gl.deleteTexture(this.edgesTexture);
    }

    const extension = gl.getExtension("WEBGL_lose_context");
    if (extension) {
      extension.loseContext();
    }

    (this as { gl?: unknown }).gl = null;
  }

  /**
   * Public API:
   * ***********
   */
  // TODO
}
