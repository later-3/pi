import { getModel } from "../src/compat.ts";
import type { Model } from "../src/types.ts";

// The pinned gateway catalog no longer lists Workers AI aliases. Keep the
// /compat protocol scenario explicit instead of depending on catalog discovery.
export function cloudflareWorkersGatewayTestModel(): Model<"openai-completions"> {
	const worker = getModel("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6");
	return {
		...worker,
		id: `workers-ai/${worker.id}`,
		provider: "cloudflare-ai-gateway",
		baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
		compat: {
			sendSessionAffinityHeaders: true,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsStore: false,
			maxTokensField: "max_tokens",
		},
	};
}

export function hasCloudflareWorkersAICredentials(): boolean {
	return !!process.env.CLOUDFLARE_API_KEY && !!process.env.CLOUDFLARE_ACCOUNT_ID;
}

export function hasCloudflareAiGatewayCredentials(): boolean {
	return (
		!!process.env.CLOUDFLARE_API_KEY && !!process.env.CLOUDFLARE_ACCOUNT_ID && !!process.env.CLOUDFLARE_GATEWAY_ID
	);
}
