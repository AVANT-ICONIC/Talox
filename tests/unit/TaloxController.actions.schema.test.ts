import { beforeEach, describe, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController";
import { assertValidPageState, makeRichState } from "./helpers/pageStateHelper";

describe("TaloxController action outputs", () => {
	let talox: TaloxController;
	let stubState: ReturnType<typeof makeRichState>;

	beforeEach(() => {
		talox = new TaloxController(".");
		stubState = makeRichState();

		(talox as any)._actions = {
			navigate: vi.fn().mockResolvedValue(stubState),
			click: vi.fn().mockResolvedValue(stubState),
			type: vi.fn().mockResolvedValue(stubState),
			mouseMove: vi.fn(),
			scrollTo: vi.fn(),
			screenshot: vi.fn(),
			extractTable: vi.fn(),
			findElement: vi.fn().mockResolvedValue(null),
			evaluate: vi.fn(),
			waitForSelector: vi.fn(),
			waitForNavigation: vi.fn(),
			waitForLoadState: vi.fn(),
		};

		(talox as any)._adapt = { evaluate: vi.fn().mockResolvedValue(false), recordStrategySuccess: vi.fn() };

		const session = (talox as any)._session;
		session.rulesEngine = {
			analyze: vi.fn().mockReturnValue([]),
			diffStructural: vi.fn().mockReturnValue([]),
		};
		session.getActiveStateCollector = () => ({
			collect: vi.fn().mockResolvedValue(stubState),
		});
		session.lastState = null;
		session.isFirstNavigation = true;
	});

	it("navigate returns a schema-valid state", async () => {
		const state = await talox.navigate("https://example.com");
		assertValidPageState(state);
	});

	it("getState returns a schema-valid state", async () => {
		const state = await talox.getState();
		assertValidPageState(state);
	});

	it("click returns a schema-valid state", async () => {
		const state = await talox.click("#submit");
		assertValidPageState(state);
	});

	it("type returns a schema-valid state", async () => {
		const state = await talox.type("#input", "hello");
		assertValidPageState(state);
	});
});
