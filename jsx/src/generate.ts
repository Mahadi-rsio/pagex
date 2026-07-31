import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "@babel/generator";
import { format } from "prettier";
import * as t from "@babel/types";
import { wrapInComponent } from "./component.js";
import { declToProgram, isDeclarative } from "./declarative.js";

export type JsonNode = Record<string, unknown>;

export function jsonToProgram(root: JsonNode): t.Program {
  if (isDeclarative(root)) {
    return declToProgram(root);
  }
  const type = root.type as string;
  if (type === "File") {
    return root.program as t.Program;
  }
  if (type === "Program") {
    return root as unknown as t.Program;
  }
  return wrapInComponent(root as unknown as t.Expression, "App");
}

export function componentName(root: JsonNode): string | undefined {
  if (typeof root.name === "string") {
    return root.name;
  }
  return undefined;
}

export async function generateFile(inputPath: string): Promise<string> {
  const raw = readFileSync(inputPath, "utf8");
  const tree = JSON.parse(raw) as JsonNode;
  const code =
    generate(jsonToProgram(tree), { jsescOption: { minimal: true } }).code +
    "\n";
  return prettify(code);
}

export async function prettify(code: string): Promise<string> {
  return format(code, { parser: "typescript", printWidth: 80 });
}

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error("Usage: npm run generate -- <input.json> [output.tsx]");
    process.exit(1);
  }
  const raw = readFileSync(input, "utf8");
  const tree = JSON.parse(raw) as JsonNode;
  const code = await prettify(
    generate(jsonToProgram(tree), { jsescOption: { minimal: true } }).code +
      "\n",
  );
  const name = componentName(tree);
  const base = name ?? basename(input, ".json");
  const out = output ?? join("out", `${base}.tsx`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, code, "utf8");
  console.log(`Wrote ${out}`);
}

const isEntry =
  !!process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isEntry) {
  void main();
}
