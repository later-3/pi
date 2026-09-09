import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/api/openai-completions.ts";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import { getModel } from "../src/compat.ts";
import type { Context, Model, OpenAICompletionsCompat, UserMessage } from "../src/types.ts";

// Some OpenAI-compatible providers reject empty text content parts outright
// (e.g. Kimi responds 400 "text content is empty"). Empty text blocks carry no
// information, so conversion drops them instead of failing the whole request.

const compat: Omit<Required<OpenAICompletionsCompat>, "deferredToolsMode"> & {
	deferredToolsMode?: OpenAICompletionsCompat["deferredToolsMode"];
} = {
	supportsStore: true,
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	supportsFinishReason: true,
	maxTokensField: "max_completion_tokens",
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: false,
	requiresReasoningContentOnAssistantMessages: false,
	thinkingFormat: "openai",
	openRouterRouting: {},
	vercelGatewayRouting: {},
	chatTemplateKwargs: {},
	chatTemplateArgs: {},
	zaiToolStream: false,
	supportsThinkingTokenBudget: false,
	supportsStrictMode: true,
	supportsOpenAIGrammarTools: false,
	cacheControlFormat: "anthropic",
	sendSessionAffinityHeaders: false,
	sessionAffinityFormat: "openai",
	supportsLongCacheRetention: true,
};

const png = { type: "image" as const, data: "ZmFrZQ==", mimeType: "image/png" };

const completionsModel = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4096,
} satisfies Model<"openai-completions">;

function userMessage(content: UserMessage["content"]): UserMessage {
	return { role: "user", content, timestamp: Date.now() };
}

function completionsContext(content: UserMessage["content"]): Context {
	return { messages: [userMessage(content)] };
}

describe("openai-completions convertMessages drops empty text blocks", () => {
	const model = completionsModel;

	it("keeps only the image part for an image-only message with an empty text block", () => {
		const converted = convertMessages(model, completionsContext([{ type: "text", text: "" }, png]), compat);
		expect(converted).toHaveLength(1);
		expect(converted[0]?.role).toBe("user");
		expect(converted[0]?.content).toEqual([
			{ type: "text", text: "(see attached image)" },
			{ type: "image_url", image_url: { url: `data:${png.mimeType};base64,${png.data}` } },
		]);
	});

	it("skips a user message that contains only empty text blocks", () => {
		const converted = convertMessages(
			model,
			completionsContext([
				{ type: "text", text: "" },
				{ type: "text", text: "   " },
			]),
			compat,
		);
		expect(converted).toHaveLength(0);
	});

	it("keeps text and image parts when the text is non-empty", () => {
		const converted = convertMessages(model, completionsContext([{ type: "text", text: "describe" }, png]), compat);
		expect(converted[0]?.content).toEqual([
			{ type: "text", text: "describe" },
			{ type: "image_url", image_url: { url: `data:${png.mimeType};base64,${png.data}` } },
		]);
	});
});

describe("openai-responses convertResponsesMessages drops empty text blocks", () => {
	const model = getModel("openai", "gpt-4o-mini");
	const allowedProviders = new Set(["openai"]);

	it("keeps only the image part for an image-only message with an empty text block", () => {
		const converted = convertResponsesMessages(
			model,
			completionsContext([{ type: "text", text: "" }, png]),
			allowedProviders,
		);
		expect(converted).toHaveLength(1);
		const message = converted[0] as { role: string; content: unknown[] };
		expect(message.role).toBe("user");
		expect(message.content).toEqual([
			{ type: "input_text", text: "(see attached image)" },
			{ type: "input_image", detail: "auto", image_url: `data:${png.mimeType};base64,${png.data}` },
		]);
	});

	it("skips a user message that contains only empty text blocks", () => {
		const converted = convertResponsesMessages(
			model,
			completionsContext([{ type: "text", text: "" }]),
			allowedProviders,
		);
		expect(converted).toHaveLength(0);
	});
});
