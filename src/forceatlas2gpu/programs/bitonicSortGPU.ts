import { WebCLProgram } from "../../utils/webcl-program";
import { getBitonicSortFragmentShader } from "../shaders/fragment-bitonic-sort";
import { getVertexShader } from "../shaders/vertex-basic";

export * from "../consts";
export * from "../../utils/webgl";

export class BitonicSortGPU {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private gl: WebGL2RenderingContext;
  private valuesCount: number;
  private bitonicProgram: WebCLProgram<"values" | "sortOn", "sortedValue", "pass" | "stage">;

  constructor(gl: WebGL2RenderingContext, { valuesCount }: { valuesCount: number }) {
    this.gl = gl;
    this.valuesCount = valuesCount;

    this.bitonicProgram = new WebCLProgram({
      gl,
      fragments: valuesCount,
      fragmentShaderSource: getBitonicSortFragmentShader({
        valuesCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "values", attributesPerItem: 1 },
        { name: "sortOn", attributesPerItem: 1 },
      ],
      outputTextures: [{ name: "sortedValue", attributesPerItem: 1 }],
    });
  }

  /**
   * Public API:
   * ***********
   */
  public setTextures({ valuesTexture, sortOnTexture }: { valuesTexture: WebGLTexture; sortOnTexture: WebGLTexture }) {
    const { bitonicProgram } = this;

    bitonicProgram.dataTexturesIndex.values.texture = valuesTexture;
    bitonicProgram.dataTexturesIndex.sortOn.texture = sortOnTexture;
  }

  public setData({ values, sortOn }: { values: Float32Array; sortOn: Float32Array }) {
    const { bitonicProgram } = this;

    bitonicProgram.setTextureData("values", values, this.valuesCount);
    bitonicProgram.setTextureData("sortOn", sortOn, this.valuesCount);
  }

  public getSortedValues() {
    return this.bitonicProgram.getOutput("sortedValue");
  }

  public getSortedTexture() {
    return this.bitonicProgram.outputTexturesIndex.sortedValue.texture;
  }

  public async sort() {
    const { valuesCount, bitonicProgram } = this;

    // Activate program:
    bitonicProgram.activate();

    let passesCount = 0;
    const maxStage = Math.floor(Math.log2(valuesCount));
    for (let stage = 0; stage < maxStage; stage++) {
      for (let pass = 0; pass <= stage; pass++) {
        if (passesCount > 0) {
          bitonicProgram.swapTextures("values", "sortedValue");
        }

        bitonicProgram.setUniforms({ pass, stage });
        bitonicProgram.prepare();
        bitonicProgram.compute();

        passesCount++;
      }
    }

    // If an even number of passes have been processed (so an odd number of already done swaps), swap the textures back,
    // to reduce the risk of devs reassigning later the input texture to another reference to the output texture:
    if (!(passesCount % 2)) {
      bitonicProgram.swapTextures("values", "sortedValue");

      // Also redo one last step, that should be useless, just to make sure both textures carry the same data:
      bitonicProgram.prepare();
      bitonicProgram.compute();
    }
  }
}
