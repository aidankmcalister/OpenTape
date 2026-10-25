export type Hsv = { h: number; s: number; v: number };

export type Rgb = [number, number, number];

export function hexToHsv(hex: string, hue = 0): Hsv {
  const [r, g, b] = [1, 3, 5].map(
    (at) => parseInt(hex.slice(at, at + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  let h = hue;
  if (range > 0 && max === r) h = 60 * (((g - b) / range + 6) % 6);
  else if (range > 0 && max === g) h = 60 * ((b - r) / range + 2);
  else if (range > 0) h = 60 * ((r - g) / range + 4);
  return { h, s: max === 0 ? 0 : range / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function isHex(text: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(text);
}

export function planeCss(hue: number): string {
  const pure = hsvToHex({ h: hue, s: 1, v: 1 });
  return `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, ${pure})`;
}

export function rgbOf(hue: string): Rgb {
  const [r, g, b] = hue.split(" ").map(Number);
  return [r, g, b];
}

export function hueColors(hue: Rgb) {
  const track: Rgb = [31, 31, 34];
  return {
    rest: mixRgb(hue, track, 0.18),
    hover: mixRgb(hue, track, 0.3),
    text: mixRgb(hue, [255, 255, 255], 0.65),
    onHue: [13, 13, 15] as Rgb,
  };
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function mixRgb(a: Rgb, b: Rgb, share: number): Rgb {
  const [r, g, bl] = a.map((value, i) => value * share + b[i] * (1 - share));
  return [r, g, bl];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
