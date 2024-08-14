import Graph from "graphology";
import { Attributes } from "graphology-types";

import { DEFAULT_FORCE_ATLAS_2_SETTINGS, ForceAtlas2Settings, UNIFORM_SETTINGS } from "./consts";
import { getForceAtlas3FragmentShader } from "./shaders/fragment.force-atlas-3";
import { getVertexShader } from "./shaders/vertex.basic";
import { getTextureSize } from "./utils";
import { WebCLProgram } from "./webcl-program";

export * from "./consts";
export * from "./utils";

const ATTRIBUTES_PER_ITEM = {
  nodesPosition: 2,
  nodesMovement: 4,
  nodesMetadata: 4,
  edges: 2,
} as const;

export class ForceAtlas2GPU<
  NodeAttributes extends Attributes = Attributes,
  EdgeAttributes extends Attributes = Attributes,
> {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  // Internal state:
  private remainingSteps = 0;
  private isRunning = false;
  private animationFrameID: null | number;
  private params: ForceAtlas2Settings;

  // Graph data and various caches:
  private graph: Graph<NodeAttributes, EdgeAttributes>;
  private maxNeighborsCount: number;
  private outboundAttCompensation: number;
  private nodeDataCache: Record<
    string,
    {
      index: number;
      mass: number;
      convergence: number;
    }
  >;
  private nodesPositionArray: Float32Array;
  private nodesMovementArray: Float32Array;
  private nodesMetadataArray: Float32Array;
  private edgesArray: Float32Array;

  // Programs:
  private fa3Program: WebCLProgram<
    "nodesPosition" | "nodesMovement" | "nodesMetadata" | "edges",
    "nodesPosition" | "nodesMovement"
  >;

  constructor(graph: Graph<NodeAttributes, EdgeAttributes>, params: Partial<ForceAtlas2Settings> = {}) {
    // Initialize data:
    this.graph = graph;
    this.params = {
      ...DEFAULT_FORCE_ATLAS_2_SETTINGS,
      ...params,
    };
    this.nodeDataCache = {};

    this.readGraph();

    // Initialize WebGL2 context:
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1;
    this.canvas.height = 1;
    const gl = this.canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 is not supported in this browser.");
    this.gl = gl;

    // Check for required extension
    const ext = gl.getExtension("EXT_color_buffer_float");
    if (!ext) {
      throw new Error("EXT_color_buffer_float extension not supported");
    }

    // Initialize programs:
    this.fa3Program = new WebCLProgram({
      gl,
      fragments: this.graph.order,
      fragmentShaderSource: getForceAtlas3FragmentShader({
        graph,
        maxNeighborsCount: this.maxNeighborsCount,
        linLogMode: this.params.linLogMode,
        adjustSizes: this.params.adjustSizes,
        strongGravityMode: this.params.strongGravityMode,
        outboundAttractionDistribution: this.params.outboundAttractionDistribution,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition },
        { name: "nodesMovement", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesMovement },
        { name: "nodesMetadata", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesMetadata },
        { name: "edges", attributesPerItem: ATTRIBUTES_PER_ITEM.edges },
      ],
      outputTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition },
        { name: "nodesMovement", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesMovement },
      ],
    });
  }

  private readGraph() {
    const { graph } = this;
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
    graph.forEachEdge((_edge, { weight = 1 }: { weight: number }, source, target) => {
      const sourceIndex = this.nodeDataCache[source].index;
      const targetIndex = this.nodeDataCache[target].index;

      neighborsPerSource[sourceIndex].push({ weight, index: targetIndex });
      neighborsPerSource[targetIndex].push({ weight, index: sourceIndex });
      this.nodeDataCache[source].mass += weight;
      this.nodeDataCache[target].mass += weight;
    });

    const nodesTextureSize = getTextureSize(graph.order);
    const edgesTextureSize = getTextureSize(graph.size * 2);
    this.nodesPositionArray = new Float32Array(ATTRIBUTES_PER_ITEM.nodesPosition * nodesTextureSize ** 2);
    this.nodesMovementArray = new Float32Array(ATTRIBUTES_PER_ITEM.nodesMovement * nodesTextureSize ** 2);
    this.nodesMetadataArray = new Float32Array(ATTRIBUTES_PER_ITEM.nodesMetadata * nodesTextureSize ** 2);
    this.edgesArray = new Float32Array(ATTRIBUTES_PER_ITEM.edges * edgesTextureSize ** 2);

    let k = 0;
    let edgeIndex = 0;
    this.maxNeighborsCount = 0;
    this.outboundAttCompensation = 0;
    graph.forEachNode((node, { x, y, size }: { x: number; y: number; size: number }) => {
      const { index, mass, convergence } = this.nodeDataCache[node];
      const neighbors = neighborsPerSource[index];
      const neighborsCount = neighbors.length;
      this.maxNeighborsCount = Math.max(this.maxNeighborsCount, neighborsCount);

      k = index * ATTRIBUTES_PER_ITEM.nodesPosition;
      this.nodesPositionArray[k++] = x;
      this.nodesPositionArray[k++] = y;

      k = index * ATTRIBUTES_PER_ITEM.nodesMovement;
      this.nodesMovementArray[k++] = 0;
      this.nodesMovementArray[k++] = 0;
      this.nodesMovementArray[k++] = convergence;

      k = index * ATTRIBUTES_PER_ITEM.nodesMetadata;
      this.nodesMetadataArray[k++] = mass;
      this.nodesMetadataArray[k++] = size;
      this.nodesMetadataArray[k++] = edgeIndex;
      this.nodesMetadataArray[k++] = neighborsCount;
      this.outboundAttCompensation += mass;

      for (let j = 0; j < neighborsCount; j++) {
        const { weight, index } = neighbors[j];
        k = edgeIndex * ATTRIBUTES_PER_ITEM.edges;
        this.edgesArray[k++] = index;
        this.edgesArray[k++] = weight;
        edgeIndex++;
      }
    });

    this.outboundAttCompensation /= graph.order;
  }

  private updateGraph() {
    const { graph } = this;

    const nodesPosition = this.fa3Program.getOutput("nodesPosition");

    graph.forEachNode((n) => {
      const { index } = this.nodeDataCache[n];
      const x = nodesPosition[2 * index];
      const y = nodesPosition[2 * index + 1];

      graph.mergeNodeAttributes(n, {
        x,
        y,
      });
    });
  }

  private swapFA3Textures() {
    const { fa3Program } = this;

    [fa3Program.dataTexturesIndex.nodesPosition.texture, fa3Program.outputTexturesIndex.nodesPosition.texture] = [
      fa3Program.outputTexturesIndex.nodesPosition.texture,
      fa3Program.dataTexturesIndex.nodesPosition.texture,
    ];
    [fa3Program.dataTexturesIndex.nodesMovement.texture, fa3Program.outputTexturesIndex.nodesMovement.texture] = [
      fa3Program.outputTexturesIndex.nodesMovement.texture,
      fa3Program.dataTexturesIndex.nodesMovement.texture,
    ];
  }

  private step(iterations = 1) {
    const { fa3Program, params } = this;
    let iterationsLeft = iterations;
    if (!this.isRunning) {
      this.stop();
      return;
    }

    while (iterationsLeft-- > 0) {
      const fa3Uniforms = {
        outboundAttCompensation: this.outboundAttCompensation,
      };
      UNIFORM_SETTINGS.forEach((setting) => (fa3Uniforms[setting] = params[setting]));

      fa3Program.setUniforms(fa3Uniforms);
      fa3Program.prepare();
      fa3Program.compute();

      if (iterationsLeft > 0) this.swapFA3Textures();
    }
    this.updateGraph();
    this.swapFA3Textures();

    if (this.remainingSteps--) this.animationFrameID = setTimeout(() => this.step(iterations), 0);
  }

  /**
   * Public API:
   * ***********
   */
  public start() {
    this.remainingSteps = 1;
    this.isRunning = true;
    this.fa3Program.setTextureData("nodesPosition", this.nodesPositionArray, this.graph.order);
    this.fa3Program.setTextureData("nodesMovement", this.nodesMovementArray, this.graph.order);
    this.fa3Program.setTextureData("nodesMetadata", this.nodesMetadataArray, this.graph.order);
    this.fa3Program.setTextureData("edges", this.edgesArray, this.graph.size);

    this.fa3Program.activate();
    this.step(this.params.iterationsPerStep);
  }

  public stop() {
    if (this.animationFrameID) {
      clearTimeout(this.animationFrameID);
      this.animationFrameID = null;
    }
    this.isRunning = false;
  }

  public run() {
    this.start();
    this.stop();
  }
}
