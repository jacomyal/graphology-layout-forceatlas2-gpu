import { range, shuffle, sortBy } from "lodash";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { setupWebGL2Context } from "../../utils/webgl";
import { BitonicSortGPU } from "./index";

interface Test {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}

interface Options {
  shuffle: boolean;
  attributesPerItem: number;
}

const DEFAULT_OPTIONS: Options = {
  shuffle: false,
  attributesPerItem: 1,
};

function getArrays(length: number, doShuffle?: boolean) {
  let sortOn: number[] = [];
  let expectedOutput: number[] = [];

  for (let i = 0; i < length; i++) {
    sortOn.push((length - i) * 5);
    expectedOutput.push(length - i - 1);
  }

  if (doShuffle) {
    sortOn = shuffle(sortOn);
    expectedOutput = sortBy(expectedOutput, (index) => sortOn[index]);
  }

  return { sortOn, expectedOutput };
}

beforeEach<Test>(async (context) => {
  const { gl, canvas } = setupWebGL2Context();
  context.canvas = canvas;
  context.gl = gl;
});
afterEach<Test>(async ({ canvas }) => {
  canvas.remove();
});

describe("Bitonic Sort GPU Program", () => {
  type TestSpec = [string, number] | [string, number, Partial<Options>];
  const tests: TestSpec[] = [
    ["it should properly sort the data, with a power of 4 (ideal case)", 16],
    ["it should properly sort the data, with a perfect square (ideal case for the GPU)", 25],
    ["it should properly sort the data, with a power of 2 (ideal case for algorithm)", 32],
    ["it should properly sort the data, with an arbitrary number of items (non-ideal case)", 30],
    ["it should properly sort the data, with an arbitrary larger number of items (non-ideal case)", 1000],

    ...range(10, 30).map(
      (i) =>
        [`it should properly sort the data, with an array of ${i} shuffled items`, i, { shuffle: true }] as TestSpec,
    ),

    ...range(2, 3).map(
      (i) => [`it should work properly with an attributesPerItem of ${i}`, 16, { attributesPerItem: i }] as TestSpec,
    ),
  ];

  tests.forEach(([message, count, opts]) => {
    test<Test>(message, async ({ gl }) => {
      const options: Options = { ...DEFAULT_OPTIONS, ...(opts || {}) };
      const length = count;

      const { sortOn, expectedOutput } = getArrays(length, options.shuffle);
      const bitonicSort = new BitonicSortGPU(gl, { valuesCount: length, attributesPerItem: options.attributesPerItem });

      bitonicSort.setData(sortOn, Math.max(...sortOn) * 2);
      await bitonicSort.sort();

      expect(bitonicSort.getSortedValues()).toEqual(expectedOutput);
    });
  });
});
