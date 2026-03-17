import { PNG } from 'pngjs';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface PathPoint {
  x: number;
  y: number;
  timestamp?: number;
  relativeTimeMs?: number;
}

export interface VisualizationOptions {
  style: VisualizationStyle;
  showTimestamps: boolean;
  showDirectionIndicators: boolean;
  pathColor: string;
  pathWidth: number;
  timestampFontSize: number;
  timestampColor: string;
  dotRadius: number;
  heatmapOpacity: number;
  backgroundImage?: Buffer;
}

export type VisualizationStyle = 'path' | 'heatmap' | 'dots';

export interface ActionFrame {
  frameIndex: number;
  timestamp: string;
  relativeTimeMs: number;
  durationMs?: number;
  type: string;
  action: string;
  details: Record<string, any>;
  visualContext?: VisualContext;
}

export interface VisualContext {
  mouseX?: number;
  mouseY?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollPosition?: number;
}

const DEFAULT_OPTIONS: VisualizationOptions = {
  style: 'path',
  showTimestamps: true,
  showDirectionIndicators: true,
  pathColor: '#FF4444',
  pathWidth: 3,
  timestampFontSize: 12,
  timestampColor: '#FFFFFF',
  dotRadius: 4,
  heatmapOpacity: 0.6,
};

export class GhostVisualizer {
  private options: VisualizationOptions;
  private canvas: PNG | null = null;
  private width: number = 0;
  private height: number = 0;

  constructor(options: Partial<VisualizationOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  setStyle(style: VisualizationStyle): void {
    this.options.style = style;
  }

  setOptions(options: Partial<VisualizationOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result || !result[1] || !result[2] || !result[3]) {
      return { r: 255, g: 68, b: 68 };
    }
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  }

  private extractPathFromActions(actions: ActionFrame[]): PathPoint[] {
    const points: PathPoint[] = [];

    for (const action of actions) {
      if (action.visualContext?.mouseX !== undefined && action.visualContext?.mouseY !== undefined) {
        points.push({
          x: action.visualContext.mouseX,
          y: action.visualContext.mouseY,
          timestamp: new Date(action.timestamp).getTime(),
          relativeTimeMs: action.relativeTimeMs,
        });
      }
    }

    return points;
  }

  private initCanvas(imageBuffer?: Buffer): void {
    if (imageBuffer) {
      this.canvas = PNG.sync.read(imageBuffer);
      this.width = this.canvas.width;
      this.height = this.canvas.height;
    } else {
      this.width = 1920;
      this.height = 1080;
      this.canvas = new PNG({ width: this.width, height: this.height });
    }
  }

  private drawPixel(x: number, y: number, r: number, g: number, b: number, a: number = 255): void {
    if (!this.canvas || !this.canvas.data || x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    
    const idx = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    const alpha = a / 255;
    const data = this.canvas.data as Uint8Array;
    
    data[idx] = Math.round((data[idx] ?? 0) * (1 - alpha) + r * alpha);
    data[idx + 1] = Math.round((data[idx + 1] ?? 0) * (1 - alpha) + g * alpha);
    data[idx + 2] = Math.round((data[idx + 2] ?? 0) * (1 - alpha) + b * alpha);
    data[idx + 3] = Math.round((data[idx + 3] ?? 0) * (1 - alpha) + a);
  }

  private drawLine(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, width: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let cx = x0;
    let cy = y0;

    while (true) {
      for (let w = -Math.floor(width / 2); w <= Math.ceil(width / 2); w++) {
        for (let h = -Math.floor(width / 2); h <= Math.ceil(width / 2); h++) {
          if (w * w + h * h <= (width / 2) * (width / 2)) {
            this.drawPixel(cx + w, cy + h, r, g, b);
          }
        }
      }

      if (Math.abs(cx - x1) < 1 && Math.abs(cy - y1) < 1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  private drawCircle(x: number, y: number, radius: number, r: number, g: number, b: number, fill: boolean = true): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          this.drawPixel(Math.round(x + dx), Math.round(y + dy), r, g, b);
        }
      }
    }
  }

  private drawArrow(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, size: number = 10): void {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const endX = x1;
    const endY = y1;

    const leftX = endX - size * Math.cos(angle - Math.PI / 6);
    const leftY = endY - size * Math.sin(angle - Math.PI / 6);
    const rightX = endX - size * Math.cos(angle + Math.PI / 6);
    const rightY = endY - size * Math.sin(angle + Math.PI / 6);

    this.drawLine(Math.round(leftX), Math.round(leftY), Math.round(endX), Math.round(endY), r, g, b, 2);
    this.drawLine(Math.round(rightX), Math.round(rightY), Math.round(endX), Math.round(endY), r, g, b, 2);
  }

  private getHeatColor(intensity: number): { r: number; g: number; b: number } {
    const colors = [
      { r: 0, g: 0, b: 255 },
      { r: 0, g: 255, b: 255 },
      { r: 0, g: 255, b: 0 },
      { r: 255, g: 255, b: 0 },
      { r: 255, g: 0, b: 0 },
    ];

    const idx = Math.min(Math.floor(intensity * (colors.length - 1)), colors.length - 2);
    const t = (intensity * (colors.length - 1)) - idx;
    const c1 = colors[idx] ?? { r: 0, g: 0, b: 255 };
    const c2 = colors[idx + 1] ?? { r: 255, g: 0, b: 0 };

    return {
      r: Math.round(c1.r * (1 - t) + c2.r * t),
      g: Math.round(c1.g * (1 - t) + c2.g * t),
      b: Math.round(c1.b * (1 - t) + c2.b * t),
    };
  }

  private drawHeatmapDots(points: PathPoint[]): void {
    const gridSize = 20;
    const heatGrid: number[][] = [];
    
    for (let y = 0; y < this.height; y += gridSize) {
      heatGrid.push(new Array(Math.ceil(this.width / gridSize)).fill(0));
    }

    for (const point of points) {
      const gx = Math.floor(point.x / gridSize);
      const gy = Math.floor(point.y / gridSize);
      const row = heatGrid[gy];
      if (row && gy >= 0 && gy < heatGrid.length && gx >= 0 && gx < row.length) {
        row[gx] = (row[gx] ?? 0) + 1;
      }
    }

    let maxHeat = 0;
    for (const row of heatGrid) {
      for (const cell of row) {
        if (cell > maxHeat) maxHeat = cell;
      }
    }

    const firstRow = heatGrid[0];
    if (!firstRow) return;
    
    for (let gy = 0; gy < heatGrid.length; gy++) {
      for (let gx = 0; gx < firstRow.length; gx++) {
        const row = heatGrid[gy];
        const cellValue = row?.[gx];
        if (cellValue && cellValue > 0) {
          const intensity = cellValue / (maxHeat || 1);
          const color = this.getHeatColor(intensity);
          
          for (let dy = 0; dy < gridSize; dy++) {
            for (let dx = 0; dx < gridSize; dx++) {
              const px = gx * gridSize + dx;
              const py = gy * gridSize + dy;
              const dist = Math.sqrt(Math.pow(dx - gridSize / 2, 2) + Math.pow(dy - gridSize / 2, 2));
              if (dist <= gridSize / 2) {
                const alpha = (1 - dist / (gridSize / 2)) * intensity * 255 * this.options.heatmapOpacity;
                this.drawPixel(px, py, color.r, color.g, color.b, Math.round(alpha));
              }
            }
          }
        }
      }
    }
  }

  private drawPathLine(points: PathPoint[]): void {
    const color = this.hexToRgb(this.options.pathColor);
    
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (!prev || !curr) continue;
      
      this.drawLine(
        Math.round(prev.x),
        Math.round(prev.y),
        Math.round(curr.x),
        Math.round(curr.y),
        color.r, color.g, color.b,
        this.options.pathWidth
      );
    }
  }

  private drawDots(points: PathPoint[]): void {
    const color = this.hexToRgb(this.options.pathColor);
    
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point) continue;
      
      this.drawCircle(
        Math.round(point.x),
        Math.round(point.y),
        this.options.dotRadius,
        color.r, color.g, color.b,
        true
      );

      if (i > 0 && this.options.showDirectionIndicators) {
        const prev = points[i - 1];
        if (prev) {
          this.drawArrow(
            prev.x,
            prev.y,
            point.x,
            point.y,
            color.r, color.g, color.b
          );
        }
      }
    }
  }

  private drawTimestamps(points: PathPoint[]): void {
    const color = this.hexToRgb(this.options.timestampColor);
    const fontWidth = 8;
    const fontHeight = 12;

    for (let i = 0; i < points.length; i += 10) {
      const point = points[i];
      if (!point || point.relativeTimeMs === undefined) continue;
      const timeStr = `${(point.relativeTimeMs / 1000).toFixed(1)}s`;
      
      this.drawText(
        Math.round(point.x) + 10,
        Math.round(point.y) - 10,
        timeStr,
        color.r, color.g, color.b,
        fontWidth,
        fontHeight
      );
    }
  }

  private drawText(x: number, y: number, text: string, r: number, g: number, b: number, charWidth: number, charHeight: number): void {
    const chars: Record<string, boolean[][]> = {
      '0': [[true,true,true],[true,false,true],[true,false,true],[true,false,true],[true,true,true]],
      '1': [[false,true,false],[true,true,false],[false,true,false],[false,true,false],[true,true,true]],
      '2': [[true,true,true],[false,false,true],[true,true,true],[true,false,false],[true,true,true]],
      '3': [[true,true,true],[false,false,true],[true,true,true],[false,false,true],[true,true,true]],
      '4': [[true,false,true],[true,false,true],[true,true,true],[false,false,true],[false,false,true]],
      '5': [[true,true,true],[true,false,false],[true,true,true],[false,false,true],[true,true,true]],
      '6': [[true,true,true],[true,false,false],[true,true,true],[true,false,true],[true,true,true]],
      '7': [[true,true,true],[false,false,true],[false,false,true],[false,false,true],[false,false,true]],
      '8': [[true,true,true],[true,false,true],[true,true,true],[true,false,true],[true,true,true]],
      '9': [[true,true,true],[true,false,true],[true,true,true],[false,false,true],[true,true,true]],
      '.': [[false,false,false],[false,false,false],[false,false,false],[false,false,false],[true,true,true]],
      's': [[true,true,true],[true,false,false],[true,true,true],[false,false,true],[true,true,true]],
    };

    let offsetX = 0;
    for (const char of text) {
      const charPattern = chars[char];
      if (charPattern) {
        for (let cy = 0; cy < charPattern.length; cy++) {
          const row = charPattern[cy];
          if (!row) continue;
          for (let cx = 0; cx < row.length; cx++) {
            const pixel = row[cx];
            if (pixel) {
              for (let px = 0; px < 2; px++) {
                for (let py = 0; py < 2; py++) {
                  this.drawPixel(
                    x + offsetX + cx * 2 + px,
                    y + cy * 2 + py,
                    r, g, b
                  );
                }
              }
            }
          }
        }
      }
      offsetX += charWidth;
    }
  }

  visualize(actions: ActionFrame[], screenshot?: Buffer): Buffer {
    this.initCanvas(screenshot);
    
    const points = this.extractPathFromActions(actions);
    
    if (points.length === 0) {
      return Buffer.alloc(0);
    }

    switch (this.options.style) {
      case 'path':
        this.drawPathLine(points);
        break;
      case 'heatmap':
        this.drawHeatmapDots(points);
        break;
      case 'dots':
        this.drawDots(points);
        break;
    }

    if (this.options.showTimestamps) {
      this.drawTimestamps(points);
    }

    return PNG.sync.write(this.canvas!);
  }

  async saveToFile(actions: ActionFrame[], screenshot: Buffer | undefined, filePath: string): Promise<string> {
    const outputBuffer = this.visualize(actions, screenshot);
    const dir = path.dirname(filePath);
    await fs.ensureDir(dir);
    await fs.writeFile(filePath, outputBuffer);
    return filePath;
  }

  getPathStatistics(actions: ActionFrame[]): {
    totalPoints: number;
    totalDistance: number;
    averageSpeed: number;
    startPoint: PathPoint | null;
    endPoint: PathPoint | null;
    duration: number;
  } {
    const points = this.extractPathFromActions(actions);
    
    if (points.length === 0) {
      return {
        totalPoints: 0,
        totalDistance: 0,
        averageSpeed: 0,
        startPoint: null,
        endPoint: null,
        duration: 0,
      };
    }

    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const curr = points[i];
      const prev = points[i - 1];
      if (!curr || !prev) continue;
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || first.relativeTimeMs === undefined || last.relativeTimeMs === undefined) {
      return {
        totalPoints: points.length,
        totalDistance,
        averageSpeed: 0,
        startPoint: first ?? null,
        endPoint: last ?? null,
        duration: 0,
      };
    }
    
    const duration = last.relativeTimeMs - first.relativeTimeMs;
    const averageSpeed = duration > 0 ? (totalDistance / duration) * 1000 : 0;

    return {
      totalPoints: points.length,
      totalDistance,
      averageSpeed,
      startPoint: first,
      endPoint: last,
      duration,
    };
  }

  createPathOverlay(actions: ActionFrame[], baseImage?: Buffer): Buffer {
    return this.visualize(actions, baseImage);
  }

  comparePaths(actions1: ActionFrame[], actions2: ActionFrame[]): {
    distanceDiff: number;
    timeDiff: number;
    pathSimilarity: number;
  } {
    const stats1 = this.getPathStatistics(actions1);
    const stats2 = this.getPathStatistics(actions2);

    const distanceDiff = Math.abs(stats1.totalDistance - stats2.totalDistance);
    const timeDiff = Math.abs(stats1.duration - stats2.duration);

    const longerPath = Math.max(stats1.totalDistance, stats2.totalDistance);
    const pathSimilarity = longerPath > 0 ? 1 - (distanceDiff / longerPath) : 1;

    return {
      distanceDiff,
      timeDiff,
      pathSimilarity,
    };
  }
}

export function createGhostVisualizer(options?: Partial<VisualizationOptions>): GhostVisualizer {
  return new GhostVisualizer(options);
}
