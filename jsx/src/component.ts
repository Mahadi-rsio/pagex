import * as t from "@babel/types";

export function wrapInComponent(
  element: t.Expression,
  name: string,
): t.Program {
  const arrow = t.arrowFunctionExpression([], element, false);
  arrow.returnType = t.tsTypeAnnotation(
    t.tsTypeReference(t.identifier("JSX.Element")),
  );
  const declarator = t.variableDeclarator(t.identifier(name), arrow);
  const declaration = t.variableDeclaration("const", [declarator]);
  return t.program([t.exportNamedDeclaration(declaration)]);
}
