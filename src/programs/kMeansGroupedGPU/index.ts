import { BitonicSortGPU } from "../bitonicSortGPU";
import { KMeansGPU } from "../kMeansGPU";
import { WebCLProgram } from "../webCLProgram";
import { getVertexShader } from "../webCLProgram/vertex";
import { getKMeansOffsetFragmentShader } from "./fragment-offset";
import { getKMeansSetupSortFragmentShader } from "./fragment-setup-sort";

const ATTRIBUTES_PER_ITEM = {
  closestCentroid: 1,
  centroidsPosition: 4,
  centroidsOffsets: 2,
  values: 1,
  sortOn: 1,
} as const;

/**
 * K-Means with grouped nodes for intra-cluster repulsion.
 * This extends the basic k-means clustering with additional data structures
 * to enable efficient node-to-node repulsion within each cluster.
 */
export class KMeansGroupedGPU {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private gl: WebGL2RenderingContext;

  private nodesCount: number;
  private centroidsCount: number;

  // K-means clustering (reused from base implementation)
  private kMeans: KMeansGPU;

  // Sorting and grouping programs
  private setupSortProgram: WebCLProgram<"closestCentroid", "values" | "sortOn">;
  private offsetProgram: WebCLProgram<"centroidsPosition", "centroidsOffsets">;
  private bitonicSort: BitonicSortGPU;

  constructor(
    gl: WebGL2RenderingContext,
    {
      nodesCount,
      centroidsCount,
      nodesTexture,
    }: { nodesCount: number; centroidsCount?: number; nodesTexture?: WebGLTexture },
  ) {
    this.gl = gl;
    this.nodesCount = nodesCount;
    this.centroidsCount = centroidsCount || Math.sqrt(nodesCount);

    // Initialize base k-means clustering
    this.kMeans = new KMeansGPU(gl, {
      nodesCount,
      centroidsCount: this.centroidsCount,
      nodesTexture,
    });

    // Setup sort program: prepares nodes for sorting by centroid ID
    this.setupSortProgram = new WebCLProgram({
      gl,
      name: "K-means Grouped - Prepare Bitonic sort",
      fragments: this.nodesCount,
      fragmentShaderSource: getKMeansSetupSortFragmentShader({
        nodesCount: this.nodesCount,
        centroidsCount: this.centroidsCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "closestCentroid", attributesPerItem: ATTRIBUTES_PER_ITEM.closestCentroid, items: this.nodesCount },
      ],
      outputTextures: [
        { name: "values", attributesPerItem: ATTRIBUTES_PER_ITEM.values },
        { name: "sortOn", attributesPerItem: ATTRIBUTES_PER_ITEM.sortOn },
      ],
    });

    // Offset program: computes count and offset for each centroid
    this.offsetProgram = new WebCLProgram({
      gl,
      name: "K-means Grouped - Centroid Offsets",
      fragments: this.centroidsCount,
      fragmentShaderSource: getKMeansOffsetFragmentShader({
        centroidsCount: this.centroidsCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        {
          name: "centroidsPosition",
          attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsPosition,
          items: this.centroidsCount,
        },
      ],
      outputTextures: [{ name: "centroidsOffsets", attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsOffsets }],
    });

    // Bitonic sort: sorts nodes by their centroid ID
    this.bitonicSort = new BitonicSortGPU(gl, { valuesCount: nodesCount, attributesPerItem: 1 });

    this.wireTextures(nodesTexture);
    this.initialize();
  }

  /**
   * Public API:
   * ***********
   */
  public initialize() {
    this.kMeans.initialize();
  }

  public wireTextures(nodesTexture?: WebGLTexture) {
    const { kMeans, setupSortProgram, offsetProgram } = this;

    // Wire k-means textures
    kMeans.wireTextures(nodesTexture);

    // Wire sorting textures
    WebCLProgram.wirePrograms({ setupSortProgram, offsetProgram });
  }

  public compute({ steps = 10 }: { steps?: number } = {}) {
    const { kMeans, setupSortProgram, offsetProgram, bitonicSort } = this;

    // Run k-means clustering
    kMeans.compute({ steps });

    // Get the closest centroid for each node from k-means output
    setupSortProgram.dataTexturesIndex.closestCentroid.texture = kMeans.getClosestCentroid();

    // Prepare bitonic sort
    setupSortProgram.activate();
    setupSortProgram.prepare();
    setupSortProgram.compute();

    // Sort nodes by centroid ID
    bitonicSort.setTextures({
      valuesTexture: setupSortProgram.outputTexturesIndex.values.texture,
      sortOnTexture: setupSortProgram.outputTexturesIndex.sortOn.texture,
    });
    bitonicSort.sort();

    // Wire centroids position to offset program
    offsetProgram.dataTexturesIndex.centroidsPosition.texture = kMeans.getCentroidsPosition();

    // Compute offsets for each centroid
    offsetProgram.activate();
    offsetProgram.prepare();
    offsetProgram.compute();
  }

  // Getters for textures needed by ForceAtlas2
  public getCentroidsPosition(): WebGLTexture {
    return this.kMeans.getCentroidsPosition();
  }

  public getCentroidsOffsets(): WebGLTexture {
    return this.offsetProgram.outputTexturesIndex.centroidsOffsets.texture;
  }

  public getNodesInCentroids(): WebGLTexture {
    return this.bitonicSort.getSortedTexture();
  }

  public getClosestCentroid(): WebGLTexture {
    return this.kMeans.getClosestCentroid();
  }
}
