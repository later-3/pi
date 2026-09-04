#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateGeneratedModelData } from "../packages/ai/scripts/model-data.ts";

const PINNED_MODEL_DATA_VERSION = "0.84.4";
const PINNED_MODEL_DATA_URL =
	`https://github.com/earendil-works/pi/releases/download/v${PINNED_MODEL_DATA_VERSION}/pi-${PINNED_MODEL_DATA_VERSION}-source.tar.gz`;
const PINNED_MODEL_DATA_SHA256 = "ca3958559b60f87ee44c84d94df8c3ee0b7eda575370402abb2d0ad9155cde4a";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const aiPackageRoot = join(repositoryRoot, "packages", "ai");
const providersRoot = join(aiPackageRoot, "src", "providers");
const destination = join(providersRoot, "data");

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function downloadPinnedArchive(path: string): Promise<void> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await fetch(PINNED_MODEL_DATA_URL, {
				redirect: "follow",
				signal: AbortSignal.timeout(60_000),
			});
			if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			const digest = createHash("sha256").update(bytes).digest("hex");
			if (digest !== PINNED_MODEL_DATA_SHA256) {
				throw new Error(`model data archive SHA256 mismatch: expected ${PINNED_MODEL_DATA_SHA256}, received ${digest}`);
			}
			await writeFile(path, bytes, { mode: 0o600 });
			return;
		} catch (error) {
			lastError = error;
			if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
		}
	}
	throw lastError;
}

function extractArchive(archivePath: string, extractionRoot: string): void {
	const result = spawnSync("tar", ["-xzf", archivePath, "-C", extractionRoot], {
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr.trim() || `tar exited with status ${String(result.status)}`);
}

async function validateCandidate(candidate: string, workingRoot: string): Promise<void> {
	const validationPackageRoot = join(workingRoot, "validation", "packages", "ai");
	const validationProvidersRoot = join(validationPackageRoot, "src", "providers");
	await mkdir(validationProvidersRoot, { recursive: true });
	await cp(join(aiPackageRoot, "src", "models.generated.ts"), join(validationPackageRoot, "src", "models.generated.ts"));
	for (const entry of await readdir(providersRoot)) {
		if (entry.endsWith(".models.ts")) await cp(join(providersRoot, entry), join(validationProvidersRoot, entry));
	}
	await cp(candidate, join(validationProvidersRoot, "data"), { recursive: true });
	validateGeneratedModelData(validationPackageRoot);
}

async function replaceModelData(candidate: string): Promise<void> {
	const suffix = `${String(process.pid)}-${String(Date.now())}`;
	const staged = join(providersRoot, `.model-data-staged-${suffix}`);
	const backup = join(providersRoot, `.model-data-backup-${suffix}`);
	await cp(candidate, staged, { recursive: true });
	const hadDestination = await pathExists(destination);
	if (hadDestination) await rename(destination, backup);
	try {
		await rename(staged, destination);
	} catch (error) {
		if (hadDestination) await rename(backup, destination);
		throw error;
	}
	if (hadDestination) await rm(backup, { recursive: true });
}

async function main(): Promise<void> {
	const workingRoot = await mkdtemp(join(tmpdir(), "pi-model-data-"));
	try {
		const archivePath = join(workingRoot, basename(PINNED_MODEL_DATA_URL));
		const extractionRoot = join(workingRoot, "archive");
		await mkdir(extractionRoot);
		await downloadPinnedArchive(archivePath);
		extractArchive(archivePath, extractionRoot);
		const candidate = join(
			extractionRoot,
			`pi-${PINNED_MODEL_DATA_VERSION}`,
			"packages",
			"ai",
			"src",
			"providers",
			"data",
		);
		await validateCandidate(candidate, workingRoot);
		await replaceModelData(candidate);
		console.log(`Restored pinned model data v${PINNED_MODEL_DATA_VERSION} (${PINNED_MODEL_DATA_SHA256}).`);
	} finally {
		await rm(workingRoot, { recursive: true, force: true });
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
