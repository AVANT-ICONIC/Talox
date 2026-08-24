/**
 * @file commandHandler.ts
 * @description Maps daemon commands to TaloxController method calls.
 *
 * Each command action is validated and dispatched to the appropriate
 * controller method, returning a structured DaemonResponse.
 */

import { randomUUID } from "node:crypto";
import type { TaloxController } from "../controller/TaloxController.js";
import type { DaemonCommand, DaemonResponse } from "./TaloxDaemon.js";

/**
 * Dispatch a daemon command to the appropriate TaloxController method.
 *
 * @param controller - Active TaloxController for the session
 * @param command    - Parsed daemon command
 * @returns Structured response to send back over the socket
 */
export async function handleCommand(controller: TaloxController, command: DaemonCommand): Promise<DaemonResponse> {
	try {
		switch (command.action) {
			case "navigate":
				return await handleNavigate(controller, command);
			case "click":
				return await handleClick(controller, command);
			case "type":
				return await handleType(controller, command);
			case "getState":
				return await handleGetState(controller, command);
			case "screenshot":
				return await handleScreenshot(controller, command);
			default:
				return errorResponse(command.id, `Unknown action: ${command.action}`);
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(command.id, message);
	}
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

async function handleNavigate(controller: TaloxController, command: DaemonCommand): Promise<DaemonResponse> {
	const url = command.params?.["url"];
	if (typeof url !== "string" || url.length === 0) {
		return errorResponse(command.id, "Missing or invalid 'url' parameter");
	}
	const state = await controller.navigate(url);
	return successResponse(command.id, { url: state.url, title: state.title });
}

async function handleClick(controller: TaloxController, command: DaemonCommand): Promise<DaemonResponse> {
	const selector = command.params?.["selector"];
	if (typeof selector !== "string" || selector.length === 0) {
		return errorResponse(command.id, "Missing or invalid 'selector' parameter");
	}
	const state = await controller.click(selector);
	return successResponse(command.id, { url: state.url, title: state.title });
}

async function handleType(controller: TaloxController, command: DaemonCommand): Promise<DaemonResponse> {
	const selector = command.params?.["selector"];
	const text = command.params?.["text"];
	if (typeof selector !== "string" || selector.length === 0) {
		return errorResponse(command.id, "Missing or invalid 'selector' parameter");
	}
	if (typeof text !== "string") {
		return errorResponse(command.id, "Missing or invalid 'text' parameter");
	}
	const state = await controller.type(selector, text);
	return successResponse(command.id, { url: state.url, title: state.title });
}

async function handleGetState(controller: TaloxController, command: DaemonCommand): Promise<DaemonResponse> {
	const variant = command.params?.["variant"];

	if (variant === undefined) {
		return successResponse(command.id, await controller.getState());
	}
	if (variant === "full") {
		return successResponse(command.id, await controller.getState("full"));
	}
	if (variant === "agent") {
		return successResponse(command.id, await controller.getState("agent"));
	}
	if (variant === "debug") {
		return successResponse(command.id, await controller.getState("debug"));
	}

	return errorResponse(command.id, "Invalid 'variant' parameter; expected 'full', 'agent', or 'debug'");
}

async function handleScreenshot(controller: TaloxController, command: DaemonCommand): Promise<DaemonResponse> {
	const selector = command.params?.["selector"];
	const options: { selector?: string; path?: string } = {};
	if (typeof selector === "string" && selector.length > 0) {
		options.selector = selector;
	}
	const result = await controller.screenshot(Object.keys(options).length > 0 ? options : undefined);
	// Convert buffer to base64 for JSON serialization
	if (Buffer.isBuffer(result)) {
		return successResponse(command.id, {
			encoding: "base64",
			data: result.toString("base64"),
		});
	}
	return successResponse(command.id, { path: result });
}

// ─── Response Helpers ─────────────────────────────────────────────────────────

function successResponse(id: string, data: unknown): DaemonResponse {
	return { id, success: true, data };
}

function errorResponse(id: string, error: string): DaemonResponse {
	return { id, success: false, error };
}

/**
 * Generate a new UUID for session tracking.
 */
export function generateSessionId(): string {
	return randomUUID();
}
