import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".");
const outputRelativePath = "artifacts/milestone-2-sha256-manifest.json";
const excludedDirectories = new Set([".git", "node_modules"]);

const walk = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (excludedDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (entry.isDirectory()) files.push(...(await walk(absolutePath)));
    else if (!relativePath.endsWith(".zip")) files.push(relativePath);
  }
  return files;
};

const files = [...new Set([...(await walk(root)), outputRelativePath])].sort();
const entries = await Promise.all(
  files.map(async (file) => {
    if (file === outputRelativePath) {
      return { path: file, sha256: null };
    }
    const bytes = await fs.readFile(path.join(root, file));
    return {
      path: file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }),
);

await fs.mkdir(path.dirname(path.join(root, outputRelativePath)), {
  recursive: true,
});
await fs.writeFile(
  path.join(root, outputRelativePath),
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      scope: "All strict Milestone 2 project files; node_modules and archives excluded",
      files: entries,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(path.join(root, outputRelativePath));
