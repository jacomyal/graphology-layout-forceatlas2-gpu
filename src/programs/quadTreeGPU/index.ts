import { getRegionsCount } from "../../utils/quadtree";
import { Index } from "../webCLProgram";
import { getTextureSize } from "../../utils/webgl";
import { getQuadTreeAggregateFragmentShader } from "./fragment-aggregate";
import { getQuadTreeBoundariesFragmentShader } from "./fragment-boundaries";
import { getQuadTreeIndexFragmentShader } from "./fragment-index";
import { getQuadTreeOffsetFragmentShader } from "./fragment-offset";
import { getQuadTreeSetupSortFragmentShader } from "./fragment-setup-sort";
import { getVertexShader } from "../webCLProgram/vertex";
import { BitonicSortGPU } from "../bitonicSortGPU";

const ATTRIBUTES_PER_ITEM = {
  boundaries: 4,
  nodesPosition: 4,
  nodesRegionsIDs: 4,
  regionsBarycenters: 4,
  regionsOffsets: 4,
  values: 4,
  sortOn: 4,
} as const;

export type QuadTreeGPUSettings = {
  depth: number;
};

export type QuadTreeNode = { x: number; y: number; mass?: number };

export const DEFAULT_QUAD_TREE_GPU_SETTINGS: QuadTreeGPUSettings = {
  depth: 4,
};

export class QuadTreeGPU {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private gl: WebGL2RenderingContext;
  private nodesCount: number;
  private params: QuadTreeGPUSettings;

  // Programs:
  private boundariesProgram: Index<"nodesPosition", "boundaries">;
  private indexProgram: Index<"nodesPosition" | "boundaries", "nodesRegionsIDs">;
  private aggregateProgram: Index<"nodesPosition" | "nodesRegionsIDs", "regionsBarycenters">;
  private offsetProgram: Index<"regionsBarycenters", "regionsOffsets">;
  private setupSortProgram: Index<"nodesRegionsIDs", "values" | "sortOn">;
  private bitonicSort: BitonicSortGPU;

  constructor(
    gl: WebGL2RenderingContext,
    { nodesTexture, nodesCount }: { nodesCount: number; nodesTexture?: WebGLTexture },
    params: Partial<QuadTreeGPUSettings> = {},
  ) {
    this.gl = gl;
    this.nodesCount = nodesCount;
    this.params = { ...DEFAULT_QUAD_TREE_GPU_SETTINGS, ...params };
    const regionsCount = getRegionsCount(this.params.depth);

    // Initialize programs:
    this.boundariesProgram = new Index({
      gl,
      fragments: 1,
      fragmentShaderSource: getQuadTreeBoundariesFragmentShader({
        nodesCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: nodesCount },
      ],
      outputTextures: [{ name: "boundaries", attributesPerItem: ATTRIBUTES_PER_ITEM.boundaries }],
    });

    this.indexProgram = new Index({
      gl,
      fragments: nodesCount,
      fragmentShaderSource: getQuadTreeIndexFragmentShader({
        nodesCount,
        depth: this.params.depth,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: nodesCount },
        { name: "boundaries", attributesPerItem: ATTRIBUTES_PER_ITEM.boundaries, items: 1 },
      ],
      outputTextures: [{ name: "nodesRegionsIDs", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesRegionsIDs }],
    });

    this.aggregateProgram = new Index({
      gl,
      fragments: regionsCount,
      fragmentShaderSource: getQuadTreeAggregateFragmentShader({
        nodesCount,
        depth: this.params.depth,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: nodesCount },
        { name: "nodesRegionsIDs", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesRegionsIDs, items: nodesCount },
      ],
      outputTextures: [{ name: "regionsBarycenters", attributesPerItem: ATTRIBUTES_PER_ITEM.regionsBarycenters }],
    });

    this.offsetProgram = new Index({
      gl,
      fragments: regionsCount,
      fragmentShaderSource: getQuadTreeOffsetFragmentShader({
        depth: this.params.depth,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "regionsBarycenters", attributesPerItem: ATTRIBUTES_PER_ITEM.regionsBarycenters, items: regionsCount },
      ],
      outputTextures: [{ name: "regionsOffsets", attributesPerItem: ATTRIBUTES_PER_ITEM.regionsOffsets }],
    });

    this.setupSortProgram = new Index({
      gl,
      fragments: regionsCount,
      fragmentShaderSource: getQuadTreeSetupSortFragmentShader({
        nodesCount,
        depth: this.params.depth,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesRegionsIDs", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesRegionsIDs, items: nodesCount },
      ],
      outputTextures: [
        { name: "values", attributesPerItem: ATTRIBUTES_PER_ITEM.values },
        { name: "sortOn", attributesPerItem: ATTRIBUTES_PER_ITEM.sortOn },
      ],
    });

    this.bitonicSort = new BitonicSortGPU(gl, { valuesCount: nodesCount, attributesPerItem: 4 });

    // Initial data textures rebind:
    this.wireTextures(nodesTexture);
  }

  /**
   * Public API:
   * ***********
   */
  public wireTextures(nodesTexture?: WebGLTexture) {
    const { boundariesProgram, indexProgram, aggregateProgram, offsetProgram, setupSortProgram } = this;

    if (nodesTexture) boundariesProgram.dataTexturesIndex.nodesPosition.texture = nodesTexture;
    Index.wirePrograms({ boundariesProgram, indexProgram, aggregateProgram, offsetProgram, setupSortProgram });
  }

  public async compute() {
    const { boundariesProgram, indexProgram, aggregateProgram, offsetProgram, setupSortProgram, bitonicSort } = this;

    // Search boundaries
    boundariesProgram.activate();
    boundariesProgram.prepare();
    boundariesProgram.compute();

    // Index nodes
    indexProgram.activate();
    indexProgram.prepare();
    indexProgram.compute();

    // Index each level mass and center
    aggregateProgram.activate();
    aggregateProgram.prepare();
    aggregateProgram.compute();

    // Count each region offset
    offsetProgram.activate();
    offsetProgram.prepare();
    offsetProgram.compute();

    // Prepare bitonic sort
    setupSortProgram.activate();
    setupSortProgram.prepare();
    setupSortProgram.compute();

    // Sort nodes
    bitonicSort.setTextures({
      valuesTexture: setupSortProgram.outputTexturesIndex.values.texture,
      sortOnTexture: setupSortProgram.outputTexturesIndex.sortOn.texture,
    });
    await bitonicSort.sort();
  }

  // These methods are for the WebGL pipelines:
  public getNodesRegionsTexture(): WebGLTexture {
    return this.indexProgram.outputTexturesIndex.nodesRegionsIDs.texture;
  }
  public getRegionsBarycentersTexture(): WebGLTexture {
    return this.aggregateProgram.outputTexturesIndex.regionsBarycenters.texture;
  }
  public getRegionsOffsetsTexture(): WebGLTexture {
    return this.offsetProgram.outputTexturesIndex.regionsOffsets.texture;
  }
  public getNodesInRegionsTexture(): WebGLTexture {
    return this.bitonicSort.getSortedTexture();
  }
  public getBoundariesTexture(): WebGLTexture {
    return this.boundariesProgram.outputTexturesIndex.boundaries.texture;
  }
  public getPrograms() {
    const { boundariesProgram, indexProgram, aggregateProgram, offsetProgram, setupSortProgram, bitonicSort } = this;

    return {
      boundariesProgram,
      indexProgram,
      aggregateProgram,
      offsetProgram,
      setupSortProgram,
      ...bitonicSort.getPrograms(),
    };
  }

  // These methods are for using the quad-tree directly (and for testing):
  public setNodesData(nodes: QuadTreeNode[]) {
    const { nodesCount, boundariesProgram } = this;
    const textureSize = getTextureSize(nodesCount);
    const nodesByteArray = new Float32Array(ATTRIBUTES_PER_ITEM.nodesPosition * textureSize ** 2);

    nodes.forEach(({ x, y, mass }, i) => {
      mass = mass || 1;

      nodesByteArray[i * 4] = x;
      nodesByteArray[i * 4 + 1] = y;
      nodesByteArray[i * 4 + 2] = mass;
    });

    boundariesProgram.activate();
    boundariesProgram.prepare();
    boundariesProgram.setTextureData("nodesPosition", nodesByteArray, nodesCount);
  }
  public getBoundaries() {
    return Array.from(this.boundariesProgram.getOutput("boundaries"));
  }
  public getNodesRegions() {
    return Array.from(this.indexProgram.getOutput("nodesRegionsIDs"));
  }
  public getRegionsBarycenters() {
    return Array.from(this.aggregateProgram.getOutput("regionsBarycenters"));
  }
  public getRegionsOffsets() {
    return Array.from(this.offsetProgram.getOutput("regionsOffsets"));
  }
  public getNodesInRegions() {
    return this.bitonicSort.getSortedValues();
  }
}
