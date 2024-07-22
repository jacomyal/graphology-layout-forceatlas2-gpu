export function getVertexShader() {
  // language=GLSL
  const SHADER = /*glsl*/ `
attribute vec3 a_position;
attribute vec2 a_textureCoord;

varying highp vec2 v_textureCoord;

void main() {
  gl_Position = vec4(a_position, 1.0);
  v_textureCoord = a_textureCoord;
}`;

  return SHADER;
}
