import * as Ts from 'typescript';
import * as VScode from 'vscode';
import type { CodeActionInfo, DiagnosticData, TextEdit } from './codeActions.js';

export const DIAGNOSTIC_SOURCE = 'explicit-mutable';
export const DIAGNOSTIC_CODE = 'unannotated-type';

export function lintDocument(document: VScode.TextDocument): readonly VScode.Diagnostic[] {
  const sourceText = document.getText();
  const sourceFile = Ts.createSourceFile(
    document.fileName,
    sourceText,
    Ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    getScriptKind(document.languageId)
  );

  return visitNode(sourceFile, sourceFile, sourceText, document);
}

function getScriptKind(languageId: string): Ts.ScriptKind {
  return languageId === 'typescriptreact' ? Ts.ScriptKind.TSX : Ts.ScriptKind.TS;
}

function collectChildren(node: Ts.Node): readonly Ts.Node[] {
  const children: /* mutable */ Ts.Node[] = [];

  Ts.forEachChild(node, (child) => {
    children.push(child);
  });

  return children;
}

function visitNode(
  node: Ts.Node,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): readonly VScode.Diagnostic[] {
  const own = tryBuildDiagnostic(node, sourceFile, sourceText, document);
  const childDiagnostics = collectChildren(node).flatMap((child) =>
    visitNode(child, sourceFile, sourceText, document)
  );
  return own !== undefined ? [own, ...childDiagnostics] : childDiagnostics;
}

// Top-level dispatcher

function tryBuildDiagnostic(
  node: Ts.Node,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
  if (Ts.isArrayTypeNode(node)) {
    return tryArrayDiagnostic(node, sourceFile, sourceText, document);
  }
  if (Ts.isTupleTypeNode(node)) {
    return tryTupleDiagnostic(node, sourceFile, sourceText, document);
  }
  if (Ts.isTypeReferenceNode(node) && Ts.isIdentifier(node.typeName)) {
    return tryGenericRefDiagnostic(node, sourceFile, sourceText, document);
  }
  if (Ts.isMappedTypeNode(node)) {
    return tryMappedTypeDiagnostic(node, sourceFile, sourceText, document);
  }
  if (Ts.isPropertySignature(node)) {
    return tryPropertySignatureDiagnostic(node, sourceFile, sourceText, document);
  }
  return undefined;
}

// Shared helpers

function hasMutableComment(node: Ts.Node, sourceFile: Ts.SourceFile, sourceText: string): boolean {
  const triviaStart = node.pos;
  const contentStart = node.getStart(sourceFile);
  if (triviaStart >= contentStart) {
    return false;
  }
  return sourceText.substring(triviaStart, contentStart).includes('/* mutable */');
}

function isReadonlyParent(node: Ts.Node): boolean {
  return (
    node.parent !== undefined &&
    Ts.isTypeOperatorNode(node.parent) &&
    node.parent.operator === Ts.SyntaxKind.ReadonlyKeyword
  );
}

function ins(pos: number, text: string): TextEdit {
  return { start: pos, end: pos, newText: text };
}

function repl(start: number, end: number, text: string): TextEdit {
  return { start, end, newText: text };
}

function buildDiagnostic(
  node: Ts.Node,
  sourceFile: Ts.SourceFile,
  document: VScode.TextDocument,
  message: string,
  actions: readonly CodeActionInfo[]
): VScode.Diagnostic {
  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();
  const range = new VScode.Range(document.positionAt(nodeStart), document.positionAt(nodeEnd));
  const diagnostic = new VScode.Diagnostic(range, message, VScode.DiagnosticSeverity.Warning);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = DIAGNOSTIC_CODE;
  (diagnostic as VScode.Diagnostic & { /* mutable */ data: DiagnosticData }).data = { actions };

  return diagnostic;
}

function getTypeName(node: Ts.TypeReferenceNode): string {
  return Ts.isIdentifier(node.typeName) ? node.typeName.text : '';
}

function twoActions(
  readonlyEdit: readonly TextEdit[],
  mutableEdit: readonly TextEdit[]
): readonly CodeActionInfo[] {
  return [
    { label: 'Make readonly', isPreferred: true, edits: readonlyEdit },
    { label: 'Mark as mutable', isPreferred: false, edits: mutableEdit },
  ];
}

// Array types: T[]

function tryArrayDiagnostic(
  node: Ts.ArrayTypeNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
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
  if (Ts.isArrayTypeNode(node.parent)) {
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
  node: Ts.TupleTypeNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
  if (isReadonlyParent(node)) {
    return undefined;
  }
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();

  // Same wrapping rule as arrays: [T][] must become (readonly [T])[]
  if (Ts.isArrayTypeNode(node.parent)) {
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
  node: Ts.TypeReferenceNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
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

// Array<T> — normalize to shorthand

function tryArrayRefDiagnostic(
  node: Ts.TypeReferenceNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
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

// Map<K, V>

function tryMapDiagnostic(
  node: Ts.TypeReferenceNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
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

// Set<T>---

function trySetDiagnostic(
  node: Ts.TypeReferenceNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
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

// Record<K, V>

function tryRecordDiagnostic(
  node: Ts.TypeReferenceNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  // Already readonly: wrapped in Readonly<...>
  if (Ts.isTypeReferenceNode(node.parent) && getTypeName(node.parent) === 'Readonly') {
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
  node: Ts.MappedTypeNode,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
  if (node.readonlyToken !== undefined) {
    return undefined;
  }

  if (hasMutableComment(node, sourceFile, sourceText)) {
    return undefined;
  }

  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();

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
  node: Ts.PropertySignature,
  sourceFile: Ts.SourceFile,
  sourceText: string,
  document: VScode.TextDocument
): VScode.Diagnostic | undefined {
  // Only flag properties inside a plain object type literal (not interface/class)
  if (!Ts.isTypeLiteralNode(node.parent)) {
    return undefined;
  }

  // Already readonly
  const hasReadonly =
    node.modifiers?.some((m) => m.kind === Ts.SyntaxKind.ReadonlyKeyword) ?? false;
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
