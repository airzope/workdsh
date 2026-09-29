/**
 * PP-OCRv5 pre- and post-processing without OpenCV or a canvas, following
 * PaddleOCR's DB text detection (threshold map, connected regions, minimum-area
 * rectangles, unclip) and CTC text recognition.
 */

/** Decoded pixels in RGBA order. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export type Point = readonly [number, number];
/** Clockwise corners from the top-left one. */
export type Quad = readonly [Point, Point, Point, Point];

export interface DetectionOptions {
  readonly thresh: number;
  readonly boxThresh: number;
  readonly unclipRatio: number;
  /** Longest side fed to the detector. */
  readonly maxSide: number;
}

/** PaddleOCR 3 defaults for PP-OCRv5 text detection. */
export const DETECTION_DEFAULTS: DetectionOptions = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 2, maxSide: 1920 };
export const RECOGNITION_HEIGHT = 48;
const MAX_RECOGNITION_WIDTH = 3200;

/** Channel planes in CHW order, ready for an ONNX tensor. */
export interface Planes {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
}

function sample(image: RgbaImage, x: number, y: number, channel: number): number {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = (px: number, py: number): number => image.data[(py * image.width + px) * 4 + channel]!;
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/**
 * Resize to multiples of 32 and normalize as PaddleOCR does for its BGR input.
 * @param image - Page or picture.
 * @param maxSide - Longest side after resizing.
 * @returns Detector input planes.
 */
export function detectionInput(image: RgbaImage, maxSide = DETECTION_DEFAULTS.maxSide): Planes {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(32, Math.round(image.width * scale / 32) * 32);
  const height = Math.max(32, Math.round(image.height * scale / 32) * 32);
  const mean = [0.406, 0.456, 0.485];
  const std = [0.225, 0.224, 0.229];
  const data = new Float32Array(3 * width * height);
  for (let y = 0; y < height; y++) {
    const sy = (y + 0.5) * image.height / height - 0.5;
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5) * image.width / width - 0.5;
      for (let c = 0; c < 3; c++) data[c * width * height + y * width + x] = (sample(image, sx, sy, 2 - c) / 255 - mean[c]!) / std[c]!;
    }
  }
  return { data, width, height };
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  const upper: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** A rotated rectangle: center, side lengths, and the unit vector along `width`. */
export interface RotatedRect {
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
  readonly ux: number;
  readonly uy: number;
}

/**
 * Smallest rotated rectangle around points, by rotating calipers over their hull.
 * @param points - At least three non-collinear points.
 * @returns The rectangle, or undefined for degenerate input.
 */
export function minAreaRect(points: Point[]): RotatedRect | undefined {
  const hull = convexHull(points);
  if (hull.length < 3) return undefined;
  let best: { area: number, ux: number, uy: number, minU: number, maxU: number, minV: number, maxV: number } | undefined;
  for (let index = 0; index < hull.length; index++) {
    const a = hull[index]!;
    const b = hull[(index + 1) % hull.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best === undefined || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  if (best === undefined) return undefined;
  const cu = (best.minU + best.maxU) / 2;
  const cv = (best.minV + best.maxV) / 2;
  return { cx: cu * best.ux - cv * best.uy, cy: cu * best.uy + cv * best.ux, width: best.maxU - best.minU, height: best.maxV - best.minV, ux: best.ux, uy: best.uy };
}

/**
 * Corners of a rotated rectangle, ordered top-left, top-right, bottom-right, bottom-left.
 * @param rect - Rectangle.
 * @returns The ordered corners.
 */
export function rectCorners(rect: RotatedRect): Quad {
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const points = ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const)
    .map(([a, b]): Point => [rect.cx + a * rect.ux - b * rect.uy, rect.cy + a * rect.uy + b * rect.ux]);
  const bySum = [...points].sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
  const [topRight, bottomLeft] = [bySum[1]!, bySum[2]!].sort((p, q) => (p[1] - p[0]) - (q[1] - q[0]));
  return [bySum[0]!, topRight!, bySum[3]!, bottomLeft!];
}

/**
 * Text regions from a DB probability map, in original image coordinates.
 * Unclipping a rectangle by PaddleOCR's polygon offset grows each side by the
 * same distance, so it is done on the rectangle directly.
 * @param probability - Detector output, one value per map pixel.
 * @param width - Map width.
 * @param height - Map height.
 * @param scaleX - Original width divided by map width.
 * @param scaleY - Original height divided by map height.
 * @param options - Thresholds.
 * @returns Regions sorted in reading order.
 */
export function detectionBoxes(probability: Float32Array, width: number, height: number, scaleX: number, scaleY: number, options: DetectionOptions = DETECTION_DEFAULTS): Quad[] {
  const label = new Int32Array(width * height);
  const boxes: Quad[] = [];
  let region = 0;
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== 0 || probability[start]! <= options.thresh) continue;
    region++;
    label[start] = region;
    stack.push(start);
    const edge: Point[] = [];
    let sum = 0;
    let count = 0;
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      sum += probability[index]!;
      count++;
      let boundary = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) { boundary = true; continue; }
        const next = ny * width + nx;
        if (probability[next]! <= options.thresh) { boundary = true; continue; }
        if (label[next] === 0) { label[next] = region; stack.push(next); }
      }
      if (boundary) edge.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
    }
    if (count < 4 || sum / count < options.boxThresh) continue;
    const rect = minAreaRect(edge);
    if (rect === undefined || Math.min(rect.width, rect.height) < 3) continue;
    const distance = rect.width * rect.height * options.unclipRatio / (2 * (rect.width + rect.height));
    const grown = { ...rect, width: rect.width + 2 * distance, height: rect.height + 2 * distance };
    if (Math.min(grown.width, grown.height) < 5) continue;
    boxes.push(rectCorners(grown).map(([x, y]): Point => [x * scaleX, y * scaleY]) as unknown as Quad);
  }
  return sortReadingOrder(boxes);
}

/**
 * Top-to-bottom, then left-to-right for boxes on the same line, as PaddleOCR sorts them.
 * @param boxes - Regions.
 * @returns A sorted copy.
 */
export function sortReadingOrder(boxes: readonly Quad[]): Quad[] {
  const sorted = [...boxes].sort((a, b) => a[0][1] - b[0][1] || a[0][0] - b[0][0]);
  for (let index = 1; index < sorted.length; index++) {
    for (let at = index; at > 0; at--) {
      const previous = sorted[at - 1]!;
      const current = sorted[at]!;
      if (Math.abs(current[0][1] - previous[0][1]) < 10 && current[0][0] < previous[0][0]) {
        sorted[at - 1] = current;
        sorted[at] = previous;
      } else break;
    }
  }
  return sorted;
}

/**
 * Crop a region upright, resize it to the recognizer height, and normalize it.
 * Regions at least 1.5 times taller than wide are treated as vertical text.
 * @param image - Source pixels.
 * @param box - Region corners.
 * @returns Recognizer input planes.
 */
export function recognitionInput(image: RgbaImage, box: Quad): Planes {
  const [tl, tr, br, bl] = box;
  let width = Math.max(Math.hypot(tr[0] - tl[0], tr[1] - tl[1]), Math.hypot(br[0] - bl[0], br[1] - bl[1]));
  let height = Math.max(Math.hypot(bl[0] - tl[0], bl[1] - tl[1]), Math.hypot(br[0] - tr[0], br[1] - tr[1]));
  let origin: Point = tl;
  let across: Point = [(tr[0] - tl[0]) / width, (tr[1] - tl[1]) / width];
  let down: Point = [(bl[0] - tl[0]) / height, (bl[1] - tl[1]) / height];
  if (height / width >= 1.5) {
    origin = tr;
    across = [(br[0] - tr[0]) / height, (br[1] - tr[1]) / height];
    down = [(tl[0] - tr[0]) / width, (tl[1] - tr[1]) / width];
    [width, height] = [height, width];
  }
  const outHeight = RECOGNITION_HEIGHT;
  const outWidth = Math.max(8, Math.min(MAX_RECOGNITION_WIDTH, Math.ceil(outHeight * width / Math.max(1, height))));
  const data = new Float32Array(3 * outHeight * outWidth);
  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) * height / outHeight;
    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) * width / outWidth;
      const px = origin[0] + u * across[0] + v * down[0];
      const py = origin[1] + u * across[1] + v * down[1];
      for (let c = 0; c < 3; c++) data[c * outHeight * outWidth + y * outWidth + x] = (sample(image, px, py, 2 - c) / 255 - 0.5) / 0.5;
    }
  }
  return { data, width: outWidth, height: outHeight };
}

/**
 * Character table for CTC decoding: blank, the dictionary lines, then space.
 * @param dictionary - Dictionary file content, one character per line.
 * @returns The table.
 */
export function characterTable(dictionary: string): string[] {
  const lines = dictionary.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return ['', ...lines, ' '];
}

/**
 * Greedy CTC decoding: best class per step, collapsing repeats and dropping blanks.
 * @param probabilities - Recognizer output of shape [1, steps, classes].
 * @param steps - Time steps.
 * @param classes - Class count.
 * @param table - Character table.
 * @returns Text and mean confidence of the kept characters.
 */
export function decodeCtc(probabilities: Float32Array, steps: number, classes: number, table: readonly string[]): { text: string, score: number } {
  let text = '';
  let previous = 0;
  let sum = 0;
  let kept = 0;
  for (let step = 0; step < steps; step++) {
    let best = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < classes; index++) {
      const value = probabilities[step * classes + index]!;
      if (value > bestValue) { bestValue = value; best = index; }
    }
    if (best !== 0 && best !== previous) {
      text += table[best] ?? '';
      sum += bestValue;
      kept++;
    }
    previous = best;
  }
  return { text, score: kept === 0 ? 0 : sum / kept };
}

/** One recognized line. */
export interface OcrLine {
  readonly text: string;
  readonly score: number;
  readonly box: Quad;
}

/**
 * Join lines into Markdown paragraphs, breaking where the vertical gap exceeds a line height.
 * @param lines - Lines in reading order.
 * @returns Plain text with blank lines between paragraphs.
 */
export function linesToText(lines: readonly OcrLine[]): string {
  let text = '';
  let previous: OcrLine | undefined;
  for (const line of lines) {
    if (previous !== undefined) {
      const height = Math.max(1, previous.box[3][1] - previous.box[0][1]);
      const gap = line.box[0][1] - previous.box[3][1];
      text += Math.abs(line.box[0][1] - previous.box[0][1]) < height / 2 ? ' ' : gap > height * 0.8 ? '\n\n' : '\n';
    }
    text += line.text;
    previous = line;
  }
  return text;
}
