import { getNextPowerOfTwo, getTextureSize, readTextureData } from "../../utils/webgl";
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
  private name = "K-means GPU (grouped)";

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private gl: WebGL2RenderingContext;

  private nodesCount: number;
  private centroidsCount: number;
  private debug: boolean;

  // K-means clustering (reused from base implementation)
  private kMeans: KMeansGPU;

  // Sorting and grouping programs
  private setupSortProgram: WebCLProgram<"closestCentroid", "values" | "sortOn">;
  private offsetProgram: WebCLProgram<"centroidsPosition", "centroidsOffsets">;
  private bitonicSort: BitonicSortGPU;

  constructor(
    gl: WebGL2RenderingContext,
    { nodesCount, centroidsCount, debug = false }: { nodesCount: number; centroidsCount?: number; debug?: boolean },
  ) {
    this.gl = gl;
    this.nodesCount = nodesCount;
    this.centroidsCount = centroidsCount || Math.sqrt(nodesCount);
    this.debug = debug;

    // BitonicSort requires power-of-2 sized arrays, so we need to extend our node count
    const sortedArraySize = getNextPowerOfTwo(nodesCount);

    // Initialize base k-means clustering
    this.kMeans = new KMeansGPU(gl, {
      nodesCount,
      centroidsCount: this.centroidsCount,
      debug,
    });

    // Setup sort program: prepares nodes for sorting by centroid ID
    this.setupSortProgram = new WebCLProgram({
      gl,
      name: "K-means Grouped - Prepare Bitonic sort",
      fragments: sortedArraySize,
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
  }

  /**
   * Public API:
   * ***********
   */
  public wireTextures(nodesTexture: WebGLTexture) {
    const { kMeans, setupSortProgram, offsetProgram } = this;

    // Wire k-means textures
    kMeans.wireTextures(nodesTexture);

    // Wire sorting textures
    WebCLProgram.wirePrograms({ setupSortProgram, offsetProgram });
  }

  public initialize() {
    const { kMeans } = this;

    // Initialize centroids
    kMeans.initialize();
  }

  public compute({ steps }: { steps: number }) {
    const { kMeans, setupSortProgram, offsetProgram, bitonicSort, debug } = this;

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

    if (debug) {
      this.validate();
    }
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

  /**
   * Debug validation methods:
   * ************************
   */
  public validateCentroidsOffsets(): void {
    const { nodesCount, centroidsCount, name } = this;
    const textureSize = getTextureSize(centroidsCount);
    const totalElements = textureSize * textureSize;
    const offsetsData = readTextureData(this.gl, this.getCentroidsOffsets(), centroidsCount, 2);

    let totalNodes = 0;
    for (let i = 0; i < totalElements; i++) {
      const count = offsetsData[i * 2];
      const offset = offsetsData[i * 2 + 1];

      if (i < centroidsCount) {
        // Valid centroid: check offset data
        if (isNaN(count) || isNaN(offset)) {
          throw new Error(`[${name}] Centroid ${i} has NaN offset data: count=${count}, offset=${offset}`);
        }
        if (count === -1 && offset === -1) {
          throw new Error(`[${name}] Valid centroid ${i} has sentinel values for offsets`);
        }
        if (count < 0 || offset < 0) {
          throw new Error(`[${name}] Centroid ${i} has negative offset data: count=${count}, offset=${offset}`);
        }
        if (offset + count > nodesCount) {
          throw new Error(
            `[${name}] Centroid ${i} has out-of-bounds offset: offset=${offset}, count=${count}, max=${nodesCount}`,
          );
        }

        totalNodes += count;
      } else {
        // Out-of-bounds: should have sentinel values
        if (count !== -1 || offset !== -1) {
          console.warn(
            `[${name}] Out-of-bounds centroid ${i} does not have sentinel offset values: count=${count}, offset=${offset}`,
          );
        }
      }
    }

    if (totalNodes !== nodesCount) {
      throw new Error(`[${name}] Total nodes in centroids (${totalNodes}) does not match expected (${nodesCount})`);
    }
  }

  public validateNodesInCentroids(): void {
    const { nodesCount, name } = this;
    const sortedArraySize = getNextPowerOfTwo(nodesCount);
    const sortedNodesData = readTextureData(this.gl, this.getNodesInCentroids(), sortedArraySize, 1);

    const seenNodes = new Set<number>();
    for (let i = 0; i < nodesCount; i++) {
      const nodeIndex = sortedNodesData[i];

      if (isNaN(nodeIndex)) {
        throw new Error(`[${name}] Sorted position ${i} has NaN node index`);
      }
      if (nodeIndex < 0 || nodeIndex >= nodesCount) {
        throw new Error(
          `[${name}] Sorted position ${i} has invalid node index: ${nodeIndex} (must be 0-${nodesCount - 1})`,
        );
      }
      if (seenNodes.has(nodeIndex)) {
        throw new Error(`[${name}] Node ${nodeIndex} appears multiple times in sorted array`);
      }
      seenNodes.add(nodeIndex);
    }
  }

  public validateSortedArrayConsistency(): void {
    const { nodesCount, centroidsCount, name } = this;
    const sortedNodesData = readTextureData(this.gl, this.getNodesInCentroids(), getNextPowerOfTwo(nodesCount), 1);
    const closestCentroidData = readTextureData(this.gl, this.getClosestCentroid(), nodesCount, 1);
    const offsetsData = readTextureData(this.gl, this.getCentroidsOffsets(), centroidsCount, 2);

    // For each centroid, verify that all nodes in its range have that centroid as their closest
    for (let c = 0; c < centroidsCount; c++) {
      const count = offsetsData[c * 2];
      const offset = offsetsData[c * 2 + 1];

      for (let i = 0; i < count; i++) {
        const sortedArrayIndex = offset + i;
        const nodeIndex = sortedNodesData[sortedArrayIndex];

        if (nodeIndex < 0 || nodeIndex >= nodesCount) {
          throw new Error(
            `[${name}] Centroid ${c}: sorted array position ${sortedArrayIndex} contains invalid node index ${nodeIndex}`,
          );
        }

        const actualCentroid = closestCentroidData[nodeIndex];
        if (actualCentroid !== c) {
          throw new Error(
            `[${name}] Centroid ${c}: sorted array position ${sortedArrayIndex} contains node ${nodeIndex}, but that node's closest centroid is ${actualCentroid}`,
          );
        }
      }
    }
  }

  public validate(): void {
    this.kMeans.validate();
    this.validateCentroidsOffsets();
    this.validateNodesInCentroids();
    this.validateSortedArrayConsistency();
  }

  public getKMeans() {
    if (!this.debug) throw new Error('This method "getKMeans" is only available in debug mode.');
    return this.kMeans;
  }

  public getOffsetProgram() {
    if (!this.debug) throw new Error('This method "getOffsetProgram" is only available in debug mode.');
    return this.offsetProgram;
  }

  public getBitonicSort() {
    if (!this.debug) throw new Error('This method "getBitonicSort" is only available in debug mode.');
    return this.bitonicSort;
  }
}
