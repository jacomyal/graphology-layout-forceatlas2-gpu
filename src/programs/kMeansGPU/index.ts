import { getTextureSize } from "../../utils/webgl";
import { DATA_TEXTURES_FORMATS, WebCLProgram } from "../webCLProgram";
import { getVertexShader } from "../webCLProgram/vertex";
import { getCentroidPositionFragmentShader } from "./fragment-centroid-position";
import { getClosestCentroidFragmentShader } from "./fragment-closest-centroid";
import { getCentroidInitialPositionFragmentShader } from "./fragment-initial-centroid-positions";

const ATTRIBUTES_PER_ITEM = {
  nodesPosition: 4,
  centroidsPosition: 4,
  closestCentroid: 1,
} as const;

export class KMeansGPU {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private gl: WebGL2RenderingContext;

  private nodesCount: number;
  private centroidsCount: number;
  private debug: boolean;

  private initialPositionsProgram: WebCLProgram<"nodesPosition", "centroidsPosition">;
  private closestCentroidProgram: WebCLProgram<"nodesPosition" | "centroidsPosition", "closestCentroid">;
  private centroidPositionProgram: WebCLProgram<
    "nodesPosition" | "centroidsPosition" | "closestCentroid",
    "centroidsPosition"
  >;

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

    this.initialPositionsProgram = new WebCLProgram({
      gl,
      name: "K-means - initial centroids position",
      fragments: this.centroidsCount,
      fragmentShaderSource: getCentroidInitialPositionFragmentShader({
        nodesCount: this.nodesCount,
        centroidsCount: this.centroidsCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: this.nodesCount },
      ],
      outputTextures: [{ name: "centroidsPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsPosition }],
    });
    this.closestCentroidProgram = new WebCLProgram({
      gl,
      name: "K-means - closest centroid",
      fragments: this.nodesCount,
      fragmentShaderSource: getClosestCentroidFragmentShader({
        nodesCount: this.nodesCount,
        centroidsCount: this.centroidsCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: this.nodesCount },
        {
          name: "centroidsPosition",
          attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsPosition,
          items: this.centroidsCount,
        },
      ],
      outputTextures: [
        {
          name: "closestCentroid",
          attributesPerItem: ATTRIBUTES_PER_ITEM.closestCentroid,
        },
      ],
    });
    this.centroidPositionProgram = new WebCLProgram({
      gl,
      name: "K-means - centroid position",
      fragments: this.centroidsCount,
      fragmentShaderSource: getCentroidPositionFragmentShader({
        nodesCount: this.nodesCount,
        centroidsCount: this.centroidsCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "nodesPosition", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: this.nodesCount },
        { name: "closestCentroid", attributesPerItem: ATTRIBUTES_PER_ITEM.closestCentroid, items: this.nodesCount },
        {
          name: "centroidsPosition",
          attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsPosition,
          items: this.centroidsCount,
        },
      ],
      outputTextures: [
        {
          name: "centroidsPosition",
          attributesPerItem: ATTRIBUTES_PER_ITEM.centroidsPosition,
        },
      ],
    });

    this.wireTextures(nodesTexture);
    this.initialize();
  }

  /**
   * Public API:
   * ***********
   */
  public initialize() {
    const { initialPositionsProgram, debug } = this;

    initialPositionsProgram.activate();
    initialPositionsProgram.prepare();
    initialPositionsProgram.compute();

    if (debug) {
      console.log("[DEBUG] K-means initialization:");
      const centroidsData = this.getCentroidsPositionData();
      for (let i = 0; i < Math.min(3, this.centroidsCount); i++) {
        const x = centroidsData[i * 4];
        const y = centroidsData[i * 4 + 1];
        console.log(`  Centroid ${i}: initial position = (${x.toFixed(2)}, ${y.toFixed(2)})`);
      }

      // Check if all centroids are at the same position
      const allSame = centroidsData[0] === centroidsData[4] && centroidsData[1] === centroidsData[5];
      if (allSame) {
        console.warn("[DEBUG] WARNING: All centroids initialized to same position!");
      }

      this.validateCentroidsPosition("after initialization");
    }
  }

  public wireTextures(nodesTexture?: WebGLTexture) {
    const { initialPositionsProgram, closestCentroidProgram, centroidPositionProgram } = this;

    if (nodesTexture) initialPositionsProgram.dataTexturesIndex.nodesPosition.texture = nodesTexture;
    WebCLProgram.wirePrograms({ initialPositionsProgram, closestCentroidProgram, centroidPositionProgram });
  }

  public compute({ steps = 10 }: { steps?: number } = {}) {
    const { closestCentroidProgram, centroidPositionProgram, debug } = this;

    let remainingSteps = steps;
    while (remainingSteps--) {
      closestCentroidProgram.activate();
      closestCentroidProgram.prepare();
      closestCentroidProgram.compute();

      if (debug && remainingSteps === steps - 1) {
        // Only log on first iteration to avoid spam
        const assignments = this.getClosestCentroidData();
        const counts = new Array(this.centroidsCount).fill(0);
        for (let i = 0; i < this.nodesCount; i++) {
          counts[assignments[i]]++;
        }
        console.log(`[DEBUG] After closestCentroid compute: distribution = ${counts.slice(0, Math.min(5, this.centroidsCount)).join(", ")}`);

        this.validateClosestCentroid("after closestCentroidProgram compute");
      }

      centroidPositionProgram.activate();
      centroidPositionProgram.prepare();
      centroidPositionProgram.compute();

      if (debug && remainingSteps === steps - 1) {
        this.validateCentroidsPosition("after centroidPositionProgram compute");
      }

      if (remainingSteps) {
        centroidPositionProgram.swapTextures("centroidsPosition", "centroidsPosition");
        closestCentroidProgram.dataTexturesIndex.centroidsPosition.texture =
          centroidPositionProgram.outputTexturesIndex.centroidsPosition.texture;
      }
    }
  }

  public getCentroidsPosition(): WebGLTexture {
    return this.centroidPositionProgram.outputTexturesIndex.centroidsPosition.texture;
  }

  public getClosestCentroid(): WebGLTexture {
    return this.closestCentroidProgram.outputTexturesIndex.closestCentroid.texture;
  }

  // Helper methods for testing:
  public getCentroidsPositionData(): Float32Array {
    return this.centroidPositionProgram.getOutput("centroidsPosition");
  }

  public getClosestCentroidData(): Float32Array {
    return this.closestCentroidProgram.getOutput("closestCentroid");
  }

  public setNodesData(nodes: { x: number; y: number; mass?: number }[]): void {
    const { nodesCount } = this;
    const textureSize = getTextureSize(nodesCount);
    const data = new Float32Array(4 * textureSize ** 2);

    nodes.forEach((node, i) => {
      data[i * 4] = node.x;
      data[i * 4 + 1] = node.y;
      data[i * 4 + 2] = node.mass || 1;
      data[i * 4 + 3] = 0;
    });

    this.initialPositionsProgram.activate();
    this.initialPositionsProgram.prepare();
    this.initialPositionsProgram.setTextureData("nodesPosition", data, nodesCount);

    this.closestCentroidProgram.activate();
    this.closestCentroidProgram.prepare();
    this.closestCentroidProgram.setTextureData("nodesPosition", data, nodesCount);

    this.centroidPositionProgram.activate();
    this.centroidPositionProgram.prepare();
    this.centroidPositionProgram.setTextureData("nodesPosition", data, nodesCount);
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

  public validate(stage: string): void {
    console.log(`[DEBUG] Validating k-means state at stage: ${stage}`);
    this.validateCentroidsPosition(stage);
    this.validateClosestCentroid(stage);
    console.log(`[DEBUG] ✓ All validations passed for stage: ${stage}`);
  }
}
