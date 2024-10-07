import Graph from "graphology";
import { EdgeDisplayData, NodeDisplayData } from "sigma/types";

import { DEFAULT_FORCE_ATLAS_2_SETTINGS, ForceAtlas2Cursors, ForceAtlas2Settings, UNIFORM_SETTINGS } from "./consts";
import { getForceAtlas2FragmentShader } from "./shaders/fragment-force-atlas-2";
import { getVertexShader } from "./shaders/vertex-basic";
import { getTextureSize, waitForGPUCompletion } from "./utils";
import { WebCLProgram } from "./webcl-program";

export * from "./consts";
export * from "./utils";

const ATTRIBUTES_PER_ITEM = {
  nodesPosition: 4,
  nodesMovement: 4,
  nodesMetadata: 4,
  edges: 2,
} as const;

export type ForceAtlas2Graph = Graph<NodeDisplayData, EdgeDisplayData & { weight?: number }>;

export class ForceAtlas2GPU {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  // Internal state:
  private remainingSteps = 0;
  private isRunning = false;
  private animationFrameID: null | number = null;
  private params: ForceAtlas2Settings;

  // Graph data and various caches:
  private graph: ForceAtlas2Graph;
  private maxNeighborsCount: number = 0;
  private outboundAttCompensation: number = 0;
  private nodeDataCache: Record<
    string,
    {
      index: number;
      mass: number;
      convergence: number;
    }
  >;
  private nodesPositionArray: Float32Array = new Float32Array();
  private nodesMovementArray: Float32Array = new Float32Array();
  private nodesMetadataArray: Float32Array = new Float32Array();
  private edgesArray: Float32Array = new Float32Array();

  // Programs:
  private fa2Program: WebCLProgram<
    "nodesPosition" | "nodesMovement" | "nodesMetadata" | "edges",
    "nodesPosition" | "nodesMovement"
  >;

  constructor(graph: ForceAtlas2Graph, params: Partial<ForceAtlas2Settings> = {}) {
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
    this.fa2Program = new WebCLProgram({
      gl,
      fragments: this.graph.order,
      fragmentShaderSource: getForceAtlas2FragmentShader({
        graph,
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
    });

    // Index edges per sources and targets:
    graph.forEachEdge((_edge, attr, source, target) => {
      const weight = attr.weight || 1;
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
        const { weight = 1, index } = neighbors[j];
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

    const nodesPosition = this.fa2Program.getOutput("nodesPosition");

    graph.forEachNode((n) => {
      const { index } = this.nodeDataCache[n];
      const x = nodesPosition[ATTRIBUTES_PER_ITEM.nodesPosition * index];
      const y = nodesPosition[ATTRIBUTES_PER_ITEM.nodesPosition * index + 1];

      graph.mergeNodeAttributes(n, {
        x,
        y,
      });
    });
  }

  private swapFA2Textures() {
    const { fa2Program } = this;

    [fa2Program.dataTexturesIndex.nodesPosition.texture, fa2Program.outputTexturesIndex.nodesPosition.texture] = [
      fa2Program.outputTexturesIndex.nodesPosition.texture,
      fa2Program.dataTexturesIndex.nodesPosition.texture,
    ];
    [fa2Program.dataTexturesIndex.nodesMovement.texture, fa2Program.outputTexturesIndex.nodesMovement.texture] = [
      fa2Program.outputTexturesIndex.nodesMovement.texture,
      fa2Program.dataTexturesIndex.nodesMovement.texture,
    ];
  }

  private async step() {
    const { fa2Program, params } = this;
    const { iterationsPerStep } = params;

    let remainingIterations = iterationsPerStep;

    while (remainingIterations-- > 0) {
      if (!this.isRunning) {
        this.stop();
        return;
      }

      const cursors: Partial<ForceAtlas2Cursors> = {};
      UNIFORM_SETTINGS.forEach((setting) => {
        cursors[setting] = params[setting];
      });
      const fa2Uniforms = {
        ...cursors,
        outboundAttCompensation: this.outboundAttCompensation,
      };

      fa2Program.setUniforms(fa2Uniforms);
      fa2Program.prepare();
      fa2Program.compute();

      if (remainingIterations > 0) this.swapFA2Textures();
    }
    await waitForGPUCompletion(this.gl);
    this.updateGraph();
    this.swapFA2Textures();

    if (this.remainingSteps--) this.animationFrameID = window.setTimeout(() => this.step(), 0);
  }

  /**
   * Public API:
   * ***********
   */
  public start(steps = 1) {
    this.remainingSteps = steps;
    this.isRunning = true;
    this.fa2Program.setTextureData("nodesPosition", this.nodesPositionArray, this.graph.order);
    this.fa2Program.setTextureData("nodesMovement", this.nodesMovementArray, this.graph.order);
    this.fa2Program.setTextureData("nodesMetadata", this.nodesMetadataArray, this.graph.order);
    this.fa2Program.setTextureData("edges", this.edgesArray, this.graph.size * 2);

    this.fa2Program.activate();
    this.step();
  }

  public stop() {
    if (this.animationFrameID) {
      window.clearTimeout(this.animationFrameID);
      this.animationFrameID = null;
    }
    this.isRunning = false;
  }

  public run() {
    this.start();
    this.stop();
  }
}
