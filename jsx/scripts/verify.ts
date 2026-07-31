import { generateFile } from "../src/generate.ts";
import { parse } from "@babel/parser";

async function assertComponent(input: string, name: string): Promise<void> {
  const code = await generateFile(input);

  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  const exportDecl = ast.program.body.find(
    (node) => node.type === "ExportNamedDeclaration",
  );
  if (!exportDecl || exportDecl.type !== "ExportNamedDeclaration") {
    throw new Error(`${input}: expected export`);
  }
  const vd = exportDecl.declaration;
  if (
    vd?.type !== "VariableDeclaration" ||
    vd.declarations[0].id.type !== "Identifier" ||
    vd.declarations[0].id.name !== name
  ) {
    throw new Error(`${input}: expected const ${name}`);
  }
  const fn = vd.declarations[0].init;
  if (fn?.type !== "ArrowFunctionExpression" || !fn.returnType) {
    throw new Error(`${input}: expected typed arrow function`);
  }
  if (
    fn.body.type !== "JSXElement" &&
    fn.body.type !== "JSXFragment"
  ) {
    throw new Error(`${input}: expected JSX body`);
  }
  console.log(code);
  console.log(`OK: ${input} -> valid TSX ${name}\n`);
}

await assertComponent("examples/card.json", "App");
await assertComponent("examples/hero.json", "Hero");
await assertComponent("/tmp/opencode/img.json", "Icon");
