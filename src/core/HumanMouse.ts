import type { Point } from '../types/index.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Optimized Fitts's Law: Scales steps but caps them to prevent excessive slowness.
 */
const getOptimizedSteps = (dist: number, targetWidth: number, speedMultiplier: number = 1.0): number => {
    const ID = Math.log2((2 * dist) / Math.max(targetWidth, 1));
    // Reduced multipliers for faster execution
    const baseSteps = 15 + (ID * 8) + (Math.random() * 10);
    const steps = baseSteps / speedMultiplier;
    return Math.min(200, Math.max(10, Math.floor(steps))); // Cap at 200 steps (~2s max move)
};

export class HumanMouse {
    /**
     * 🧬 THE GENERATOR
     * Focused on high-signal right-handed biomechanics.
     */
    static generatePath(start: Point, end: Point, targetWidth: number = 100, speedMultiplier: number = 1.0): Point[] {
        const fullPath: Point[] = [];
        const dist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));

        // 1. PRIMARY MOVEMENT
        const steps = getOptimizedSteps(dist, targetWidth, speedMultiplier);
        const isMovingRight = end.x > start.x;
        const arcBias = (isMovingRight ? -1 : 1) * (dist * 0.15);

        const cp1 = {
            x: start.x + (end.x - start.x) * 0.3 + (Math.random() - 0.5) * (dist * 0.1),
            y: start.y + (end.y - start.y) * 0.3 + arcBias + (Math.random() - 0.5) * (dist * 0.1)
        };
        const cp2 = {
            x: start.x + (end.x - start.x) * 0.7 + (Math.random() - 0.5) * (dist * 0.1),
            y: start.y + (end.y - start.y) * 0.7 + arcBias * 0.5 + (Math.random() - 0.5) * (dist * 0.1)
        };

        let currentTime = Date.now();
        const pollingRate = 10 / speedMultiplier;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            // Quintic Easing for natural human "burst & settle"
            const easedT = t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

            const invT = 1 - easedT;
            let x = invT**3 * start.x + 3 * invT**2 * easedT * cp1.x + 3 * invT * easedT**2 * cp2.x + easedT**3 * end.x;
            let y = invT**3 * start.y + 3 * invT**2 * easedT * cp1.y + 3 * invT * easedT**2 * cp2.y + easedT**3 * end.y;

            // Subtle Jitter (Higher at peak speed)
            const jitter = (Math.sin(t * Math.PI) * 1.8 + 0.2) / speedMultiplier;
            x += (Math.random() - 0.5) * jitter;
            y += (Math.random() - 0.5) * jitter;

            currentTime += pollingRate + Math.random() * (3 / speedMultiplier);
            fullPath.push({ x: Math.round(x), y: Math.round(y), t: currentTime });
        }

        return fullPath;
    }

    /**
     * 👁️ OPTIMIZED MOVEMENT
     * Uses 'isFlow' to skip reaction delays during sequences.
     */
    static async move(page: any, targetX: number, targetY: number, targetWidth: number = 100, isFlow: boolean = false, currentPos?: Point, speedMultiplier: number = 1.0) {
        // Only pause if we aren't in a "Flow State"
        if (!isFlow) {
            await sleep((50 + Math.random() * 100) / speedMultiplier);
        }

        const start = currentPos || { x: 0, y: 0 };
        const end = { x: targetX, y: targetY };
        const path = this.generatePath(start, end, targetWidth, speedMultiplier);

        const startPoint = path[0];
        if (!startPoint || startPoint.t === undefined) return;
        const startTime = startPoint.t;
        const initialRealTime = Date.now();

        for (const point of path) {
            const targetTime = initialRealTime + (point.t! - startTime);
            const waitTime = targetTime - Date.now();
            if (waitTime > 0) await sleep(waitTime);
            await page.mouse.move(point.x, point.y);
        }
    }

    /**
     * 🎯 OPTIMIZED CLICK
     * @returns The final position after click
     */
    static async click(page: any, selector: string, isFlow: boolean = false, currentPos?: Point, speedMultiplier: number = 1.0): Promise<Point> {
        const element = await page.$(selector);
        if (!element) return currentPos || { x: 0, y: 0 };
        const box = await element.boundingBox();
        if (!box) return currentPos || { x: 0, y: 0 };

        // Pick a spot inside the box
        const targetX = box.x + box.width * (0.2 + Math.random() * 0.6);
        const targetY = box.y + box.height * (0.2 + Math.random() * 0.6);

        await this.move(page, targetX, targetY, box.width, isFlow, currentPos, speedMultiplier);

        // Reduced Hunting (only 15% chance, and faster)
        let finalX = targetX;
        let finalY = targetY;
        if (Math.random() < 0.15) {
            for (let i = 0; i < 3; i++) {
                finalX = targetX + (Math.random() - 0.5) * 4;
                finalY = targetY + (Math.random() - 0.5) * 4;
                await page.mouse.move(finalX, finalY);
                await sleep((20 + Math.random() * 20) / speedMultiplier);
            }
        }

        // Physical Press with Micro-Drag
        await page.mouse.down();
        const clickDuration = (40 + Math.random() * 60) / speedMultiplier;
        await sleep(clickDuration);
        // Tiny diagonal shift during click (1px)
        if (Math.random() > 0.5) {
            finalX += 1;
            finalY += 1;
            await page.mouse.move(finalX, finalY);
        }
        await page.mouse.up();
        
        return { x: Math.round(finalX), y: Math.round(finalY) };
    }

    /**
     * 🎡 FAST FIDGET
     */
    static async fidget(page: any, currentX: number, currentY: number, durationMs: number = 1500) {
        const endTime = Date.now() + durationMs;
        let cx = currentX;
        let cy = currentY;
        while (Date.now() < endTime) {
            cx += (Math.random() - 0.5) * 2;
            cy += (Math.random() - 0.5) * 2;
            await page.mouse.move(cx, cy);
            await sleep(600 + Math.random() * 800);
        }
    }
}
