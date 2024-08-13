import Graph from "graphology";
import { Attributes } from "graphology-types";

import { DEFAULT_FORCE_ATLAS_2_SETTINGS, ForceAtlas2Settings, UNIFORM_SETTINGS } from "./consts";
import { getForceAtlas3FragmentShader } from "./shaders/fragment.force-atlas-3";
import { getRepulsionGradientFragmentShader } from "./shaders/fragment.repulsion-gradient";
import { getVertexShader } from "./shaders/vertex.basic";
import { getTextureSize } from "./utils";
import { WebCLProgram } from "./webcl-program";

export * from "./consts";
export * from "./utils";

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
    }
  >;
  private stageOffset: { x: number; y: number };
  private stageDimensions: { width: number; height: number };
  private barycenter: { x: number; y: number; mass: number };
  private nodesPositionArray: Float32Array;
  private nodesMetadataArray: Float32Array;
  private edgesArray: Float32Array;
  private relevantGridPointsArray: Float32Array;

  // Programs:
  private repulsionGradientProgram: WebCLProgram<"nodesPosition" | "nodesMetadata" | "relevantGridPoints">;
  private fa3Program: WebCLProgram<
    "nodesPosition" | "nodesMetadata" | "relevantGridPoints" | "repulsionGradient" | "edges"
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
    this.repulsionGradientProgram = new WebCLProgram({
      gl,
      cells: this.params.repulsionGridSize ** 2,
      fragmentShaderSource: getRepulsionGradientFragmentShader({
        graph,
        gradientTextureSize: this.params.repulsionGridSize,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: ["nodesPosition", "nodesMetadata", "relevantGridPoints"],
    });
    this.fa3Program = new WebCLProgram({
      gl,
      cells: this.graph.order,
      fragmentShaderSource: getForceAtlas3FragmentShader({
        graph,
        maxNeighborsCount: this.maxNeighborsCount,
        gradientTextureSize: this.params.repulsionGridSize,
        linLogMode: this.params.linLogMode,
        adjustSizes: this.params.adjustSizes,
        strongGravityMode: this.params.strongGravityMode,
        outboundAttractionDistribution: this.params.outboundAttractionDistribution,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: ["nodesPosition", "nodesMetadata", "relevantGridPoints", "repulsionGradient", "edges"],
    });

    // Rebind textures:
    const deadTexture = this.fa3Program.dataTextures.repulsionGradient;
    this.fa3Program.dataTextures.repulsionGradient = this.repulsionGradientProgram.outputTexture;
    this.repulsionGradientProgram.dataTextures.nodesMetadata = this.fa3Program.dataTextures.nodesMetadata;
    gl.deleteTexture(deadTexture);
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
    this.nodesPositionArray = new Float32Array(4 * nodesTextureSize ** 2);
    this.nodesMetadataArray = new Float32Array(4 * nodesTextureSize ** 2);
    this.edgesArray = new Float32Array(2 * edgesTextureSize ** 2);

    let k = 0;
    let edgeIndex = 0;
    this.maxNeighborsCount = 0;
    this.outboundAttCompensation = 0;
    graph.forEachNode((node, { x, y, size }: { x: number; y: number; size: number }) => {
      const { index, mass } = this.nodeDataCache[node];
      const neighbors = neighborsPerSource[index];
      const neighborsCount = neighbors.length;
      this.maxNeighborsCount = Math.max(this.maxNeighborsCount, neighborsCount);

      k = index * 4;
      this.nodesPositionArray[k++] = x;
      this.nodesPositionArray[k++] = y;

      k = index * 4;
      this.nodesMetadataArray[k++] = mass;
      this.nodesMetadataArray[k++] = size;
      this.nodesMetadataArray[k++] = edgeIndex;
      this.nodesMetadataArray[k++] = neighborsCount;
      this.outboundAttCompensation += mass;

      for (let j = 0; j < neighborsCount; j++) {
        const { weight, index } = neighbors[j];
        k = edgeIndex * 2;
        this.edgesArray[k++] = index;
        this.edgesArray[k++] = weight;
        edgeIndex++;
      }
    });

    this.outboundAttCompensation /= graph.order;

    this.indexGraph();
  }

  private indexGraph(updatePositions?: boolean) {
    const {
      graph,
      params: { repulsionGridSize, gridMargin },
    } = this;

    const newPositions = updatePositions ? this.fa3Program.getOutput() : new Float32Array();

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    this.relevantGridPointsArray = new Float32Array(repulsionGridSize ** 2);

    // Find grid boundaries:
    graph.forEachNode((n, attr) => {
      let x: number, y: number;

      if (updatePositions) {
        const { index } = this.nodeDataCache[n];
        x = newPositions[4 * index];
        y = newPositions[4 * index + 1];

        graph.mergeNodeAttributes(n, {
          x,
          y,
        });
      } else {
        x = attr.x;
        y = attr.y;
      }

      xMin = Math.min(x, xMin);
      xMax = Math.max(x, xMax);
      yMin = Math.min(y, yMin);
      yMax = Math.max(y, yMax);
    });

    const rawWidth = xMax - xMin;
    const rawHeight = yMax - yMin;
    const xMargin = rawWidth * gridMargin;
    const yMargin = rawHeight * gridMargin;
    this.stageDimensions = {
      width: rawWidth + 2 * xMargin,
      height: rawHeight + 2 * yMargin,
    };
    this.stageOffset = {
      x: xMin - xMargin,
      y: yMin - yMargin,
    };

    // Find grid empty cells, and nodes mass barycenter:
    let totalMass = 0;
    let xWeightedSum = 0;
    let yWeightedSum = 0;
    graph.forEachNode((_n, { x, y, mass }) => {
      totalMass += mass;
      xWeightedSum += mass * x;
      yWeightedSum += mass * y;

      // Find closest grid point:
      const col = Math.round(((x - this.stageOffset.x) / this.stageDimensions.width) * repulsionGridSize);
      const row = Math.round(((y - this.stageOffset.y) / this.stageDimensions.height) * repulsionGridSize);

      // Mark the point as non-empty:
      this.relevantGridPointsArray[row * repulsionGridSize + col] = 1;
    });

    this.barycenter = {
      x: xWeightedSum / totalMass,
      y: yWeightedSum / totalMass,
      mass: totalMass,
    };
  }

  private swapFA3Textures() {
    const { fa3Program } = this;

    [fa3Program.dataTextures.nodesPosition, fa3Program.outputTexture] = [
      fa3Program.outputTexture,
      fa3Program.dataTextures.nodesPosition,
    ];
  }

  private iterate() {
    const { repulsionGradientProgram, fa3Program, params, stageDimensions, stageOffset } = this;

    const fa3Uniforms = {
      stageDimensions: [stageDimensions.width, stageDimensions.height],
      stageOffset: [stageOffset.x, stageOffset.y],
      outboundAttCompensation: this.outboundAttCompensation,
    };
    UNIFORM_SETTINGS.forEach((setting) => (fa3Uniforms[setting] = this.params[setting]));
    fa3Program.setUniforms(fa3Uniforms);

    // Compute repulsion gradient:
    repulsionGradientProgram.dataTextures.nodesPosition = fa3Program.dataTextures.nodesPosition;
    repulsionGradientProgram.activate();
    repulsionGradientProgram.prepare();
    repulsionGradientProgram.setUniforms(fa3Uniforms);
    repulsionGradientProgram.compute();

    // Compute FA3 steps:
    fa3Program.dataTextures.repulsionGradient = repulsionGradientProgram.outputTexture;
    let remainingFA3Step = params.stepsPerRepulsionStep;
    while (remainingFA3Step-- > 0) {
      fa3Program.prepare();
      fa3Program.compute();

      if (remainingFA3Step > 0) this.swapFA3Textures();
    }

    this.indexGraph(false);
  }

  private step(iterations = 1) {
    let iterationsLeft = iterations;
    if (!this.isRunning) return;

    while (iterationsLeft-- > 0) {
      this.iterate();

      if (iterationsLeft > 0) this.swapFA3Textures();
    }
    this.indexGraph(true);

    if (this.remainingSteps--) this.animationFrameID = setTimeout(() => this.step(iterations), 0);
  }

  /**
   * Public API:
   * ***********
   */
  public start() {
    this.remainingSteps = 2;
    this.isRunning = true;
    this.fa3Program.setTextureData("nodesPosition", this.nodesPositionArray, this.graph.order, 4);
    this.fa3Program.setTextureData("nodesMetadata", this.nodesMetadataArray, this.graph.order, 4);
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
