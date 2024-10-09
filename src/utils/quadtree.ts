/**
 * The following functions are here for reference, because it is much simpler
 * for me to develop and test TypeScript functions than GLSL functions. Then,
 * these can be transposed to GLSL for use in the shaders.
 *
 * Also, here are the Morton IDs we're discussing in this file:
 * - First, the first level is indexed:
 *   0, 1
 *   2, 3
 * - Then, increments continue to next level:
 *    4,  5,  8,  9
 *    6,  7, 10, 11
 *   12, 13, 16, 17
 *   14, 15, 18, 19
 * - Next level:
 *   20, 21, 24, 25, 36, 37, 40, 41
 *   22, 23, 26, 27, 38, 39, 42, 43
 *   28, 29, 32, 33, 44, 45, 48, 49
 *   30, 31, 34, 35, 46, 47, 50, 51
 *   52, 53, 56, 57, 68, 69, 72, 73
 *   54, 55, 58, 59, 70, 71, 74, 75
 *   60, 61, 64, 65, 76, 77, 80, 81
 *   62, 63, 66, 67, 78, 79, 82, 83
 * - Etc...
 *
 * This allows having contiguous integers to index all our regions. But to use
 * this efficiently enough, we need some utils, to:
 * - Get the depth of a given Morton ID
 * - Get the parent of a given Morton ID
 */

export function getRegionsCount(depth: number): number {
  // At depth 1, we get 4 regions
  // At depth 2, we get 4 ** 2, plus the 4 previous regions: 20
  // At depth 3, we get 4 ** 3, plus the 20 previous regions: 84
  // etc...
  let count = 0;
  for (let i = 0; i < depth; i++) {
    count += 4 ** (i + 1);
  }

  return count;
}
// language=GLSL
export const GLSL_getRegionsCount = /*glsl*/ `
int getRegionsCount(int depth) {
  int count = 0;
  for (int i = 0; i < depth; i++) {
    count = count + int(pow(4.0, float(i) + 1.0));
  }

  return count;
}
`;

export function getMortonIdDepth(id: number): number {
  return Math.floor(Math.log(3 * id + 4) / Math.log(4));
}
// language=GLSL
export const GLSL_getMortonIdDepth = /*glsl*/ `
int getMortonIdDepth(int id) {
  return int(floor(log(float(3 * id + 4)) / log(4.0)));
}
`;

export function getParentMortonId(id: number): number {
  const depth = getMortonIdDepth(id);
  if (depth <= 1) return -1;

  const parentDepth = depth - 1;
  const idAtDepth = id - getRegionsCount(parentDepth);
  const parentIdAtDepth = Math.floor(idAtDepth / 4);
  return parentIdAtDepth + getRegionsCount(parentDepth - 1);
}
// language=GLSL
export const GLSL_getParentMortonId = /*glsl*/ `
int getParentMortonId(int id) {
  int depth = getMortonIdDepth(id);
  if (depth <= 1) return -1;

  int parentDepth = depth - 1;
  int idAtDepth = id - getRegionsCount(parentDepth);
  int parentIdAtDepth = int(floor(float(idAtDepth) / 4.0));
  return parentIdAtDepth + getRegionsCount(parentDepth - 1);
}
`;
