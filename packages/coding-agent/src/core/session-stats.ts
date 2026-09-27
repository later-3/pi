import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionStats } from "./agent-session.ts";
import { calculateContextTokens, estimateContextTokens } from "./compaction/index.ts";
import type { ContextUsage } from "./extensions/index.ts";
import { getLatestCompactionEntry, type SessionManager } from "./session-manager.ts";
import { addUsageToTotals, createUsageTotals } from "./usage-totals.ts";

/** Read native totals without constructing an AgentSession or loading extensions. */
export function getSessionStats(manager: SessionManager, contextUsage?: ContextUsage): SessionStats {
	let userMessages = 0;
	let assistantMessages = 0;
	let toolResults = 0;
	let totalMessages = 0;
	let toolCalls = 0;
	const usageTotals = createUsageTotals();
	for (const entry of manager.getEntries()) {
		if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsageToTotals(usageTotals, entry.usage);
		}
		if (entry.type !== "message") continue;
		totalMessages++;
		const message = entry.message;
		if (message.role === "user") userMessages++;
		else if (message.role === "toolResult") {
			toolResults++;
			if (message.usage) addUsageToTotals(usageTotals, message.usage);
		} else if (message.role === "assistant") {
			assistantMessages++;
			toolCalls += Array.isArray(message.content) ? message.content.filter((c) => c.type === "toolCall").length : 0;
			addUsageToTotals(usageTotals, message.usage);
		}
	}
	return {
		sessionFile: manager.getSessionFile(),
		sessionId: manager.getSessionId(),
		userMessages,
		assistantMessages,
		toolCalls,
		toolResults,
		totalMessages,
		tokens: {
			input: usageTotals.input,
			output: usageTotals.output,
			cacheRead: usageTotals.cacheRead,
			cacheWrite: usageTotals.cacheWrite,
			total: usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite,
		},
		cost: usageTotals.cost,
		contextUsage,
	};
}

/** Context usage is unknown after compaction until a successful response supplies fresh usage. */
export function getSessionContextUsage(
	manager: SessionManager,
	messages: AgentMessage[],
	contextWindow: number,
): ContextUsage | undefined {
	if (contextWindow <= 0) return undefined;
	const branch = manager.getBranch();
	const latest = getLatestCompactionEntry(branch);
	if (latest) {
		const hasFreshUsage = branch
			.slice(branch.lastIndexOf(latest) + 1)
			.some(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "assistant" &&
					entry.message.stopReason !== "aborted" &&
					entry.message.stopReason !== "error" &&
					calculateContextTokens(entry.message.usage) > 0,
			);
		if (!hasFreshUsage) return { tokens: null, contextWindow, percent: null };
	}
	const estimate = estimateContextTokens(messages);
	return { tokens: estimate.tokens, contextWindow, percent: (estimate.tokens / contextWindow) * 100 };
}
