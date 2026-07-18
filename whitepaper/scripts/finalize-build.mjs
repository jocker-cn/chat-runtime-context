import { readdir, readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(import.meta.dirname, "../dist");
const sourceFile = resolve(outputDirectory, "index.html");
const targetFile = resolve(outputDirectory, "ChatRuntimeCoreWhitepaper.html");

await rename(sourceFile, targetFile);

const files = await readdir(outputDirectory, { recursive: true });
if (files.length !== 1 || files[0] !== "ChatRuntimeCoreWhitepaper.html") {
  throw new Error(
    `Whitepaper build must contain exactly one HTML file. Found: ${files.join(", ")}`,
  );
}

const html = await readFile(targetFile, "utf8");
const externalAssets = [
  /<script[^>]+src=/i,
  /<link[^>]+rel=["']stylesheet["'][^>]+href=/i,
  /<img[^>]+src=(?!["']data:)/i,
];

if (externalAssets.some((pattern) => pattern.test(html))) {
  throw new Error("Whitepaper HTML still references an external asset.");
}

console.log(`Verified standalone whitepaper: ${targetFile}`);
