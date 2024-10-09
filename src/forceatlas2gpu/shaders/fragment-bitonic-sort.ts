import { GLSL_getIndex, GLSL_getValueInTexture, getTextureSize, numberToGLSLFloat } from "../../utils/webgl";

/**
 * This shader is used to sort the values from valuesTexture, based on the
 * values in sortOnTexture, using the Bitonic Sort.
 */
export function getBitonicSortFragmentShader({ valuesCount }: { valuesCount: number }) {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
precision highp float;

#define TEXTURE_SIZE ${numberToGLSLFloat(getTextureSize(valuesCount))}
#define VALUES_COUNT ${numberToGLSLFloat(valuesCount)}

uniform sampler2D u_valuesTexture;
uniform sampler2D u_sortOnTexture;
  
uniform float u_stage;
uniform float u_pass;
in vec2 v_textureCoord;

// Output
layout(location = 0) out vec4 sortedValue;

// Additional helpers:
${GLSL_getValueInTexture}
${GLSL_getIndex}

void main() {
  float index = getIndex(v_textureCoord, TEXTURE_SIZE);
  if (index >= VALUES_COUNT) return;

  int p = int(u_stage);
  int q = int(u_pass);
  int i = int(index);

  // Calculate the direction of the comparison (up or down)
  bool up = ((i >> p) & 2) == 0;

  // Calculate the offset for the partner comparison
  int d = 1 << (p - q);

  // Fetch the values at i, i + d and i - d
  float value = getValueInTexture(u_valuesTexture, index, TEXTURE_SIZE).x;
  float valueUp = getValueInTexture(u_valuesTexture, index + float(d), TEXTURE_SIZE).x;
  float valueDown = getValueInTexture(u_valuesTexture, index - float(d), TEXTURE_SIZE).x;

  // Fetch the values *to sort on* at i, i + d and i - d
  float key = getValueInTexture(u_sortOnTexture, value, TEXTURE_SIZE).x;
  float keyUp = getValueInTexture(u_sortOnTexture, valueUp, TEXTURE_SIZE).x;
  float keyDown = getValueInTexture(u_sortOnTexture, valueDown, TEXTURE_SIZE).x;

  if ((i & d) == 0 && (key > keyUp) == up) {
    sortedValue.x = valueUp;
  } else if ((i & d) == d && (keyDown > key) == up) {
    sortedValue.x = valueDown;
  } else {
    sortedValue.x = value;
  }
}`;

  return SHADER;
}
