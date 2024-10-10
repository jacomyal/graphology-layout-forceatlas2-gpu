import { WebCLProgram } from "../../utils/webcl-program";
import { getTextureSize } from "../../utils/webgl";
import { getBitonicSortFragmentShader } from "../shaders/fragment-bitonic-sort";
import { getVertexShader } from "../shaders/vertex-basic";

export class BitonicSortGPU {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private gl: WebGL2RenderingContext;
  private valuesCount: number;
  private extendedValuesCount: number;
  private textureSize: number;
  private bitonicProgram: WebCLProgram<"values" | "sortOn", "sortedValue", "pass" | "stage">;

  constructor(gl: WebGL2RenderingContext, { valuesCount }: { valuesCount: number }) {
    this.gl = gl;
    this.valuesCount = valuesCount;
    this.extendedValuesCount = 2 ** Math.ceil(Math.log2(valuesCount));
    this.textureSize = getTextureSize(this.extendedValuesCount);

    this.bitonicProgram = new WebCLProgram({
      gl,
      fragments: this.extendedValuesCount,
      fragmentShaderSource: getBitonicSortFragmentShader({
        length: this.extendedValuesCount,
      }),
      vertexShaderSource: getVertexShader(),
      dataTextures: [
        { name: "values", attributesPerItem: 1, items: valuesCount },
        { name: "sortOn", attributesPerItem: 1, items: valuesCount },
      ],
      outputTextures: [{ name: "sortedValue", attributesPerItem: 1 }],
    });
  }

  /**
   * Public API:
   * ***********
   */
  public async sort() {
    const { extendedValuesCount, bitonicProgram } = this;

    // Activate program:
    bitonicProgram.activate();

    let passesCount = 0;
    const maxStage = Math.log2(extendedValuesCount);
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

  // These methods are for the WebGL pipelines:
  public setTextures({ valuesTexture, sortOnTexture }: { valuesTexture: WebGLTexture; sortOnTexture: WebGLTexture }) {
    const { bitonicProgram } = this;

    bitonicProgram.dataTexturesIndex.values.texture = valuesTexture;
    bitonicProgram.dataTexturesIndex.sortOn.texture = sortOnTexture;
  }
  public getSortedTexture() {
    return this.bitonicProgram.outputTexturesIndex.sortedValue.texture;
  }

  // These methods are for using the bitonic sort directly (and for testing):
  public setData(sortOn: number[], tooHighValue: number) {
    const { bitonicProgram, valuesCount, extendedValuesCount, textureSize } = this;

    const valuesByteArray = new Float32Array(textureSize ** 2);
    const sortOnByteArray = new Float32Array(textureSize ** 2);

    for (let i = 0; i < extendedValuesCount; i++) {
      valuesByteArray[i] = i;
      sortOnByteArray[i] = i < valuesCount ? sortOn[i] : tooHighValue;
    }

    bitonicProgram.setTextureData("values", valuesByteArray, this.extendedValuesCount);
    bitonicProgram.setTextureData("sortOn", sortOnByteArray, this.extendedValuesCount);
  }
  public getSortedValues() {
    return Array.from(this.bitonicProgram.getOutput("sortedValue")).slice(0, this.valuesCount);
  }
}
