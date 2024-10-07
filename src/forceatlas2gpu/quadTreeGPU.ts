import { getRegionsCount } from "../utils/quadtree";
import { WebCLProgram } from "../utils/webcl-program";
import { getQuadTreeBoundariesFragmentShader } from "./shaders/fragment-quadtree-boundaries";
import { getQuadTreeIndexFragmentShader } from "./shaders/fragment-quadtree-index";
import { getVertexShader } from "./shaders/vertex-basic";

export * from "./consts";
export * from "../utils/webgl";

const ATTRIBUTES_PER_ITEM = {
  boundaries: 4,
  nodesPosition: 4,
  nodesRegionsIDs: 4,
  regionsBarycenters: 4,
} as const;

export type QuadTreeGPUSettings = {
  depth: number;
};

export const DEFAULT_QUAD_TREE_GPU_SETTINGS: QuadTreeGPUSettings = {
  depth: 4,
};

export class QuadTreeGPU {
  private params: QuadTreeGPUSettings;

  // Programs:
  private boundariesProgram: WebCLProgram<"nodesPosition", "boundaries">;
  private indexProgram: WebCLProgram<"nodesPosition" | "boundaries", "nodesRegionsIDs">;
  private aggregateProgram: WebCLProgram<"nodesPosition" | "nodesRegionsIDs", "regionsBarycenters">;

  constructor(
    gl: WebGL2RenderingContext,
    { nodesTexture, nodesCount }: { nodesCount: number; nodesTexture?: WebGLTexture },
    params: Partial<QuadTreeGPUSettings> = {},
  ) {
    this.params = { ...DEFAULT_QUAD_TREE_GPU_SETTINGS, ...params };

    // Initialize programs:
    this.boundariesProgram = new WebCLProgram({
      gl,
      fragments: 1,
      fragmentShaderSource: getQuadTreeBoundariesFragmentShader({
        nodesCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [{ name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition }],
      outputTextures: [{ name: "boundaries", attributesPerItem: ATTRIBUTES_PER_ITEM.boundaries }],
    });

    this.indexProgram = new WebCLProgram({
      gl,
      fragments: nodesCount,
      fragmentShaderSource: getQuadTreeIndexFragmentShader({
        nodesCount,
        maxDepth: this.params.depth,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition },
        { name: "boundaries", attributesPerItem: ATTRIBUTES_PER_ITEM.boundaries },
      ],
      outputTextures: [{ name: "nodesRegionsIDs", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesRegionsIDs }],
    });

    this.aggregateProgram = new WebCLProgram({
      gl,
      fragments: getRegionsCount(this.params.depth),
      fragmentShaderSource: getQuadTreeIndexFragmentShader({
        nodesCount,
        maxDepth: params.depth,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition },
        { name: "nodesRegionsIDs", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesRegionsIDs },
      ],
      outputTextures: [{ name: "regionsBarycenters", attributesPerItem: ATTRIBUTES_PER_ITEM.regionsBarycenters }],
    });

    // Initial data textures rebind:
    if (nodesTexture) this.rebindTextures(nodesTexture);
  }

  private rebindTextures(nodesTexture: WebGLTexture) {
    this.boundariesProgram.dataTexturesIndex.nodesPosition.texture = nodesTexture;
    this.indexProgram.dataTexturesIndex.nodesPosition.texture = nodesTexture;
    this.aggregateProgram.dataTexturesIndex.nodesPosition.texture = nodesTexture;

    this.indexProgram.dataTexturesIndex.boundaries.texture =
      this.boundariesProgram.outputTexturesIndex.boundaries.texture;

    this.aggregateProgram.dataTexturesIndex.nodesRegionsIDs.texture =
      this.indexProgram.outputTexturesIndex.nodesRegionsIDs.texture;
  }

  private async step() {
    const { boundariesProgram, indexProgram, aggregateProgram } = this;

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
  }

  /**
   * Public API:
   * ***********
   */
  public async compute(nodesTexture: WebGLTexture) {
    this.rebindTextures(nodesTexture);
    return this.step();
  }

  public getNodesRegionsTexture(): WebGLTexture {
    return this.aggregateProgram.dataTexturesIndex.nodesRegionsIDs.texture;
  }
  public getRegionsBarycentersTexture(): WebGLTexture {
    return this.aggregateProgram.outputTexturesIndex.regionsBarycenters;
  }
}
