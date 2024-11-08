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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private gl: WebGL2RenderingContext;

  private nodesCount: number;
  private centroidsCount: number;

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
    }: { nodesCount: number; centroidsCount?: number; nodesTexture?: WebGLTexture },
  ) {
    this.gl = gl;
    this.nodesCount = nodesCount;
    this.centroidsCount = centroidsCount || Math.sqrt(nodesCount);

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
        { name: "closestCentroid", attributesPerItem: ATTRIBUTES_PER_ITEM.nodesPosition, items: this.nodesCount },
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
    const { initialPositionsProgram } = this;

    initialPositionsProgram.activate();
    initialPositionsProgram.prepare();
    initialPositionsProgram.compute();
  }

  public wireTextures(nodesTexture?: WebGLTexture) {
    const { initialPositionsProgram, closestCentroidProgram, centroidPositionProgram } = this;

    if (nodesTexture) initialPositionsProgram.dataTexturesIndex.nodesPosition.texture = nodesTexture;
    WebCLProgram.wirePrograms({ initialPositionsProgram, closestCentroidProgram, centroidPositionProgram });
  }

  public compute({ steps = 10 }: { steps?: number } = {}) {
    const { closestCentroidProgram, centroidPositionProgram } = this;

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
  }

  public getCentroidsPosition(): WebGLTexture {
    return this.centroidPositionProgram.outputTexturesIndex.centroidsPosition.texture;
  }
}
