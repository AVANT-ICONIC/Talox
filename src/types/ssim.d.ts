/**
 * Type declarations for ssim.js — a zero-dependency SSIM implementation
 * that lacks proper ESM type exports.
 *
 * The library's default export is the `ssim` function itself, but in some
 * bundler configurations it ends up as a namespace with `.default` or `.ssim`.
 * This declaration handles all shapes.
 */
declare module "ssim.js" {
	interface SSIMMatrix {
		data: Float64Array;
		width: number;
		height: number;
	}

	interface SSIMOptions {
		windowSize?: number;
		k1?: number;
		k2?: number;
		bitDepth?: number;
	}

	function ssim(
		image1: SSIMMatrix | ImageData | { data: Uint8Array; width: number; height: number },
		image2: SSIMMatrix | ImageData | { data: Uint8Array; width: number; height: number },
		options?: SSIMOptions,
	): { mssim: number; ssim: number; mcs: number };

	export = ssim;
}
