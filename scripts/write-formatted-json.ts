import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "./process-runner.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const biomeCliPath = join(repositoryRoot, "node_modules", "@biomejs", "biome", "bin", "biome");
const biomeConfigPath = join(repositoryRoot, "biome.json");

export interface FormattedJsonFile {
  readonly path: string;
  readonly value: unknown;
}

export async function writeFormattedJsonFiles(files: readonly FormattedJsonFile[]): Promise<void> {
  if (files.length === 0) {
    return;
  }
  for (const file of files) {
    await writeFile(file.path, `${JSON.stringify(file.value, null, 2)}\n`);
  }
  await runProcess(
    process.execPath,
    [biomeCliPath, "format", "--write", `--config-path=${biomeConfigPath}`, "--vcs-enabled=false", ...files.map((file) => file.path)],
    {
      cwd: repositoryRoot,
    },
  );
}
