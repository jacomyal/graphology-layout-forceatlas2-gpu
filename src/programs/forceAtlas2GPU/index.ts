import Graph from "graphology";
import { EdgeDisplayData, NodeDisplayData } from "sigma/types";

import { getTextureSize } from "../../utils/webgl";
import { KMeansGPU } from "../kMeansGPU";
import { KMeansGroupedGPU } from "../kMeansGroupedGPU";
import { QuadTreeGPU, getDefaultQuadTreeDepth } from "../quadTreeGPU";
import { WebCLProgram } from "../webCLProgram";
import { getVertexShader } from "../webCLProgram/vertex";
import { DEFAULT_FORCE_ATLAS_2_SETTINGS, ForceAtlas2Settings } from "./consts";
import { getForceAtlas2FragmentShader } from "./fragment";

const ATTRIBUTES_PER_ITEM = {
  nodesPosition: 4,
  nodesMovement: 4,
  nodesMetadata: 4,
  edges: 2,
  boundaries: 4,
  centroidsPosition: 4,
  centroidsOffsets: 2,
  nodesInCentroids: 1,
  closestCentroid: 1,
  quadTree: 4,
} as const;

export type ForceAtlas2Graph = Graph<NodeDisplayData, EdgeDisplayData & { weight?: number }>;

export class ForceAtlas2GPU {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  // At most this many issued-but-not-finished batches of iterations. 2 keeps
  // the GPU busy while a batch runs, without letting the command queue grow
  // unboundedly (which freezes the whole page when the GPU can't keep up):
  private static readonly MAX_PENDING_BATCHES = 2;

  // Internal state:
  private remainingIterations = -1;
  private running = false;
  private animationFrameID: null | number = null;
  private params: ForceAtlas2Settings;
  private totalIterations = 0;
  private lastSyncTime = 0;
  private syncPending = false;
  private batchFences: WebGLSync[] = [];

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
    | "nodesPosition"
    | "nodesMovement"
    | "nodesMetadata"
    | "edges"
    | "boundaries"
    | "centroidsPosition"
    | "centroidsOffsets"
    | "nodesInCentroids"
    | "closestCentroid"
    | "quadTree",
    "nodesPosition" | "nodesMovement"
  >;
  private quadTree?: QuadTreeGPU;
  private kMeans?: KMeansGPU;
  private kMeansGrouped?: KMeansGroupedGPU;

  constructor(graph: ForceAtlas2Graph, params: Partial<ForceAtlas2Settings> = {}) {
    // Initialize data:
    this.graph = graph;
    this.params = {
      ...DEFAULT_FORCE_ATLAS_2_SETTINGS,
      ...params,
    };
    this.nodeDataCache = {};

    let { repulsion } = this.params;
    if (repulsion.type === "k-means") {
      if (repulsion.centroids < 1) throw new Error("K-means must have at least 1 centroid");
      if (repulsion.steps < 1) throw new Error("K-means must have at least 1 step");
    } else if (repulsion.type === "quad-tree") {
      // Resolve the depth once, so that the shader and the quadtree always
      // agree:
      const depth = repulsion.depth ?? getDefaultQuadTreeDepth(graph.order);
      if (depth < 1 || depth > 12) throw new Error("Quadtree depth must be between 1 and 12");
      // Lower thetas mean wider per-level neighborhoods, whose cost grows as
      // 1/theta^2 (theta=1 reads 27 cells per level, theta=0.25 reads 243):
      const theta = repulsion.theta ?? 1;
      if (theta < 0.25 || theta > 1) throw new Error("Quadtree theta must be between 0.25 and 1");
      repulsion = { ...repulsion, depth, theta };
      this.params = { ...this.params, repulsion };
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
    const kMeansCentroidsCount = repulsion.type === "k-means" ? repulsion.centroids : 1;
    this.fa2Program = new WebCLProgram({
      gl,
      name: "ForceAtlas2",
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
        // Quad-tree:
        { name: "boundaries", attributesPerItem: ATTRIBUTES_PER_ITEM.boundaries, items: 1 },
        // K-means:
        {
          name: "centroidsPosition",
          attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsPosition,
          items: kMeansCentroidsCount,
        },
        // K-means-grouped:
        {
          name: "centroidsOffsets",
          attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsOffsets,
          items: kMeansCentroidsCount,
        },
        { name: "nodesInCentroids", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesInCentroids, items: graph.order },
        { name: "closestCentroid", attributesPerItem: ATTRIBUTES_PER_ITEM.closestCentroid, items: graph.order },
        // Quad-tree (the texture is a non-square atlas, wired directly):
        { name: "quadTree", attributesPerItem: ATTRIBUTES_PER_ITEM.quadTree, items: 1 },
      ],
      outputTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition },
        { name: "nodesMovement", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesMovement },
      ],
    });

    // Initialize only the repulsion method that's needed:
    if (repulsion.type === "quad-tree") {
      this.quadTree = new QuadTreeGPU(this.gl, { nodesCount: graph.order }, { depth: repulsion.depth as number });
      this.fa2Program.dataTexturesIndex.quadTree.texture = this.quadTree.getAtlasTexture();
      this.fa2Program.dataTexturesIndex.boundaries.texture = this.quadTree.getBoundariesTexture();
    } else if (repulsion.type === "k-means") {
      if (repulsion.nodeToNodeRepulsion) {
        this.kMeansGrouped = new KMeansGroupedGPU(this.gl, {
          nodesCount: graph.order,
          centroidsCount: kMeansCentroidsCount,
          debug: this.params.debug,
        });
        this.fa2Program.dataTexturesIndex.centroidsPosition.texture = this.kMeansGrouped.getCentroidsPosition();
        this.fa2Program.dataTexturesIndex.centroidsOffsets.texture = this.kMeansGrouped.getCentroidsOffsets();
        this.fa2Program.dataTexturesIndex.nodesInCentroids.texture = this.kMeansGrouped.getNodesInCentroids();
        this.fa2Program.dataTexturesIndex.closestCentroid.texture = this.kMeansGrouped.getClosestCentroid();
      } else {
        this.kMeans = new KMeansGPU(this.gl, {
          nodesCount: graph.order,
          centroidsCount: kMeansCentroidsCount,
          debug: this.params.debug,
        });
        this.fa2Program.dataTexturesIndex.centroidsPosition.texture = this.kMeans.getCentroidsPosition();
      }
    }
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

  private applyNodesPositions(nodesPosition: Float32Array) {
    this.graph.updateEachNodeAttributes(
      (node, attributes) => {
        const { index } = this.nodeDataCache[node];
        attributes.x = nodesPosition[ATTRIBUTES_PER_ITEM.nodesPosition * index];
        attributes.y = nodesPosition[ATTRIBUTES_PER_ITEM.nodesPosition * index + 1];
        return attributes;
      },
      { attributes: ["x", "y"] },
    );
  }

  private swapFA2Textures() {
    const { fa2Program } = this;
    fa2Program.swapTextures("nodesPosition", "nodesPosition");
    fa2Program.swapTextures("nodesMovement", "nodesMovement");
  }

  private runIteration() {
    const { fa2Program, params } = this;
    const { repulsion } = params;

    // Compute additional repulsion structures if needed:
    if (repulsion.type === "quad-tree") {
      this.quadTree!.wireTextures(fa2Program.dataTexturesIndex.nodesPosition.texture);
      this.quadTree!.compute();
      fa2Program.activate();
    } else if (repulsion.type === "k-means") {
      // Only recompute centroids based on centroidUpdateInterval
      if (this.totalIterations % repulsion.centroidUpdateInterval === 0) {
        if (repulsion.nodeToNodeRepulsion) {
          this.kMeansGrouped!.wireTextures(fa2Program.dataTexturesIndex.nodesPosition.texture);
          this.kMeansGrouped!.compute({
            steps: repulsion.steps,
            reinitialize: repulsion.resetCentroids,
            iterationCount: this.totalIterations,
          });
        } else {
          this.kMeans!.wireTextures(fa2Program.dataTexturesIndex.nodesPosition.texture);
          this.kMeans!.compute({
            steps: repulsion.steps,
            reinitialize: repulsion.resetCentroids,
            iterationCount: this.totalIterations,
          });
        }
      }
      fa2Program.activate();
    }

    fa2Program.setUniforms({
      edgeWeightInfluence: params.edgeWeightInfluence,
      scalingRatio: params.scalingRatio,
      gravity: params.gravity,
      maxForce: params.maxForce,
      slowDown: params.slowDown,
      outboundAttCompensation: this.outboundAttCompensation,
    });
    fa2Program.prepare();
    fa2Program.compute();
    this.swapFA2Textures();

    this.totalIterations++;
  }

  /**
   * This method runs once per animation frame, and never blocks:
   * - It only *issues* the iterations' GPU commands (the CPU does not wait
   *   for their results)
   * - Positions are synced back to the graphology instance through an
   *   asynchronous readback, polled here and started at most once every
   *   syncInterval milliseconds
   */
  private runFrame() {
    if (!this.running) return;

    const { gl, fa2Program, params } = this;
    const { iterationsPerFrame, syncInterval } = params;

    // 1. Reap the fences of the batches the GPU has finished:
    this.batchFences = this.batchFences.filter((fence) => {
      if (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) return true;
      gl.deleteSync(fence);
      return false;
    });

    // 2. Issue a new batch of iterations, but only if the GPU keeps up
    //    (backpressure). When it doesn't, skip this frame: the main thread
    //    stays free, and the iterations rate settles on what the GPU can
    //    actually sustain:
    if (this.batchFences.length < ForceAtlas2GPU.MAX_PENDING_BATCHES) {
      let count = iterationsPerFrame;
      if (this.remainingIterations >= 0) count = Math.min(count, this.remainingIterations);
      for (let i = 0; i < count; i++) this.runIteration();
      if (this.remainingIterations > 0) this.remainingIterations -= count;

      if (count > 0) {
        this.batchFences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) as WebGLSync);
        gl.flush();
      }
    }

    // 3. All requested iterations are issued: finish with one last
    //    synchronous sync (a single stall, at the very end):
    if (this.remainingIterations === 0) {
      this.finishRun();
      return;
    }

    // 4. Poll the pending readback, if any:
    if (this.syncPending) {
      const nodesPosition = fa2Program.pollAsyncDataRead();
      if (nodesPosition) {
        this.applyNodesPositions(nodesPosition);
        this.syncPending = false;
        this.lastSyncTime = performance.now();
      }
    }

    // 5. Maybe enqueue a fresh readback:
    if (!this.syncPending && performance.now() - this.lastSyncTime >= syncInterval) {
      this.syncPending = fa2Program.startAsyncDataRead("nodesPosition");
    }

    this.animationFrameID = window.requestAnimationFrame(() => this.runFrame());
  }

  private clearBatchFences() {
    this.batchFences.forEach((fence) => this.gl.deleteSync(fence));
    this.batchFences = [];
  }

  private finishRun() {
    this.clearBatchFences();
    this.fa2Program.cancelAsyncRead();
    this.syncPending = false;
    this.applyNodesPositions(this.fa2Program.getInput("nodesPosition"));
    this.running = false;
    this.animationFrameID = null;
  }

  /**
   * Public API:
   * ***********
   */
  public start(iterations = -1) {
    // Cancel any previously scheduled frame, so two loops never run at once:
    if (this.animationFrameID !== null) {
      window.cancelAnimationFrame(this.animationFrameID);
      this.animationFrameID = null;
    }

    this.readGraph();

    this.remainingIterations = iterations;
    this.running = true;
    this.lastSyncTime = performance.now();
    this.syncPending = false;
    this.clearBatchFences();
    this.fa2Program.cancelAsyncRead();
    this.fa2Program.setTextureData("nodesPosition", this.nodesPositionArray, this.graph.order);
    this.fa2Program.setTextureData("nodesMovement", this.nodesMovementArray, this.graph.order);
    this.fa2Program.setTextureData("nodesMetadata", this.nodesMetadataArray, this.graph.order);
    this.fa2Program.setTextureData("edges", this.edgesArray, this.graph.size * 2);

    if (this.params.repulsion.type === "quad-tree") {
      // Wire nodes texture BEFORE initializing
      this.quadTree!.wireTextures(this.fa2Program.dataTexturesIndex.nodesPosition.texture);
    } else if (this.params.repulsion.type === "k-means") {
      if (this.params.repulsion.nodeToNodeRepulsion) {
        // Wire nodes texture and initialize centroids
        this.kMeansGrouped!.wireTextures(this.fa2Program.dataTexturesIndex.nodesPosition.texture);
        this.kMeansGrouped!.initialize();
        // Run initial clustering to set up all textures
        this.kMeansGrouped!.compute({ steps: this.params.repulsion.steps });
      } else {
        // Wire nodes texture and initialize centroids
        this.kMeans!.wireTextures(this.fa2Program.dataTexturesIndex.nodesPosition.texture);
        this.kMeans!.initialize();
      }
    }

    this.fa2Program.activate();
    this.runFrame();
  }

  public stop() {
    if (this.animationFrameID !== null) {
      window.cancelAnimationFrame(this.animationFrameID);
      this.animationFrameID = null;
    }
    if (this.running) this.finishRun();
    this.running = false;
  }

  public run() {
    this.start();
    this.stop();
  }

  public isRunning() {
    return this.running;
  }

  public getTotalIterations() {
    return this.totalIterations;
  }

  // Debug methods
  public getKMeans(): KMeansGPU {
    if (!this.kMeans) {
      throw new Error('KMeansGPU is not initialized. Use repulsion type "k-means" to enable it.');
    }
    return this.kMeans;
  }

  public getKMeansGrouped(): KMeansGroupedGPU {
    if (!this.kMeansGrouped) {
      throw new Error(
        'KMeansGroupedGPU is not initialized. Use repulsion type "k-means" with nodeToNodeRepulsion: true to enable it.',
      );
    }
    return this.kMeansGrouped;
  }

  public getQuadTree(): QuadTreeGPU {
    if (!this.quadTree) {
      throw new Error('QuadTreeGPU is not initialized. Use repulsion type "quad-tree" to enable it.');
    }
    return this.quadTree;
  }
}
