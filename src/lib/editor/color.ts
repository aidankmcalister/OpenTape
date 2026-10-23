export type Hsv = { h: number; s: number; v: number };

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
