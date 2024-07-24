export function getTextureSize(itemsCount: number) {
  return Math.ceil(Math.sqrt(itemsCount));
}

export function numberToGLSLFloat(n: number): string {
  return n % 1 === 0 ? n.toFixed(1) : n.toString();
}
