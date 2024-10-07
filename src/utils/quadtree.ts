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

export function mortonIdToDepth(id: number): number {
  return Math.floor(Math.log(3 * id + 4) / Math.log(4));
}
