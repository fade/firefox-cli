import { mkdir, readFile, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { baseDependencies } from "./cli-test-support.js";
import { runCli } from "./index.js";

describe("runCli doctor manifest read failures", () => {
  it.each([
    { format: "text", fix: false },
    { format: "text", fix: true },
    { format: "json", fix: false },
    { format: "json", fix: true },
  ])("reports an actionable $format error without replacing the manifest path (fix: $fix)", async ({ format, fix }) => {
    const homeDir = await createTempDir("firefox-cli-doctor-unreadable-manifest");
    const manifestPath = posix.join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json");
    const preservedFile = posix.join(manifestPath, "preserve.txt");
    await mkdir(manifestPath, { recursive: true });
    await writeFile(preservedFile, "keep");

    const args = ["doctor", ...(fix ? ["--fix"] : []), ...(format === "json" ? ["--json"] : [])];
    const result = await runCli(args, { ...baseDependencies(), homeDir, platform: "darwin" });
    const errorOutput = format === "json" ? result.stdout : result.stderr;

    expect(result.exitCode).toBe(1);
    expect(format === "json" ? result.stderr : result.stdout).toBe("");
    expect(errorOutput).toContain(manifestPath);
    expect(errorOutput).toContain("EISDIR");
    expect(errorOutput).toContain(fix ? "firefox-cli doctor --fix" : "firefox-cli doctor");
    if (format === "json") {
      const payload: unknown = JSON.parse(result.stdout);
      expect(payload).toBeTruthy();
      expect(result.stdout).toContain('"step": "manifest-read"');
      expect(result.stdout).toContain('"filesystemCode": "EISDIR"');
      expect(result.stdout).toContain('"cause": "EISDIR:');
    } else {
      expect(errorOutput).toContain("Next action:");
    }
    await expect(readFile(preservedFile, "utf8")).resolves.toBe("keep");
  });
});
