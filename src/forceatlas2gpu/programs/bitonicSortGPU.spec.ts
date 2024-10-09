import { describe, expect, test } from "vitest";

import { BitonicSortGPU, waitForGPUCompletion } from "./bitonicSortGPU";

function getGL() {
  // Initialize WebGL2 context:
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 is not supported in this browser.");

  // Check for required extension
  const ext = gl.getExtension("EXT_color_buffer_float");
  if (!ext) {
    throw new Error("EXT_color_buffer_float extension not supported");
  }

  return gl;
}

describe("Bitonic Sort GPU Program", () => {
  test("it should properly sort the data", async () => {
    const length = 8;
    const values = new Float32Array(length);
    const sortOn = new Float32Array(length);
    const expectedOutput = [];

    for (let i = 0; i < length; i++) {
      values[i] = i;
      sortOn[i] = (length - i) * 5;
      expectedOutput.push(length - i - 1);
    }

    const gl = getGL();
    const bitonicSort = new BitonicSortGPU(gl, { valuesCount: length });
    bitonicSort.setData({ values, sortOn });
    await bitonicSort.sort();
    await waitForGPUCompletion(gl);

    const outputData = Array.from(bitonicSort.getSortedValues());
    expect(outputData).toEqual(expectedOutput);
  });
});
