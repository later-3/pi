import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { getExportTemplateDir, getThemesDir } from "../src/config.ts";
import { exportFromFile, exportSessionToHtml, SessionManager } from "../src/index.ts";

test("standalone SDK export retains all branches without mutating the session", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-sdk-export-"));
	try {
		const manager = SessionManager.create(root, root);
		const first = manager.appendMessage({ role: "user", content: "First branch", timestamp: 1 });
		manager.appendCustomEntry("test.result", { value: "retained" });
		manager.branch(first);
		manager.appendMessage({ role: "user", content: "Second branch", timestamp: 2 });
		manager.flush();
		const source = manager.getSessionFile()!;
		const before = readFileSync(source, "utf8");
		const htmlPath = await exportSessionToHtml(manager, undefined, {
			outputPath: join(root, "manager.html"),
			themeName: "dark",
		});
		const filePath = await exportFromFile(source, { outputPath: join(root, "file.html"), themeName: "dark" });
		const html = readFileSync(htmlPath, "utf8");
		expect(readFileSync(filePath, "utf8")).toBe(html);
		const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
		expect(encoded).toBeDefined();
		const data = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
		expect(data.entries).toEqual(manager.getEntries());
		expect(data.leafId).toBe(manager.getLeafId());
		expect(readFileSync(source, "utf8")).toBe(before);
		const relocated = join(root, "relocated");
		mkdirSync(relocated);
		cpSync(getExportTemplateDir(), relocated, { recursive: true });
		cpSync(join(getThemesDir(), "dark.json"), join(relocated, "dark.json"));
		const originalPackageDir = process.env.PI_PACKAGE_DIR;
		try {
			process.env.PI_PACKAGE_DIR = join(root, "absent-package");
			const options = {
				outputPath: join(root, "relocated.html"),
				templateDir: relocated,
				themeFile: join(relocated, "dark.json"),
			};
			expect(readFileSync(await exportSessionToHtml(manager, undefined, options), "utf8")).toBe(html);
			expect(readFileSync(await exportFromFile(source, options), "utf8")).toBe(html);
			await expect(exportFromFile(source, { ...options, themeFile: join(root, "absent-theme") })).rejects.toThrow();
		} finally {
			if (originalPackageDir === undefined) delete process.env.PI_PACKAGE_DIR;
			else process.env.PI_PACKAGE_DIR = originalPackageDir;
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
