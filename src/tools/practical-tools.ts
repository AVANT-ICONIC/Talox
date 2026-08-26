import { promises as fs } from "node:fs";
import path from "node:path";
import type { TaloxController } from "../core/controller/TaloxController.js";
import type { TaloxPageState } from "../types/index.js";

export interface BackgroundTabResult {
	state: TaloxPageState;
	message: string;
}

export interface ApiCaptureResult {
	status: number;
	headers: Record<string, string>;
	body: string;
}

export interface SearchResult {
	selector: string;
	snippet: string;
	tag: string;
}

export interface StructuredContent {
	url: string;
	title: string;
	sections: Array<{ heading: string; summary: string; selectors: string[] }>;
}

export function getPracticalTools(talox: TaloxController) {
	return {
		openBackgroundTab: (url: string) => openBackgroundTab(talox, url),
		captureApiResponse: (endpoint: string, init?: RequestInit) => captureApiResponse(talox, endpoint, init),
		exportMarkdownSnapshot: (dest: string) => exportMarkdownSnapshot(talox, dest),
		searchOnSite: (query: string, limit?: number) => searchOnSite(talox, query, limit),
		extractVisibleStructuredContent: () => extractVisibleStructuredContent(talox),
	};
}

export async function openBackgroundTab(talox: TaloxController, url: string): Promise<BackgroundTabResult> {
	const state = await talox.openPage(url);
	return {
		state,
		message: `Opened background page ${state.url} with ${state.nodes.length} nodes`,
	};
}

export async function captureApiResponse(
	talox: TaloxController,
	endpoint: string,
	init: RequestInit = {},
): Promise<ApiCaptureResult> {
	const response = await talox.evaluate<ApiCaptureResult>(`
    (async () => {
      const res = await fetch(${JSON.stringify(endpoint)}, ${JSON.stringify(init)});
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => { headers[key] = value; });
      return {
        status: res.status,
        headers,
        body: await res.text(),
      };
    })();
  `);
	return response;
}

export async function exportMarkdownSnapshot(talox: TaloxController, destPath: string): Promise<string> {
	const content = await talox.evaluate<string>(`
    (() => {
      const text = document.body.innerText || document.documentElement.innerText || '';
      return text.trim();
    })();
  `);
	const markdown = content
		.split(/\n+/)
		.map((line) => {
			if (line.startsWith("### ")) return `### ${line.slice(4).trim()}`;
			if (line.startsWith("## ")) return `## ${line.slice(3).trim()}`;
			if (line.startsWith("# ")) return `# ${line.slice(2).trim()}`;
			return line.trim();
		})
		.filter((line) => line.length > 0)
		.join("\n\n");
	const resolved = path.resolve(destPath);
	await fs.writeFile(resolved, markdown, "utf-8");
	return resolved;
}

export async function searchOnSite(talox: TaloxController, query: string, limit: number = 5): Promise<SearchResult[]> {
	const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 5;
	const results = await talox.evaluate<SearchResult[]>(`( () => {
      const matches: Array<{ selector: string; snippet: string; tag: string }> = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, { acceptNode: () => NodeFilter.FILTER_ACCEPT }, false);
      while (walker.nextNode()) {
        const el = walker.currentNode as Element;
        if (!el || !el.textContent) continue;
        const snippet = el.textContent.trim();
        if (!snippet) continue;
        if (snippet.toLowerCase().includes(${JSON.stringify(query.toLowerCase())})) {
          const selector =
            el.tagName.toLowerCase()
            + (el.id ? '#' + el.id : '')
            + (el.className ? '.' + el.className.toString().trim().split(/\\s+/).filter(Boolean).join('.') : '');
          matches.push({
            selector,
            snippet: snippet.slice(0, 160),
            tag: el.tagName.toLowerCase(),
          });
          if (matches.length >= ${safeLimit}) break;
        }
      }
      return matches.slice(0, ${safeLimit});
    })();`);
	return results;
}

export async function extractVisibleStructuredContent(talox: TaloxController): Promise<StructuredContent> {
	const state = await talox.getState();
	const sections: StructuredContent["sections"] = [];
	const used: Set<string> = new Set();
	for (const node of state.nodes) {
		if (sections.length >= 6) break;
		if (!node.name || node.name.trim().length === 0) continue;
		const selector = `#${node.id}`;
		if (used.has(selector)) continue;
		used.add(selector);
		sections.push({
			heading: node.role === "heading" ? node.name : "Section",
			summary: node.name,
			selectors: [selector],
		});
	}
	return {
		url: state.url,
		title: state.title,
		sections,
	};
}
