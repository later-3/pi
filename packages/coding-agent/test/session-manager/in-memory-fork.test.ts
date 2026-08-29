import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

describe("SessionManager.forkInMemory", () => {
	it("copies the active branch without modifying the source", () => {
		const source = SessionManager.inMemory("/workspace");
		source.appendMessage({ role: "user", content: "original", timestamp: 1 });
		source.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "answer" }],
			api: "test",
			provider: "test",
			model: "test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});

		const fork = SessionManager.forkInMemory(source);
		fork.appendMessage({ role: "user", content: "detached", timestamp: 3 });

		expect(fork.isPersisted()).toBe(false);
		expect(fork.buildSessionContext().messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
		expect(source.buildSessionContext().messages.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	it("can explicitly flush a persistent Session before an assistant reply", () => {
		const root = mkdtempSync(join(tmpdir(), "pi-session-flush-"));
		try {
			const manager = SessionManager.create("/workspace", root);
			manager.appendCustomEntry("workflow.pending", { stage: "plan" });
			const sessionFile = manager.getSessionFile();
			expect(sessionFile).toBeDefined();
			expect(existsSync(sessionFile!)).toBe(false);

			manager.flush();

			expect(existsSync(sessionFile!)).toBe(true);
			expect(readFileSync(sessionFile!, "utf8")).toContain("workflow.pending");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("applies the same context filter to restore, compaction input, and in-memory forks", () => {
		const source = SessionManager.inMemory("/workspace");
		source.appendMessage({ role: "user", content: "real request", timestamp: 1 });
		source.appendCustomMessageEntry("legacy-handoff", "internal", false);
		source.setContextEntryFilter((entry) => entry.type !== "custom_message" || entry.customType !== "legacy-handoff");

		expect(source.getBranch().some((entry) => entry.type === "custom_message")).toBe(true);
		expect(source.getContextBranch().some((entry) => entry.type === "custom_message")).toBe(false);
		expect(source.buildSessionContext().messages.map((message) => message.role)).toEqual(["user"]);

		const fork = SessionManager.forkInMemory(source);
		expect(fork.getBranch().some((entry) => entry.type === "custom_message")).toBe(false);
	});
});
