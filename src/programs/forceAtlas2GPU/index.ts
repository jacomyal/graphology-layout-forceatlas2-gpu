import Graph from "graphology";
import { EdgeDisplayData, NodeDisplayData } from "sigma/types";

import { getRegionsCount } from "../../utils/quadtree";
import { getTextureSize, waitForGPUCompletion } from "../../utils/webgl";
import { QuadTreeGPU } from "../quadTreeGPU";
import { Index } from "../webCLProgram";
import { getVertexShader } from "../webCLProgram/vertex";
import { DEFAULT_FORCE_ATLAS_2_SETTINGS, ForceAtlas2Cursors, ForceAtlas2Settings, UNIFORM_SETTINGS } from "./consts";
import { getForceAtlas2FragmentShader } from "./fragment";

const ATTRIBUTES_PER_ITEM = {
  nodesPosition: 4,
  nodesMovement: 4,
  nodesMetadata: 4,
  edges: 2,
  nodesRegions: 4,
  regionsBarycenters: 4,
  regionsOffsets: 2,
  nodesInRegions: 1,
  boundaries: 4,
} as const;

export type ForceAtlas2Graph = Graph<NodeDisplayData, EdgeDisplayData & { weight?: number }>;

export class ForceAtlas2GPU {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  // Internal state:
  private remainingSteps = 0;
  private running = false;
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
  private fa2Program: Index<
    | "nodesPosition"
    | "nodesMovement"
    | "nodesMetadata"
    | "edges"
    | "nodesRegions"
    | "regionsBarycenters"
    | "regionsOffsets"
    | "nodesInRegions"
    | "boundaries",
    "nodesPosition" | "nodesMovement"
  >;
  private quadTree: QuadTreeGPU;

  constructor(graph: ForceAtlas2Graph, params: Partial<ForceAtlas2Settings> = {}) {
    // Initialize data:
    this.graph = graph;
    this.params = {
      ...DEFAULT_FORCE_ATLAS_2_SETTINGS,
      ...params,
    };
    this.nodeDataCache = {};

    if (this.params.enableQuadTree) {
      if (this.params.quadTreeDepth < 1 || this.params.quadTreeDepth > 4)
        throw new Error("quadTreeDepth must be 1, 2, 3 or 4");
    }

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
    const regionsCount = getRegionsCount(this.params.quadTreeDepth);
    this.fa2Program = new Index({
      gl,
      fragments: this.graph.order,
      fragmentShaderSource: getForceAtlas2FragmentShader({
        ...this.params,
        graph,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: graph.order },
        { name: "nodesMovement", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesMovement, items: graph.order },
        { name: "nodesMetadata", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesMetadata, items: graph.order },
        { name: "edges", attributesPerItem: ATTRIBUTES_PER_ITEM.edges, items: graph.size },
        // Quad-tree data textures:
        { name: "nodesRegions", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesRegions, items: graph.order },
        { name: "regionsBarycenters", attributesPerItem: ATTRIBUTES_PER_ITEM.regionsBarycenters, items: regionsCount },
        { name: "regionsOffsets", attributesPerItem: ATTRIBUTES_PER_ITEM.regionsOffsets, items: regionsCount },
        { name: "nodesInRegions", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesInRegions, items: graph.order },
        { name: "boundaries", attributesPerItem: ATTRIBUTES_PER_ITEM.boundaries, items: 1 },
      ],
      outputTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition },
        { name: "nodesMovement", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesMovement },
      ],
    });

    this.quadTree = new QuadTreeGPU(this.gl, { nodesCount: graph.order }, { depth: this.params.quadTreeDepth });

    this.fa2Program.dataTexturesIndex.nodesRegions.texture = this.quadTree.getNodesRegionsTexture();
    this.fa2Program.dataTexturesIndex.regionsBarycenters.texture = this.quadTree.getRegionsBarycentersTexture();
    this.fa2Program.dataTexturesIndex.regionsOffsets.texture = this.quadTree.getRegionsOffsetsTexture();
    this.fa2Program.dataTexturesIndex.nodesInRegions.texture = this.quadTree.getNodesInRegionsTexture();
    this.fa2Program.dataTexturesIndex.boundaries.texture = this.quadTree.getBoundariesTexture();
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
      this.nodesPositionArray[k++] = mass;
      this.outboundAttCompensation += mass;

      k = index * ATTRIBUTES_PER_ITEM.nodesMovement;
      this.nodesMovementArray[k++] = 0;
      this.nodesMovementArray[k++] = 0;
      this.nodesMovementArray[k++] = convergence;

      k = index * ATTRIBUTES_PER_ITEM.nodesMetadata;
      this.nodesMetadataArray[k++] = size;
      this.nodesMetadataArray[k++] = edgeIndex;
      this.nodesMetadataArray[k++] = neighborsCount;

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

    this.fa2Program.activate();
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
    fa2Program.swapTextures("nodesPosition", "nodesPosition");
    fa2Program.swapTextures("nodesMovement", "nodesMovement");
  }

  private async step() {
    const { quadTree, fa2Program, params } = this;
    const { iterationsPerStep } = params;

    let remainingIterations = iterationsPerStep;

    while (remainingIterations-- > 0) {
      if (!this.running) {
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

      // Compute quad-tree if needed:
      if (params.enableQuadTree) {
        quadTree.wireTextures(fa2Program.dataTexturesIndex.nodesPosition.texture);
        await quadTree.compute();
        fa2Program.activate();
      }

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
    this.readGraph();

    this.remainingSteps = steps;
    this.running = true;
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
    this.running = false;
  }

  public run() {
    this.start();
    this.stop();
  }

  public isRunning() {
    return this.running;
  }
}
