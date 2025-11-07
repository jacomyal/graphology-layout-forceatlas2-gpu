import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DATA_TEXTURES_FORMATS,
  DATA_TEXTURES_LEVELS,
  getTextureSize,
  readTextureData,
  setupWebGL2Context,
  waitForGPUCompletion,
} from "./webgl";

interface Test {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}

describe("setupWebGL2Context", () => {
  test("should create canvas and WebGL2 context", () => {
    const { canvas, gl } = setupWebGL2Context();

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(gl).toBeInstanceOf(WebGL2RenderingContext);

    canvas.remove();
  });

  test("should create independent contexts on multiple calls", () => {
    const ctx1 = setupWebGL2Context();
    const ctx2 = setupWebGL2Context();

    expect(ctx1.canvas).not.toBe(ctx2.canvas);
    expect(ctx1.gl).not.toBe(ctx2.gl);

    ctx1.canvas.remove();
    ctx2.canvas.remove();
  });
});

beforeEach<Test>(async (context) => {
  const { gl, canvas } = setupWebGL2Context();
  context.canvas = canvas;
  context.gl = gl;
});
afterEach<Test>(async ({ canvas }) => {
  canvas.remove();
});

describe("readTextureData", () => {
  const itemTests = [
    { items: 1, attributesPerItem: 1 },
    { items: 10, attributesPerItem: 1 },
    { items: 100, attributesPerItem: 1 },
    { items: 1000, attributesPerItem: 1 },
  ];

  itemTests.forEach(({ items, attributesPerItem }) => {
    test<Test>(`should read texture data correctly for ${items} items`, ({ gl }) => {
      const textureSize = getTextureSize(items);
      const expectedSize = textureSize * textureSize * attributesPerItem;

      // Create and populate a texture
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        DATA_TEXTURES_LEVELS[attributesPerItem],
        textureSize,
        textureSize,
        0,
        DATA_TEXTURES_FORMATS[attributesPerItem],
        gl.FLOAT,
        null,
      );

      const result = readTextureData(gl, texture!, items, attributesPerItem);

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(expectedSize);

      gl.deleteTexture(texture);
    });
  });

  // Note: We skip attributesPerItem=3 because RGB32F is not renderable in WebGL2
  // (3-component float textures cannot be used as framebuffer attachments)
  [1, 2, 4].forEach((attributesPerItem) => {
    test<Test>(`should handle attributesPerItem=${attributesPerItem} correctly`, ({ gl }) => {
      const items = 10;
      const textureSize = getTextureSize(items);
      const expectedSize = textureSize * textureSize * attributesPerItem;

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        DATA_TEXTURES_LEVELS[attributesPerItem],
        textureSize,
        textureSize,
        0,
        DATA_TEXTURES_FORMATS[attributesPerItem],
        gl.FLOAT,
        null,
      );

      const result = readTextureData(gl, texture!, items, attributesPerItem);

      expect(result.length).toBe(expectedSize);

      gl.deleteTexture(texture);
    });
  });

  test<Test>("should read back data correctly", ({ gl }) => {
    const items = 10;
    const attributesPerItem = 4;
    const textureSize = getTextureSize(items);

    // Create test data
    const inputData = new Float32Array(textureSize * textureSize * attributesPerItem);
    for (let i = 0; i < inputData.length; i++) {
      inputData[i] = i * 0.5;
    }

    // Create and populate texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      DATA_TEXTURES_LEVELS[attributesPerItem],
      textureSize,
      textureSize,
      0,
      DATA_TEXTURES_FORMATS[attributesPerItem],
      gl.FLOAT,
      inputData,
    );

    // Read back data
    const result = readTextureData(gl, texture!, items, attributesPerItem);

    // Verify data matches
    expect(result).toEqual(inputData);

    gl.deleteTexture(texture);
  });

  test<Test>("should throw error for invalid texture", ({ gl }) => {
    // Create an invalid texture (not properly initialized)
    const invalidTexture = {} as WebGLTexture;

    expect(() => readTextureData(gl, invalidTexture, 10, 1)).toThrow();
  });
});

describe("waitForGPUCompletion", () => {
  test<Test>("should resolve after GPU operations complete", async ({ gl }) => {
    // Create a simple GPU operation
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    await expect(waitForGPUCompletion(gl)).resolves.toBeUndefined();

    gl.deleteTexture(texture);
  });

  test<Test>("should actually wait (not return immediately)", async ({ gl }) => {
    let completed = false;

    // Create some GPU work
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 100, 100, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const promise = waitForGPUCompletion(gl).then(() => {
      completed = true;
    });

    // Should not be completed immediately
    expect(completed).toBe(false);

    await promise;

    // Should be completed after await
    expect(completed).toBe(true);

    gl.deleteTexture(texture);
  });

  test<Test>("should work with actual GPU computation", async ({ gl }) => {
    // Create a simple computation using a framebuffer and texture
    const size = 64;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size, size, 0, gl.RED, gl.FLOAT, null);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    // Clear the framebuffer (GPU work)
    gl.clearColor(1.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Wait for GPU to complete
    await waitForGPUCompletion(gl);

    // Verify we can read the result immediately after waiting
    const data = new Float32Array(size * size);
    gl.readPixels(0, 0, size, size, gl.RED, gl.FLOAT, data);

    // Verify the clear operation worked across multiple pixels
    expect(data[0]).toBe(1.0);
    expect(data[1]).toBe(1.0);
    expect(data[size]).toBe(1.0); // First pixel of second row
    expect(data[size + 1]).toBe(1.0); // Second pixel of second row
    expect(data[data.length - 1]).toBe(1.0); // Last pixel

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
  });
});
