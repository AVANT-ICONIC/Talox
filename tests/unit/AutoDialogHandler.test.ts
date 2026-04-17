import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutoDialogHandler } from "../../src/core/AutoDialogHandler";
import type { DialogRecord } from "../../src/core/AutoDialogHandler";
import { EventBus } from "../../src/core/controller/EventBus";
import type { TaloxEventMap } from "../../src/types/events";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockDialog(
	type: string,
	message: string,
): {
	type: () => string;
	message: () => string;
	accept: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
} {
	return {
		type: vi.fn().mockReturnValue(type),
		message: vi.fn().mockReturnValue(message),
		accept: vi.fn().mockResolvedValue(undefined),
		dismiss: vi.fn().mockResolvedValue(undefined),
	};
}

type PageMock = {
	on: ReturnType<typeof vi.fn>;
	off: ReturnType<typeof vi.fn>;
};

function createMockPage(): PageMock {
	return {
		on: vi.fn(),
		off: vi.fn(),
	};
}

function createEventBus(): EventBus<TaloxEventMap> {
	return new EventBus<TaloxEventMap>();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AutoDialogHandler", () => {
	let handler: AutoDialogHandler;
	let events: EventBus<TaloxEventMap>;

	beforeEach(() => {
		events = createEventBus();
		handler = new AutoDialogHandler(events, 0);
	});

	describe("constructor", () => {
		it("creates handler with default verbosity", () => {
			const h = new AutoDialogHandler(events);
			expect(h.handledCount).toBe(0);
			expect(h.records).toEqual([]);
		});

		it("creates handler with custom verbosity", () => {
			const h = new AutoDialogHandler(events, 2);
			expect(h.handledCount).toBe(0);
		});
	});

	describe("install / dispose", () => {
		it("installs dialog listener on a page", () => {
			const page = createMockPage();
			handler.install(page as any);
			expect(page.on).toHaveBeenCalledWith("dialog", expect.any(Function));
		});

		it("does not install listener twice on the same page", () => {
			const page = createMockPage();
			handler.install(page as any);
			handler.install(page as any);
			expect(page.on).toHaveBeenCalledTimes(1);
		});

		it("disposes removes listeners from all installed pages", () => {
			const page1 = createMockPage();
			const page2 = createMockPage();
			handler.install(page1 as any);
			handler.install(page2 as any);
			handler.dispose();
			expect(page1.off).toHaveBeenCalledWith("dialog", expect.any(Function));
			expect(page2.off).toHaveBeenCalledWith("dialog", expect.any(Function));
		});

		it("dispose handles already-closed pages gracefully", () => {
			const page = createMockPage();
			page.off.mockImplementation(() => {
				throw new Error("Page already closed");
			});
			handler.install(page as any);
			expect(() => handler.dispose()).not.toThrow();
		});
	});

	describe("enable / disable", () => {
		it("is enabled by default", () => {
			expect(handler.isEnabled()).toBe(true);
		});

		it("disable turns off handling", () => {
			handler.disable();
			expect(handler.isEnabled()).toBe(false);
		});

		it("enable re-enables handling", () => {
			handler.disable();
			handler.enable();
			expect(handler.isEnabled()).toBe(true);
		});
	});

	describe("dialog handling", () => {
		it("accepts alert dialogs", async () => {
			const dialog = createMockDialog("alert", "Hello!");
			// Trigger the bound listener that was registered via page.on
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			await listener(dialog);

			expect(dialog.accept).toHaveBeenCalled();
			expect(handler.handledCount).toBe(1);
			expect(handler.records[0]).toMatchObject({
				type: "alert",
				message: "Hello!",
				action: "accepted",
			});
		});

		it("accepts confirm dialogs", async () => {
			const dialog = createMockDialog("confirm", "Are you sure?");
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			await listener(dialog);

			expect(dialog.accept).toHaveBeenCalled();
			expect(handler.records[0]!.action).toBe("accepted");
		});

		it("accepts prompt dialogs with empty string", async () => {
			const dialog = createMockDialog("prompt", "Enter name:");
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			await listener(dialog);

			expect(dialog.accept).toHaveBeenCalledWith("");
			expect(handler.records[0]!.action).toBe("accepted");
		});

		it("dismisses beforeunload dialogs", async () => {
			const dialog = createMockDialog("beforeunload", "Leave page?");
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			await listener(dialog);

			expect(dialog.dismiss).toHaveBeenCalled();
			expect(handler.records[0]!.action).toBe("dismissed");
		});

		it("dismisses unknown dialog types", async () => {
			const dialog = createMockDialog("custom-type", "Unknown");
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			await listener(dialog);

			expect(dialog.dismiss).toHaveBeenCalled();
			expect(handler.records[0]!.action).toBe("dismissed");
		});

		it("does not handle dialogs when disabled", async () => {
			handler.disable();
			const dialog = createMockDialog("alert", "Ignored");
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			await listener(dialog);

			expect(dialog.accept).not.toHaveBeenCalled();
			expect(handler.handledCount).toBe(0);
		});
	});

	describe("stats tracking", () => {
		it("tracks handledCount across multiple dialogs", async () => {
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;

			await listener(createMockDialog("alert", "First"));
			await listener(createMockDialog("confirm", "Second"));
			await listener(createMockDialog("prompt", "Third"));

			expect(handler.handledCount).toBe(3);
			expect(handler.records).toHaveLength(3);
		});

		it("records have timestamps", async () => {
			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			const before = Date.now();

			await listener(createMockDialog("alert", "Test"));

			const after = Date.now();
			expect(handler.records[0]!.timestamp).toBeGreaterThanOrEqual(before);
			expect(handler.records[0]!.timestamp).toBeLessThanOrEqual(after);
		});
	});

	describe("event emission", () => {
		it("emits dialogHandled event on each dialog", async () => {
			const emitted: any[] = [];
			events.on("dialogHandled", (data) => emitted.push(data));

			const page = createMockPage();
			handler.install(page as any);
			const listener = page.on.mock.calls[0]![1] as (d: any) => Promise<void>;
			await listener(createMockDialog("alert", "Hi"));

			expect(emitted).toHaveLength(1);
			expect(emitted[0]).toMatchObject({
				type: "alert",
				message: "Hi",
				action: "accepted",
			});
		});
	});
});
