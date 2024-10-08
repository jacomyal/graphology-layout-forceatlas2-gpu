import { describe, expect, test } from "vitest";

import { getMortonIdDepth, getParentMortonId, getRegionsCount } from "./quadtree";

describe("QuadTree Morton IDs utils", () => {
  describe("getRegionsCount", () => {
    test("it should work as expected", () => {
      const tests = [
        [0, 0],
        [1, 4],
        [2, 20],
        [3, 84],
        [4, 340],
        [5, 1364],
      ];

      tests.forEach(([input, expectedOutput]) => expect(getRegionsCount(input)).toEqual(expectedOutput));
    });
  });

  describe("getMortonIdDepth", () => {
    test("it should work as expected", () => {
      const tests = [
        [1, 1],
        [2, 1],
        [9, 2],
        [14, 2],
        [19, 2],
        [20, 3],
        [47, 3],
        [79, 3],
        [84, 4],
      ];

      tests.forEach(([input, expectedOutput]) => expect(getMortonIdDepth(input)).toEqual(expectedOutput));
    });
  });

  describe("getParentMortonId", () => {
    test("it should work as expected", () => {
      const tests = [
        [1, -1],
        [2, -1],
        [9, 1],
        [14, 2],
        [19, 3],
        [20, 4],
        [47, 10],
        [79, 18],
        [84, 20],
      ];

      tests.forEach(([input, expectedOutput]) => expect(getParentMortonId(input)).toEqual(expectedOutput));
    });
  });
});
