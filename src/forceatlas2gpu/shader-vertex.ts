export function getVertexShader() {
  // language=GLSL
  const SHADER = /*glsl*/ `#version 300 es
in vec2 a_position;
in vec2 a_textureCoord;

out vec2 v_textureCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_textureCoord = a_textureCoord;
}`;

  return SHADER;
}
