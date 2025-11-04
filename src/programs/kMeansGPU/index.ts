import { getTextureSize, readTextureData } from "../../utils/webgl";
import { WebCLProgram } from "../webCLProgram";
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
  private name = "K-means GPU";

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
    { nodesCount, centroidsCount, debug = false }: { nodesCount: number; centroidsCount?: number; debug?: boolean },
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
  }

  /**
   * Public API:
   * ***********
   */
  public wireTextures(nodesTexture: WebGLTexture) {
    const { initialPositionsProgram, closestCentroidProgram, centroidPositionProgram } = this;

    initialPositionsProgram.dataTexturesIndex.nodesPosition.texture = nodesTexture;
    WebCLProgram.wirePrograms({ initialPositionsProgram, closestCentroidProgram, centroidPositionProgram });
  }

  public initialize() {
    const { initialPositionsProgram } = this;

    initialPositionsProgram.activate();
    initialPositionsProgram.prepare();
    initialPositionsProgram.compute();
  }

  public compute({ steps }: { steps: number }) {
    const { closestCentroidProgram, centroidPositionProgram, debug } = this;

    let remainingSteps = steps;
    while (remainingSteps--) {
      closestCentroidProgram.activate();
      closestCentroidProgram.prepare();
      closestCentroidProgram.compute();

      centroidPositionProgram.activate();
      centroidPositionProgram.prepare();
      centroidPositionProgram.compute();

      if (remainingSteps) {
        centroidPositionProgram.swapTextures("centroidsPosition", "centroidsPosition");
        closestCentroidProgram.dataTexturesIndex.centroidsPosition.texture =
          centroidPositionProgram.outputTexturesIndex.centroidsPosition.texture;
      }
    }

    if (debug) this.validate();
  }

  public getCentroidsPosition(): WebGLTexture {
    return this.centroidPositionProgram.outputTexturesIndex.centroidsPosition.texture;
  }

  public getClosestCentroid(): WebGLTexture {
    return this.closestCentroidProgram.outputTexturesIndex.closestCentroid.texture;
  }

  // Helper methods for testing:
  public getCentroidsPositionData() {
    return Array.from(this.centroidPositionProgram.getOutput("centroidsPosition"));
  }

  public getClosestCentroidData() {
    return Array.from(this.closestCentroidProgram.getOutput("closestCentroid"));
  }

  public setNodesData(nodes: { x: number; y: number; mass?: number }[]): void {
    const { nodesCount, initialPositionsProgram, closestCentroidProgram, centroidPositionProgram } = this;
    const textureSize = getTextureSize(nodesCount);
    const data = new Float32Array(4 * textureSize ** 2);

    nodes.forEach((node, i) => {
      data[i * 4] = node.x;
      data[i * 4 + 1] = node.y;
      data[i * 4 + 2] = node.mass || 1;
      data[i * 4 + 3] = 0;
    });

    initialPositionsProgram.activate();
    initialPositionsProgram.prepare();
    initialPositionsProgram.setTextureData("nodesPosition", data, nodesCount);

    closestCentroidProgram.activate();
    closestCentroidProgram.prepare();
    closestCentroidProgram.setTextureData("nodesPosition", data, nodesCount);

    centroidPositionProgram.activate();
    centroidPositionProgram.prepare();
    centroidPositionProgram.setTextureData("nodesPosition", data, nodesCount);

    // Wire programs together so outputs connect to inputs
    WebCLProgram.wirePrograms({ initialPositionsProgram, closestCentroidProgram, centroidPositionProgram });

    // Initialize centroids by sampling from node positions
    initialPositionsProgram.activate();
    initialPositionsProgram.prepare();
    initialPositionsProgram.compute();
  }

  /**
   * Debug validation methods:
   * ************************
   */
  private validateCentroidsPosition(): void {
    const { centroidsCount, name } = this;
    const textureSize = getTextureSize(centroidsCount);
    const totalElements = textureSize * textureSize;
    const centroidsData = readTextureData(this.gl, this.getCentroidsPosition(), centroidsCount, 4);

    for (let i = 0; i < totalElements; i++) {
      const x = centroidsData[i * 4];
      const y = centroidsData[i * 4 + 1];
      const mass = centroidsData[i * 4 + 2];
      const size = centroidsData[i * 4 + 3];

      if (i < centroidsCount) {
        // Valid centroid: check for reasonable values
        if (isNaN(x) || isNaN(y) || isNaN(mass) || isNaN(size)) {
          throw new Error(`[${name}] Centroid ${i} has NaN values: (${x}, ${y}, mass=${mass}, size=${size})`);
        }
        if (!isFinite(x) || !isFinite(y) || !isFinite(mass) || !isFinite(size)) {
          throw new Error(`[${name}] Centroid ${i} has infinite values: (${x}, ${y}, mass=${mass}, size=${size})`);
        }
        // Check for sentinel values leaking into valid data
        if (x === -1 && y === -1 && mass === -1 && size === -1) {
          throw new Error(`[${name}] Valid centroid ${i} has sentinel values (all -1)`);
        }
      } else {
        // Out-of-bounds: should have sentinel values
        if (x !== -1 || y !== -1 || mass !== -1 || size !== -1) {
          console.warn(
            `[${name}] Out-of-bounds centroid ${i} does not have sentinel values: (${x}, ${y}, mass=${mass}, size=${size})`,
          );
        }
      }
    }
  }

  private validateClosestCentroid(): void {
    const { nodesCount, centroidsCount, name } = this;
    const textureSize = getTextureSize(nodesCount);
    const totalElements = textureSize * textureSize;
    const closestCentroidData = readTextureData(this.gl, this.getClosestCentroid(), nodesCount, 1);

    for (let i = 0; i < totalElements; i++) {
      const centroidID = closestCentroidData[i];

      if (i < nodesCount) {
        // Valid node: check for valid centroid ID
        if (isNaN(centroidID)) {
          throw new Error(`[${name}] Node ${i} has NaN closest centroid`);
        }
        if (centroidID === -1) {
          throw new Error(`[${name}] Valid node ${i} has sentinel value -1 for closest centroid`);
        }
        if (centroidID < 0 || centroidID >= centroidsCount) {
          throw new Error(
            `[${name}] Node ${i} has invalid closest centroid: ${centroidID} (must be 0-${centroidsCount - 1})`,
          );
        }
      } else {
        // Out-of-bounds: should have sentinel value
        if (centroidID !== -1) {
          console.warn(`[${name}] Out-of-bounds node ${i} does not have sentinel value: ${centroidID}`);
        }
      }
    }
  }

  public validate(): void {
    this.validateCentroidsPosition();
    this.validateClosestCentroid();
  }
}
