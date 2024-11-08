import { afterEach, beforeEach, describe } from "vitest";

import { setupWebGL2Context } from "../../utils/webgl";

interface Test {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}

beforeEach<Test>(async (context) => {
  const { gl, canvas } = setupWebGL2Context();
  context.canvas = canvas;
  context.gl = gl;
});
afterEach<Test>(async ({ canvas }) => {
  canvas.remove();
});

describe.skip("K-means GPU Program", () => {
  // TODO
});
