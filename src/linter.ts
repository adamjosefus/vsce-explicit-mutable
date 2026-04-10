import * as ts from 'typescript';
import * as vscode from 'vscode';
import type { CodeActionInfo, DiagnosticData, TextEdit } from './codeActions.js';

export const DIAGNOSTIC_SOURCE = 'mutable-linter';
export const DIAGNOSTIC_CODE = 'unannotated-mutable';

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
  return languageId === 'typescriptreact' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function visitNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[]
): void {
  const diagnostic = tryBuildDiagnostic(node, sourceFile, sourceText, document);
  if (diagnostic !== undefined) {
    diagnostics.push(diagnostic);
  }
  ts.forEachChild(node, (child) => visitNode(child, sourceFile, sourceText, document, diagnostics));
}

// Top-level dispatcher

function tryBuildDiagnostic(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (ts.isArrayTypeNode(node)) {
    return tryArrayDiagnostic(node, sourceFile, sourceText, document);
  }
  if (ts.isTupleTypeNode(node)) {
    return tryTupleDiagnostic(node, sourceFile, sourceText, document);
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    return tryGenericRefDiagnostic(node, sourceFile, sourceText, document);
  }
  if (ts.isMappedTypeNode(node)) {
    return tryMappedTypeDiagnostic(node, sourceFile, sourceText, document);
  }
  if (ts.isPropertySignature(node)) {
    return tryPropertySignatureDiagnostic(node, sourceFile, sourceText, document);
  }
  return undefined;
}

// Shared helpers

function hasMutableComment(node: ts.Node, sourceFile: ts.SourceFile, sourceText: string): boolean {
  const triviaStart = node.pos;
  const contentStart = node.getStart(sourceFile);
  if (triviaStart >= contentStart) {
    return false;
  }
  return sourceText.substring(triviaStart, contentStart).includes('/* mutable */');
}

function isReadonlyParent(node: ts.Node): boolean {
  return (
    node.parent !== undefined &&
    ts.isTypeOperatorNode(node.parent) &&
    node.parent.operator === ts.SyntaxKind.ReadonlyKeyword
  );
}

function ins(pos: number, text: string): TextEdit {
  return { start: pos, end: pos, newText: text };
}

function repl(start: number, end: number, text: string): TextEdit {
  return { start, end, newText: text };
}

function buildDiagnostic(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  document: vscode.TextDocument,
  message: string,
  actions: CodeActionInfo[]
): vscode.Diagnostic {
  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();
  const range = new vscode.Range(document.positionAt(nodeStart), document.positionAt(nodeEnd));
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = DIAGNOSTIC_CODE;
  (diagnostic as vscode.Diagnostic & { data: DiagnosticData }).data = { actions };
  return diagnostic;
}

function getTypeName(node: ts.TypeReferenceNode): string {
  return ts.isIdentifier(node.typeName) ? node.typeName.text : '';
}

function twoActions(readonlyEdit: TextEdit[], mutableEdit: TextEdit[]): CodeActionInfo[] {
  return [
    { label: 'Make readonly', isPreferred: true, edits: readonlyEdit },
    { label: 'Mark as mutable', isPreferred: false, edits: mutableEdit },
  ];
}

// Array types: T[]

function tryArrayDiagnostic(
  node: ts.ArrayTypeNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (isReadonlyParent(node)) {
    return undefined;
  }
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();

  // When this array is the element type of an outer array (T[][]),
  // plain `ins('readonly ')` would produce `readonly T[][]` which TypeScript
  // parses as `readonly (T[][])` — wrong. Wrap in parens using AST positions.
  if (ts.isArrayTypeNode(node.parent)) {
    return buildDiagnostic(
      node,
      sourceFile,
      document,
      'Array type is not annotated as mutable or readonly.',
      twoActions(
        [ins(nodeStart, '(readonly '), ins(nodeEnd, ')')],
        [ins(nodeStart, '(/* mutable */ '), ins(nodeEnd, ')')]
      )
    );
  }

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Array type is not annotated as mutable or readonly.',
    twoActions([ins(nodeStart, 'readonly ')], [ins(nodeStart, '/* mutable */ ')])
  );
}

// Tuple types: [T, U]

function tryTupleDiagnostic(
  node: ts.TupleTypeNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (isReadonlyParent(node)) {
    return undefined;
  }
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();

  // Same wrapping rule as arrays: [T][] must become (readonly [T])[]
  if (ts.isArrayTypeNode(node.parent)) {
    return buildDiagnostic(
      node,
      sourceFile,
      document,
      'Array type is not annotated as mutable or readonly.',
      twoActions(
        [ins(nodeStart, '(readonly '), ins(nodeEnd, ')')],
        [ins(nodeStart, '(/* mutable */ '), ins(nodeEnd, ')')]
      )
    );
  }

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Array type is not annotated as mutable or readonly.',
    twoActions([ins(nodeStart, 'readonly ')], [ins(nodeStart, '/* mutable */ ')])
  );
}

// Generic type references: Array<T>, Map<K,V>, Set<T>, Record<K,V>

function tryGenericRefDiagnostic(
  node: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  const name = getTypeName(node);
  if (name === 'Array') {
    return tryArrayRefDiagnostic(node, sourceFile, sourceText, document);
  }
  if (name === 'Map') {
    return tryMapDiagnostic(node, sourceFile, sourceText, document);
  }
  if (name === 'Set') {
    return trySetDiagnostic(node, sourceFile, sourceText, document);
  }
  if (name === 'Record') {
    return tryRecordDiagnostic(node, sourceFile, sourceText, document);
  }
  return undefined;
}

// Array<T> — normalize to shorthand -----------------------------------------

function tryArrayRefDiagnostic(
  node: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (isReadonlyParent(node)) {
    return undefined;
  }
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }
  if (!node.typeArguments || node.typeArguments.length === 0) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();
  const typeArg = node.typeArguments[0];
  const typeArgStart = typeArg.getStart(sourceFile);
  const typeArgEnd = typeArg.getEnd();
  // Transform Array<T> → readonly T[] using only AST node positions:
  //   replace "Array<" with "readonly "  →  repl(nodeStart, typeArgStart, 'readonly ')
  //   replace ">"      with "[]"         →  repl(typeArgEnd, nodeEnd, '[]')

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Array type is not annotated as mutable or readonly.',
    twoActions(
      [repl(nodeStart, typeArgStart, 'readonly '), repl(typeArgEnd, nodeEnd, '[]')],
      [repl(nodeStart, typeArgStart, '/* mutable */ '), repl(typeArgEnd, nodeEnd, '[]')]
    )
  );
}

// Map<K, V> -----------------------------------------------------------------

function tryMapDiagnostic(
  node: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }
  if (!node.typeArguments || node.typeArguments.length < 2) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const typeNameEnd = node.typeName.getEnd();

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Map type is not annotated as mutable or readonly.',
    twoActions([repl(nodeStart, typeNameEnd, 'ReadonlyMap')], [ins(nodeStart, '/* mutable */ ')])
  );
}

// Set<T> --------------------------------------------------------------------

function trySetDiagnostic(
  node: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }
  if (!node.typeArguments || node.typeArguments.length === 0) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const typeNameEnd = node.typeName.getEnd();

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Set type is not annotated as mutable or readonly.',
    twoActions([repl(nodeStart, typeNameEnd, 'ReadonlySet')], [ins(nodeStart, '/* mutable */ ')])
  );
}

// Record<K, V> --------------------------------------------------------------

function tryRecordDiagnostic(
  node: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  // Already readonly: wrapped in Readonly<...>
  if (ts.isTypeReferenceNode(node.parent) && getTypeName(node.parent) === 'Readonly') {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Record type is not annotated as mutable or readonly.',
    twoActions([ins(nodeStart, 'Readonly<'), ins(nodeEnd, '>')], [ins(nodeStart, '/* mutable */ ')])
  );
}

// Mapped types: { [K in keyof T]: V }

function tryMappedTypeDiagnostic(
  node: ts.MappedTypeNode,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  if (node.readonlyToken !== undefined) {
    return undefined;
  }
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();

  // Find the '[' by scanning forward from the '{' (nodeStart)
  let bracketPos = nodeStart + 1;
  while (bracketPos < nodeEnd && sourceText[bracketPos] !== '[') {
    bracketPos++;
  }

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Mapped type is not annotated as mutable or readonly.',
    twoActions([ins(bracketPos, 'readonly ')], [ins(nodeStart, '/* mutable */ ')])
  );
}

// Object property signatures: { a: T }

function tryPropertySignatureDiagnostic(
  node: ts.PropertySignature,
  sourceFile: ts.SourceFile,
  sourceText: string,
  document: vscode.TextDocument
): vscode.Diagnostic | undefined {
  // Only flag properties inside a plain object type literal (not interface/class)
  if (!ts.isTypeLiteralNode(node.parent)) {
    return undefined;
  }

  // Already readonly
  const hasReadonly =
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
  if (hasReadonly) {
    return undefined;
  }

  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  const propStart = node.getStart(sourceFile);

  return buildDiagnostic(
    node,
    sourceFile,
    document,
    'Property is not annotated as mutable or readonly.',
    twoActions([ins(propStart, 'readonly ')], [ins(propStart, '/* mutable */ ')])
  );
}
