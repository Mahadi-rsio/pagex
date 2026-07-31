import * as t from "@babel/types";
import { parseExpression } from "@babel/parser";
import { createRequire } from "node:module";
import type { TraverseOptions } from "@babel/traverse";

const require = createRequire(import.meta.url);
const traverseModule = require("@babel/traverse") as {
  default?: (parent: t.Node, opts: TraverseOptions) => void;
};
const traverse = (traverseModule.default ?? traverseModule) as (
  parent: t.Node,
  opts: TraverseOptions,
) => void;

export interface DeclNode {
  name?: string;
  tag?: string;
  props?: Record<string, unknown>;
  children?: DeclChild[];
}

export type DeclChild = string | number | boolean | DeclNode;

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isDeclarative(tree: Record<string, unknown>): boolean {
  return typeof tree.type !== "string";
}

export function declToProgram(tree: DeclNode): t.Program {
  const name =
    tree.name && IDENTIFIER_RE.test(tree.name) ? tree.name : "App";
  const free = collectExprIdentifiers(tree);
  const element = rootToExpression(tree);

  const body: t.Statement[] = [];
  if (free.length > 0) {
    body.push(propsInterface(name, free));
  }
  body.push(exportComponent(name, free, element));
  return t.program(body);
}

function propsInterface(
  name: string,
  free: string[],
): t.TSInterfaceDeclaration {
  const body = t.tsInterfaceBody(
    free.map((id) =>
      t.tsPropertySignature(
        t.identifier(id),
        t.tsTypeAnnotation(t.tsAnyKeyword()),
      ),
    ),
  );
  return t.tsInterfaceDeclaration(t.identifier(`${name}Props`), null, null, body);
}

function exportComponent(
  name: string,
  free: string[],
  element: t.Expression,
): t.ExportNamedDeclaration {
  const pattern = t.objectPattern(
    free.map((id) =>
      t.objectProperty(t.identifier(id), t.identifier(id), false, true),
    ),
  );
  if (free.length > 0) {
    pattern.typeAnnotation = t.tsTypeAnnotation(
      t.tsTypeReference(t.identifier(`${name}Props`)),
    );
  }
  const params: t.ObjectPattern[] = free.length > 0 ? [pattern] : [];
  const arrow = t.arrowFunctionExpression(params, element, false);
  arrow.returnType = t.tsTypeAnnotation(
    t.tsTypeReference(t.identifier("JSX.Element")),
  );
  const declarator = t.variableDeclarator(t.identifier(name), arrow);
  const declaration = t.variableDeclaration("const", [declarator]);
  return t.exportNamedDeclaration(declaration);
}

function rootToExpression(tree: DeclNode): t.Expression {
  if (tree.tag) {
    return elementToJsx(tree as Required<DeclNode>);
  }
  const children = normalizeChildren(tree.children).map(childToJsx);
  return t.jsxFragment(
    t.jsxOpeningFragment(),
    t.jsxClosingFragment(),
    children,
  );
}

function elementToJsx(node: Required<DeclNode>): t.JSXElement {
  const name = tagToName(node.tag);
  const attributes = buildAttributes(node.props ?? {});
  const children = normalizeChildren(node.children).map(childToJsx);
  const selfClosing = children.length === 0;
  const opening = t.jsxOpeningElement(name, attributes, selfClosing);
  const closing = selfClosing ? null : t.jsxClosingElement(name);
  return t.jsxElement(opening, closing, children, selfClosing);
}

function normalizeChildren(
  children: DeclNode["children"],
): DeclChild[] {
  if (children === undefined) {
    return [];
  }
  return Array.isArray(children) ? children : [children as DeclChild];
}

function tagToName(tag: string): t.JSXIdentifier | t.JSXMemberExpression {
  const parts = tag.split(".");
  let node: t.JSXIdentifier | t.JSXMemberExpression = t.jsxIdentifier(parts[0]);
  for (const part of parts.slice(1)) {
    node = t.jsxMemberExpression(node, t.jsxIdentifier(part));
  }
  return node;
}

function buildAttributes(
  props: Record<string, unknown>,
): t.JSXAttribute[] {
  return Object.entries(props).flatMap(([key, value]) => {
    const attrName = key.includes(":")
      ? t.jsxNamespacedName(
          t.jsxIdentifier(key.split(":")[0]),
          t.jsxIdentifier(key.split(":")[1]),
        )
      : t.jsxIdentifier(key);
    if (value === null) {
      return [t.jsxAttribute(attrName, null)];
    }
    if (value === undefined) {
      return [];
    }
    return [t.jsxAttribute(attrName, propValueToNode(value))];
  });
}

function propValueToNode(
  value: unknown,
): t.StringLiteral | t.JSXExpressionContainer {
  if (typeof value === "string") {
    return t.stringLiteral(value);
  }
  if (typeof value === "number") {
    return t.jsxExpressionContainer(t.numericLiteral(value));
  }
  if (typeof value === "boolean") {
    return t.jsxExpressionContainer(t.booleanLiteral(value));
  }
  if (typeof value === "object" && value !== null && isExpr(value)) {
    return t.jsxExpressionContainer(parseExpression(value.expr, {
      plugins: ["jsx", "typescript"],
    }));
  }
  throw new Error(
    `Unsupported prop value for key: ${JSON.stringify(value)}`,
  );
}

type JSXChild =
  | t.JSXElement
  | t.JSXFragment
  | t.JSXText
  | t.JSXExpressionContainer;

function childToJsx(child: DeclChild): JSXChild {
  if (typeof child === "string") {
    return t.jsxText(child);
  }
  if (typeof child === "number" || typeof child === "boolean") {
    return t.jsxText(String(child));
  }
  if (typeof child !== "object" || child === null) {
    throw new Error(`Unsupported child: ${JSON.stringify(child)}`);
  }
  if (isText(child)) {
    return t.jsxText(child.text);
  }
  if (isExpr(child)) {
    return t.jsxExpressionContainer(parseExpression(child.expr, {
      plugins: ["jsx", "typescript"],
    }));
  }
  if (child.tag) {
    return elementToJsx(child as Required<DeclNode>);
  }
  throw new Error(`Unsupported child node: ${JSON.stringify(child)}`);
}

function collectExprIdentifiers(tree: DeclNode): string[] {
  const exprs: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value !== "object" || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const node = value as Record<string, unknown>;
    if (typeof node.expr === "string") {
      exprs.push(node.expr);
    }
    for (const child of Object.values(node)) {
      walk(child);
    }
  };
  walk(tree);
  return collectFreeIdentifiers(exprs);
}

function collectFreeIdentifiers(exprs: string[]): string[] {
  const free = new Set<string>();
  for (const src of exprs) {
    const expr = parseExpression(src, {
      plugins: ["jsx", "typescript"],
    });
    const file = t.file(t.program([t.expressionStatement(expr)]));
    traverse(file, {
      Identifier(path) {
        if (!path.isReferencedIdentifier()) return;
        if (path.scope.hasBinding(path.node.name)) return;
        free.add(path.node.name);
      },
    });
  }
  return [...free].sort();
}

function isText(node: object): node is { text: string } {
  return typeof (node as { text?: unknown }).text === "string";
}

function isExpr(node: object): node is { expr: string } {
  return typeof (node as { expr?: unknown }).expr === "string";
}
