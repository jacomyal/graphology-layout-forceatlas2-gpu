export function getVertexShader() {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
in vec2 a_position;

out vec2 v_textureCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_textureCoord = (a_position + vec2(1.0, 1.0)) / 2.0;
}`;

  return SHADER;
}
