import { getNextPowerOfTwo, getTextureSize } from "../../utils/webgl";
import { BitonicSortGPU } from "../bitonicSortGPU";
import { KMeansGPU } from "../kMeansGPU";
import { DATA_TEXTURES_FORMATS, WebCLProgram } from "../webCLProgram";
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
  private debug: boolean;

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
      debug = false,
    }: { nodesCount: number; centroidsCount?: number; nodesTexture?: WebGLTexture; debug?: boolean },
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
      nodesTexture,
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
    const { kMeans, setupSortProgram, offsetProgram, bitonicSort, debug } = this;

    // Run k-means clustering
    kMeans.compute({ steps });
    if (debug) {
      this.validateCentroidsPosition("after k-means compute");
      this.validateClosestCentroid("after k-means compute");
    }

    // Get the closest centroid for each node from k-means output
    setupSortProgram.dataTexturesIndex.closestCentroid.texture = kMeans.getClosestCentroid();

    // Prepare bitonic sort
    setupSortProgram.activate();
    setupSortProgram.prepare();
    setupSortProgram.compute();
    if (debug) {
      console.log("[DEBUG] Setup sort program completed");
    }

    // Sort nodes by centroid ID
    bitonicSort.setTextures({
      valuesTexture: setupSortProgram.outputTexturesIndex.values.texture,
      sortOnTexture: setupSortProgram.outputTexturesIndex.sortOn.texture,
    });
    bitonicSort.sort();
    if (debug) {
      this.validateNodesInCentroids("after bitonic sort");
    }

    // Wire centroids position to offset program
    offsetProgram.dataTexturesIndex.centroidsPosition.texture = kMeans.getCentroidsPosition();

    // Compute offsets for each centroid
    offsetProgram.activate();
    offsetProgram.prepare();
    offsetProgram.compute();
    if (debug) {
      this.validateCentroidsOffsets("after offset compute");
      this.validate("end of compute");
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
  private readTextureData(texture: WebGLTexture, items: number, attributesPerItem: number): Float32Array {
    const { gl } = this;
    const textureSize = getTextureSize(items);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      throw new Error("Failed to create framebuffer for reading texture data.");
    }

    const outputArr = new Float32Array(textureSize * textureSize * attributesPerItem);
    gl.readPixels(0, 0, textureSize, textureSize, DATA_TEXTURES_FORMATS[attributesPerItem], gl.FLOAT, outputArr);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);

    return outputArr;
  }

  private validateCentroidsPosition(stage: string): void {
    const { centroidsCount } = this;
    const textureSize = getTextureSize(centroidsCount);
    const totalElements = textureSize * textureSize;
    const centroidsData = this.readTextureData(this.getCentroidsPosition(), centroidsCount, 4);

    for (let i = 0; i < totalElements; i++) {
      const x = centroidsData[i * 4];
      const y = centroidsData[i * 4 + 1];
      const mass = centroidsData[i * 4 + 2];
      const size = centroidsData[i * 4 + 3];

      if (i < centroidsCount) {
        // Valid centroid: check for reasonable values
        if (isNaN(x) || isNaN(y) || isNaN(mass) || isNaN(size)) {
          throw new Error(`[${stage}] Centroid ${i} has NaN values: (${x}, ${y}, mass=${mass}, size=${size})`);
        }
        if (!isFinite(x) || !isFinite(y) || !isFinite(mass) || !isFinite(size)) {
          throw new Error(`[${stage}] Centroid ${i} has infinite values: (${x}, ${y}, mass=${mass}, size=${size})`);
        }
        // Check for sentinel values leaking into valid data
        if (x === -1 && y === -1 && mass === -1 && size === -1) {
          throw new Error(`[${stage}] Valid centroid ${i} has sentinel values (all -1)`);
        }
      } else {
        // Out-of-bounds: should have sentinel values
        if (x !== -1 || y !== -1 || mass !== -1 || size !== -1) {
          console.warn(
            `[${stage}] Out-of-bounds centroid ${i} does not have sentinel values: (${x}, ${y}, mass=${mass}, size=${size})`,
          );
        }
      }
    }
  }

  private validateClosestCentroid(stage: string): void {
    const { nodesCount, centroidsCount } = this;
    const textureSize = getTextureSize(nodesCount);
    const totalElements = textureSize * textureSize;
    const closestCentroidData = this.readTextureData(this.getClosestCentroid(), nodesCount, 1);

    for (let i = 0; i < totalElements; i++) {
      const centroidID = closestCentroidData[i];

      if (i < nodesCount) {
        // Valid node: check for valid centroid ID
        if (isNaN(centroidID)) {
          throw new Error(`[${stage}] Node ${i} has NaN closest centroid`);
        }
        if (centroidID === -1) {
          throw new Error(`[${stage}] Valid node ${i} has sentinel value -1 for closest centroid`);
        }
        if (centroidID < 0 || centroidID >= centroidsCount) {
          throw new Error(
            `[${stage}] Node ${i} has invalid closest centroid: ${centroidID} (must be 0-${centroidsCount - 1})`,
          );
        }
      } else {
        // Out-of-bounds: should have sentinel value
        if (centroidID !== -1) {
          console.warn(`[${stage}] Out-of-bounds node ${i} does not have sentinel value: ${centroidID}`);
        }
      }
    }
  }

  private validateCentroidsOffsets(stage: string): void {
    const { nodesCount, centroidsCount } = this;
    const textureSize = getTextureSize(centroidsCount);
    const totalElements = textureSize * textureSize;
    const offsetsData = this.readTextureData(this.getCentroidsOffsets(), centroidsCount, 2);

    let totalNodes = 0;
    for (let i = 0; i < totalElements; i++) {
      const count = offsetsData[i * 2];
      const offset = offsetsData[i * 2 + 1];

      if (i < centroidsCount) {
        // Valid centroid: check offset data
        if (isNaN(count) || isNaN(offset)) {
          throw new Error(`[${stage}] Centroid ${i} has NaN offset data: count=${count}, offset=${offset}`);
        }
        if (count === -1 && offset === -1) {
          throw new Error(`[${stage}] Valid centroid ${i} has sentinel values for offsets`);
        }
        if (count < 0 || offset < 0) {
          throw new Error(`[${stage}] Centroid ${i} has negative offset data: count=${count}, offset=${offset}`);
        }
        if (offset + count > nodesCount) {
          throw new Error(
            `[${stage}] Centroid ${i} has out-of-bounds offset: offset=${offset}, count=${count}, max=${nodesCount}`,
          );
        }

        totalNodes += count;
      } else {
        // Out-of-bounds: should have sentinel values
        if (count !== -1 || offset !== -1) {
          console.warn(
            `[${stage}] Out-of-bounds centroid ${i} does not have sentinel offset values: count=${count}, offset=${offset}`,
          );
        }
      }
    }

    if (totalNodes !== nodesCount) {
      throw new Error(`[${stage}] Total nodes in centroids (${totalNodes}) does not match expected (${nodesCount})`);
    }
  }

  private validateNodesInCentroids(stage: string): void {
    const { nodesCount } = this;
    const sortedArraySize = getNextPowerOfTwo(nodesCount);
    const sortedNodesData = this.readTextureData(this.getNodesInCentroids(), sortedArraySize, 1);

    const seenNodes = new Set<number>();
    for (let i = 0; i < nodesCount; i++) {
      const nodeIndex = sortedNodesData[i];

      if (isNaN(nodeIndex)) {
        throw new Error(`[${stage}] Sorted position ${i} has NaN node index`);
      }
      if (nodeIndex < 0 || nodeIndex >= nodesCount) {
        throw new Error(
          `[${stage}] Sorted position ${i} has invalid node index: ${nodeIndex} (must be 0-${nodesCount - 1})`,
        );
      }
      if (seenNodes.has(nodeIndex)) {
        throw new Error(`[${stage}] Node ${nodeIndex} appears multiple times in sorted array`);
      }
      seenNodes.add(nodeIndex);
    }
  }

  private validateSortedArrayConsistency(stage: string): void {
    const { nodesCount, centroidsCount } = this;
    const sortedNodesData = this.readTextureData(
      this.getNodesInCentroids(),
      getNextPowerOfTwo(nodesCount),
      1,
    );
    const closestCentroidData = this.readTextureData(this.getClosestCentroid(), nodesCount, 1);
    const offsetsData = this.readTextureData(this.getCentroidsOffsets(), centroidsCount, 2);
    const centroidsData = this.readTextureData(this.getCentroidsPosition(), centroidsCount, 4);

    // For each centroid, verify that all nodes in its range have that centroid as their closest
    for (let c = 0; c < centroidsCount; c++) {
      const count = offsetsData[c * 2];
      const offset = offsetsData[c * 2 + 1];
      const centroidX = centroidsData[c * 4];
      const centroidY = centroidsData[c * 4 + 1];

      // Only log first few centroids to avoid spam
      if (c < 3) {
        console.log(
          `[DEBUG] Centroid ${c}: position=(${centroidX.toFixed(2)}, ${centroidY.toFixed(2)}), offset=${offset}, count=${count}`,
        );
      }

      for (let i = 0; i < count; i++) {
        const sortedArrayIndex = offset + i;
        const nodeIndex = sortedNodesData[sortedArrayIndex];

        if (nodeIndex < 0 || nodeIndex >= nodesCount) {
          throw new Error(
            `[${stage}] Centroid ${c}: sorted array position ${sortedArrayIndex} contains invalid node index ${nodeIndex}`,
          );
        }

        const actualCentroid = closestCentroidData[nodeIndex];
        if (actualCentroid !== c) {
          throw new Error(
            `[${stage}] Centroid ${c}: sorted array position ${sortedArrayIndex} contains node ${nodeIndex}, but that node's closest centroid is ${actualCentroid}`,
          );
        }

        // Log first few nodes in first centroid for debugging
        if (c === 0 && i < 5) {
          console.log(
            `[DEBUG]   - Node ${nodeIndex} (sorted position ${sortedArrayIndex}): closest centroid = ${actualCentroid}`,
          );
        }
      }
    }
  }

  private debugNodeRepulsion(nodeIndex: number, nodesPositionTexture: WebGLTexture): void {
    const { nodesCount, centroidsCount } = this;
    const sortedNodesData = this.readTextureData(
      this.getNodesInCentroids(),
      getNextPowerOfTwo(nodesCount),
      1,
    );
    const closestCentroidData = this.readTextureData(this.getClosestCentroid(), nodesCount, 1);
    const offsetsData = this.readTextureData(this.getCentroidsOffsets(), centroidsCount, 2);
    const nodesPositionData = this.readTextureData(nodesPositionTexture, nodesCount, 4);

    const nodeCentroid = closestCentroidData[nodeIndex];
    const centroidCount = offsetsData[nodeCentroid * 2];
    const centroidOffset = offsetsData[nodeCentroid * 2 + 1];

    const nodeX = nodesPositionData[nodeIndex * 4];
    const nodeY = nodesPositionData[nodeIndex * 4 + 1];

    console.log(
      `[DEBUG] Node ${nodeIndex}: position=(${nodeX.toFixed(2)}, ${nodeY.toFixed(2)}), centroid=${nodeCentroid}`,
    );
    console.log(`[DEBUG]   Centroid ${nodeCentroid} has ${centroidCount} nodes starting at offset ${centroidOffset}`);

    // Check first 5 neighbors
    let sameNodeCount = 0;
    for (let i = 0; i < Math.min(5, centroidCount); i++) {
      const sortedIdx = centroidOffset + i;
      const otherNodeIdx = sortedNodesData[sortedIdx];
      const otherX = nodesPositionData[otherNodeIdx * 4];
      const otherY = nodesPositionData[otherNodeIdx * 4 + 1];

      if (otherNodeIdx === nodeIndex) {
        sameNodeCount++;
        console.log(`[DEBUG]     ${i}: Node ${otherNodeIdx} (SELF) at (${otherX.toFixed(2)}, ${otherY.toFixed(2)})`);
      } else {
        const dx = nodeX - otherX;
        const dy = nodeY - otherY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        console.log(
          `[DEBUG]     ${i}: Node ${otherNodeIdx} at (${otherX.toFixed(2)}, ${otherY.toFixed(2)}), distance=${dist.toFixed(2)}`,
        );
      }
    }

    if (sameNodeCount > 1) {
      console.warn(`[DEBUG] WARNING: Node ${nodeIndex} appears ${sameNodeCount} times in its centroid's sorted array!`);
    }
  }

  public validate(stage: string): void {
    console.log(`[DEBUG] Validating k-means-grouped state at stage: ${stage}`);
    this.validateCentroidsPosition(stage);
    this.validateClosestCentroid(stage);
    this.validateCentroidsOffsets(stage);
    this.validateNodesInCentroids(stage);
    this.validateSortedArrayConsistency(stage);
    console.log(`[DEBUG] ✓ All validations passed for stage: ${stage}`);
  }

  public debugState(nodesPositionTexture: WebGLTexture): void {
    console.log(`[DEBUG] === Debugging k-means-grouped state ===`);
    // Debug nodes 0, 1, and 2
    for (let i = 0; i < 3; i++) {
      this.debugNodeRepulsion(i, nodesPositionTexture);
    }
  }
}
