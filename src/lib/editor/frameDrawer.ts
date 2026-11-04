const VERTEX = `#version 300 es
in vec2 corner;
out vec2 at;
void main() {
  at = vec2(corner.x, 1.0 - corner.y);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D picture;
in vec2 at;
out vec4 color;
void main() {
  color = texture(picture, at);
}`;

type DrawFrame = (frame: VideoFrame) => void;
const drawers = new WeakMap<HTMLCanvasElement, DrawFrame>();

// Draws video frames through WebGL, so WebKit converts them on the GPU instead
// of reading each 4K frame back on the CPU the way a 2D canvas does. Falls back
// to a 2D canvas where WebGL 2 is missing.
export function frameDrawer(canvas: HTMLCanvasElement): DrawFrame | null {
  const known = drawers.get(canvas);
  if (known) return known;
  const drawer = webglDrawer(canvas) ?? flatDrawer(canvas);
  if (drawer) drawers.set(canvas, drawer);
  return drawer;
}

function flatDrawer(canvas: HTMLCanvasElement): DrawFrame | null {
  const context = canvas.getContext("2d");
  return (
    context &&
    ((frame) => context.drawImage(frame, 0, 0, canvas.width, canvas.height))
  );
}

function webglDrawer(canvas: HTMLCanvasElement): DrawFrame | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const corner = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return (frame: VideoFrame) => {
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}
