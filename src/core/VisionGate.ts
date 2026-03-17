import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import ssim from 'ssim.js';
import { createWorker } from 'tesseract.js';
import fs from 'fs-extra';
import path from 'path';
import type { VisualDiffResult } from '../types/index.js';

export interface HeatmapResult {
  heatmapPath: string;
  regions: DiffRegion[];
  totalDiffPixels: number;
  heatmapImage: Buffer;
}

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number;
  pixelCount: number;
}

export class VisionGate {
  private baselineDir: string;

  constructor(baseDir: string = './.talox/baselines') {
    this.baselineDir = baseDir;
    fs.ensureDirSync(this.baselineDir);
  }

  /**
   * 🖼️ BASELINE VAULT: Get or set a golden master screenshot.
   */
  async getBaseline(key: string): Promise<Buffer | null> {
    const filePath = path.join(this.baselineDir, `${key}.png`);
    if (await fs.pathExists(filePath)) {
      return await fs.readFile(filePath);
    }
    return null;
  }

  async saveBaseline(key: string, image: Buffer): Promise<void> {
    const filePath = path.join(this.baselineDir, `${key}.png`);
    await fs.writeFile(filePath, image);
  }

  /**
   * 🔥 VISUAL DIFF HEATMAP: Generate a heatmap showing where differences occurred.
   */
  async generateDiffHeatmap(
    img1: Buffer,
    img2: Buffer,
    outputPath?: string,
    blockSize: number = 8
  ): Promise<HeatmapResult> {
    const png1 = PNG.sync.read(img1);
    const png2 = PNG.sync.read(img2);
    const { width, height } = png1;

    const heatmapWidth = Math.ceil(width / blockSize);
    const heatmapHeight = Math.ceil(height / blockSize);
    const heatmap = new PNG({ width: heatmapWidth, height: heatmapHeight });
    const diffRegions: DiffRegion[] = [];
    const intensityMap: number[][] = [];

    for (let y = 0; y < heatmapHeight; y++) {
      intensityMap[y] = [];
      for (let x = 0; x < heatmapWidth; x++) {
        const startX = x * blockSize;
        const startY = y * blockSize;
        const endX = Math.min(startX + blockSize, width);
        const endY = Math.min(startY + blockSize, height);

        let totalDiff = 0;
        let pixelCount = 0;

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (py * width + px) * 4;
            const r1 = png1.data[idx] ?? 0;
            const g1 = png1.data[idx + 1] ?? 0;
            const b1 = png1.data[idx + 2] ?? 0;
            const r2 = png2.data[idx] ?? 0;
            const g2 = png2.data[idx + 1] ?? 0;
            const b2 = png2.data[idx + 2] ?? 0;

            const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
            totalDiff += diff;
            pixelCount++;
          }
        }

        const avgDiff = pixelCount > 0 ? totalDiff / pixelCount : 0;
        const normalizedIntensity = Math.min(1, avgDiff / 255);
        intensityMap[y]![x] = normalizedIntensity;

        const color = this.getHeatmapColor(normalizedIntensity);
        const heatmapIdx = (y * heatmapWidth + x) * 4;
        heatmap.data[heatmapIdx] = color.r;
        heatmap.data[heatmapIdx + 1] = color.g;
        heatmap.data[heatmapIdx + 2] = color.b;
        heatmap.data[heatmapIdx + 3] = normalizedIntensity > 0.05 ? 255 : 0;
      }
    }

    const { regions, totalDiffPixels } = this.identifyDiffRegions(
      intensityMap,
      blockSize,
      width,
      height
    );

    const heatmapImage = PNG.sync.write(heatmap);
    const savedPath = outputPath || path.join(this.baselineDir, `heatmap_${Date.now()}.png`);

    if (outputPath) {
      await fs.writeFile(savedPath, heatmapImage);
    }

    return {
      heatmapPath: savedPath,
      regions,
      totalDiffPixels,
      heatmapImage,
    };
  }

  /**
   * Get heatmap color based on intensity (0-1).
   * Green (low) -> Yellow (medium) -> Red (high)
   */
  private getHeatmapColor(intensity: number): { r: number; g: number; b: number } {
    if (intensity < 0.33) {
      const t = intensity / 0.33;
      return {
        r: Math.floor(255 * t),
        g: 255,
        b: 0,
      };
    } else if (intensity < 0.66) {
      const t = (intensity - 0.33) / 0.33;
      return {
        r: 255,
        g: Math.floor(255 * (1 - t)),
        b: 0,
      };
    } else {
      const t = (intensity - 0.66) / 0.34;
      return {
        r: 255,
        g: Math.floor(100 * (1 - t)),
        b: Math.floor(100 * t),
      };
    }
  }

  /**
   * Identify regions with highest differences.
   */
  private identifyDiffRegions(
    intensityMap: number[][],
    blockSize: number,
    imageWidth: number,
    imageHeight: number
  ): { regions: DiffRegion[]; totalDiffPixels: number } {
    const regions: DiffRegion[] = [];
    let totalDiffPixels = 0;
    const threshold = 0.1;

    const height = intensityMap.length;
    const width = intensityMap[0]?.length || 0;

    for (let y = 0; y < height; y++) {
      const row = intensityMap[y];
      if (!row) continue;
      for (let x = 0; x < width; x++) {
        const intensity = row[x] ?? 0;
        if (intensity > threshold) {
          const pixelCount = Math.floor(intensity * blockSize * blockSize);
          totalDiffPixels += pixelCount;

          regions.push({
            x: x * blockSize,
            y: y * blockSize,
            width: blockSize,
            height: blockSize,
            intensity,
            pixelCount,
          });
        }
      }
    }

    regions.sort((a, b) => b.intensity - a.intensity);
    const topRegions = regions.slice(0, 10);

    const mergedRegions = this.mergeAdjacentRegions(topRegions, imageWidth, imageHeight);

    return { regions: mergedRegions, totalDiffPixels };
  }

  /**
   * Merge adjacent regions into larger bounding boxes.
   */
  private mergeAdjacentRegions(
    regions: DiffRegion[],
    imageWidth: number,
    imageHeight: number,
    gridSize: number = 50
  ): DiffRegion[] {
    if (regions.length === 0) return [];

    const gridCols = Math.ceil(imageWidth / gridSize);
    const gridRows = Math.ceil(imageHeight / gridSize);
    const grid: boolean[][] = Array(gridRows)
      .fill(null)
      .map(() => Array(gridCols).fill(false));

    for (const region of regions) {
      const startCol = Math.floor(region.x / gridSize);
      const startRow = Math.floor(region.y / gridSize);
      const endCol = Math.floor((region.x + region.width) / gridSize);
      const endRow = Math.floor((region.y + region.height) / gridSize);

      for (let r = startRow; r <= endRow && r < gridRows; r++) {
        const gridRow = grid[r];
        if (!gridRow) continue;
        for (let c = startCol; c <= endCol && c < gridCols; c++) {
          gridRow[c] = true;
        }
      }
    }

    const merged: DiffRegion[] = [];
    const visited: boolean[][] = Array(gridRows)
      .fill(null)
      .map(() => Array(gridCols).fill(false));

    for (let row = 0; row < gridRows; row++) {
      const gridRow = grid[row];
      const visitedRow = visited[row];
      if (!gridRow || !visitedRow) continue;
      for (let col = 0; col < gridCols; col++) {
        if (gridRow[col] && !visitedRow[col]) {
          let minX = col * gridSize;
          let minY = row * gridSize;
          let maxX = minX + gridSize;
          let maxY = minY + gridSize;
          let totalIntensity = 0;
          let totalPixels = 0;

          const stack: [number, number][] = [[row, col]];
          visitedRow[col] = true;

          while (stack.length > 0) {
            const [r, c] = stack.pop()!;
            const region = regions.find(
              (reg) =>
                reg.x / gridSize <= c &&
                reg.y / gridSize <= r &&
                (reg.x + reg.width) / gridSize > c &&
                (reg.y + reg.height) / gridSize > r
            );

            if (region) {
              totalIntensity += region.intensity;
              totalPixels += region.pixelCount;
            }

            const neighbors: [number, number][] = [
              [r - 1, c],
              [r + 1, c],
              [r, c - 1],
              [r, c + 1],
            ];

            for (const [nr, nc] of neighbors) {
              if (
                nr >= 0 &&
                nr < gridRows &&
                nc >= 0 &&
                nc < gridCols
              ) {
                const gridNr = grid[nr];
                const visitedNr = visited[nr];
                if (gridNr && visitedNr && gridNr[nc] && !visitedNr[nc]) {
                  visitedNr[nc] = true;
                  stack.push([nr, nc]);
                  minX = Math.min(minX, nc * gridSize);
                  minY = Math.min(minY, nr * gridSize);
                  maxX = Math.max(maxX, (nc + 1) * gridSize);
                  maxY = Math.max(maxY, (nr + 1) * gridSize);
                }
              }
            }
          }

          merged.push({
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            intensity: totalPixels > 0 ? totalIntensity / Math.max(1, merged.length) : 0,
            pixelCount: totalPixels,
          });
        }
      }
    }

    return merged.sort((a, b) => b.pixelCount - a.pixelCount);
  }

  /**
   * 🔍 PIXEL-LEVEL & STRUCTURAL COMPARISON
   */
  async compare(img1: Buffer, img2: Buffer): Promise<VisualDiffResult> {
    const png1 = PNG.sync.read(img1);
    const png2 = PNG.sync.read(img2);
    const { width, height } = png1;

    // 1. Pixelmatch
    const diff = new PNG({ width, height });
    const mismatchedPixels = pixelmatch(
        png1.data, 
        png2.data, 
        diff.data, 
        width, 
        height, 
        { threshold: 0.1 }
    );

    // 2. SSIM (Structural Similarity Index)
    // ssim.js has a weird export structure in ESM
    const ssimFn = (ssim as any).ssim || (ssim as any).default || ssim;
    const ssimResult = ssimFn(png1, png2);

    return {
      mismatchedPixels,
      ssimScore: ssimResult.mssim,
    };
  }

  /**
   * 🔍 COMPARE WITH HEATMAP: Compare images and generate diff heatmap.
   */
  async compareWithHeatmap(
    img1: Buffer,
    img2: Buffer,
    heatmapPath?: string
  ): Promise<VisualDiffResult & { heatmap?: HeatmapResult }> {
    const comparisonResult = await this.compare(img1, img2);
    
    const heatmapResult = await this.generateDiffHeatmap(
      img1,
      img2,
      heatmapPath
    );

    return {
      ...comparisonResult,
      heatmap: heatmapResult,
    };
  }

  /**
   * 📝 OCR: Extract text from a screenshot.
   */
  async extractText(image: Buffer): Promise<string> {
    try {
        const worker = await createWorker('eng');
        const { data: { text } } = await worker.recognize(image);
        await worker.terminate();
        return text;
    } catch (err) {
        console.error('OCR ERROR:', err);
        return '';
    }
  }
}
