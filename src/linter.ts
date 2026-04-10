import * as vscode from "vscode";
import * as ts from "typescript";
import type { DiagnosticData } from "./codeActions.js";

export const DIAGNOSTIC_SOURCE = "mutable-array";
export const DIAGNOSTIC_CODE = "unannotated-mutable-array";

export function lintDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
  const sourceText = document.getText();
  const sourceFile = ts.createSourceFile(
    document.fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    getScriptKind(document.languageId)
  );

  const diagnostics: vscode.Diagnostic[] = [];
  visitNode(sourceFile, sourceFile, sourceText, document, diagnostics);
  return diagnostics;
}

function getScriptKind(languageId: string): ts.ScriptKind {
  return languageId === "typescriptreact" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function visitNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[]
): void {
  if (isMutableArrayType(node, sourceFile, sourceText)) {
    diagnostics.push(buildDiagnostic(node, sourceFile, document));
  }
  ts.forEachChild(node, (child) =>
    visitNode(child, sourceFile, sourceText, document, diagnostics)
  );
}

function isMutableArrayType(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sourceText: string
): boolean {
  const isArrayForm =
    ts.isArrayTypeNode(node) ||
    ts.isTupleTypeNode(node) ||
    isArrayReference(node);

  if (!isArrayForm) return false;

  // Already readonly: readonly T[] or readonly [T, U]
  // TypeScript represents "readonly T[]" as TypeOperatorNode { operator: ReadonlyKeyword }
  if (
    node.parent !== undefined &&
    ts.isTypeOperatorNode(node.parent) &&
    node.parent.operator === ts.SyntaxKind.ReadonlyKeyword
  ) {
    return false;
  }

  // Already readonly: ReadonlyArray<T>
  if (isReadonlyArrayReference(node)) {
    return false;
  }

  // Exempted with /* mutable */ comment in leading trivia
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return false;
  }

  return true;
}

function isArrayReference(node: ts.Node): boolean {
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Array"
  );
}

function isReadonlyArrayReference(node: ts.Node): boolean {
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "ReadonlyArray"
  );
}

function hasMutableComment(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sourceText: string
): boolean {
  const triviaStart = node.pos;
  const contentStart = node.getStart(sourceFile);
  if (triviaStart >= contentStart) return false;
  const trivia = sourceText.substring(triviaStart, contentStart);
  return trivia.includes("/* mutable */");
}

function buildDiagnostic(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument
): vscode.Diagnostic {
  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();

  const range = new vscode.Range(
    document.positionAt(nodeStart),
    document.positionAt(nodeEnd)
  );

  const diagnostic = new vscode.Diagnostic(
    range,
    "Array type is not annotated as mutable or readonly.",
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = DIAGNOSTIC_CODE;

  const data: DiagnosticData = {
    kind: classifyNode(node),
    nodeStart,
    nodeEnd,
    typeNameEnd: ts.isTypeReferenceNode(node)
      ? node.typeName.getEnd()
      : undefined,
  };
  (diagnostic as vscode.Diagnostic & { data: DiagnosticData }).data = data;

  return diagnostic;
}

function classifyNode(node: ts.Node): DiagnosticData["kind"] {
  if (ts.isArrayTypeNode(node)) return "array";
  if (ts.isTupleTypeNode(node)) return "tuple";
  return "generic";
}
