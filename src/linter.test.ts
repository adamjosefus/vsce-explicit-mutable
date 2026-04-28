import { describe, expect, it } from 'vitest';
import type * as VScode from 'vscode';
import type { DiagnosticData, TextEdit } from './codeActions.js';
import { DIAGNOSTIC_CODE, DIAGNOSTIC_SOURCE, lintDocument } from './linter.js';

// helpers

function makeDoc(source: string, languageId = 'typescript') {
  return {
    getText: () => source,
    fileName: 'test.ts',
    languageId,
    positionAt: (offset: number) => {
      const before = source.slice(0, offset);
      const lines = before.split('\n');
      return { line: lines.length - 1, character: lines[lines.length - 1].length };
    },
  } as unknown as VScode.TextDocument;
}

function lint(source: string, languageId?: string) {
  return lintDocument(makeDoc(source, languageId));
}

function getActions(diagnostic: VScode.Diagnostic) {
  return (diagnostic as unknown as { data: DiagnosticData }).data.actions;
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, { start, end, newText }) => text.slice(0, start) + newText + text.slice(end),
      source
    );
}

function fix(source: string, diagnostic: VScode.Diagnostic, actionIndex: number): string {
  return applyEdits(source, getActions(diagnostic)[actionIndex].edits);
}

// diagnostic metadata

describe('diagnostic metadata', () => {
  it('sets the correct source and code', () => {
    const diags = lint('type A = string[]');
    expect(diags).toHaveLength(1);
    expect(diags[0].source).toBe(DIAGNOSTIC_SOURCE);
    expect(diags[0].code).toBe(DIAGNOSTIC_CODE);
  });
});

// Array T[]

describe('Array T[]', () => {
  it('flags unannotated array', () => {
    expect(lint('type A = string[]')).toHaveLength(1);
  });

  it('does not flag readonly array', () => {
    expect(lint('type A = readonly string[]')).toHaveLength(0);
  });

  it('does not flag mutable-commented array', () => {
    expect(lint('type A = /* mutable */ string[]')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = string[]');
    expect(diag.message).toBe('Array type is not annotated as mutable or readonly.');
  });

  it('quick fix 0: Make readonly', () => {
    const source = 'type A = string[]';
    const [diag] = lint(source);
    expect(getActions(diag)[0].label).toBe('Make readonly');
    expect(getActions(diag)[0].isPreferred).toBe(true);
    expect(fix(source, diag, 0)).toBe('type A = readonly string[]');
  });

  it('quick fix 1: Mark as mutable', () => {
    const source = 'type A = string[]';
    const [diag] = lint(source);
    expect(getActions(diag)[1].label).toBe('Mark as mutable');
    expect(getActions(diag)[1].isPreferred).toBe(false);
    expect(fix(source, diag, 1)).toBe('type A = /* mutable */ string[]');
  });

  it('flags both layers of nested T[][]', () => {
    expect(lint('type A = string[][]')).toHaveLength(2);
  });

  it('inner element of T[][] gets parenthesized readonly fix', () => {
    const source = 'type A = string[][]';
    const diags = lint(source);
    const fixes = diags.map((d) => fix(source, d, 0));
    expect(fixes).toContain('type A = (readonly string[])[]');
  });

  it('inner element of T[][] gets parenthesized mutable fix', () => {
    const source = 'type A = string[][]';
    const diags = lint(source);
    const fixes = diags.map((d) => fix(source, d, 1));
    expect(fixes).toContain('type A = (/* mutable */ string[])[]');
  });

  it('works with tsx language id', () => {
    expect(lint('type A = string[]', 'typescriptreact')).toHaveLength(1);
  });
});

// Tuple [T, U]

describe('Tuple [T, U]', () => {
  it('flags unannotated tuple', () => {
    expect(lint('type A = [string, number]')).toHaveLength(1);
  });

  it('does not flag readonly tuple', () => {
    expect(lint('type A = readonly [string, number]')).toHaveLength(0);
  });

  it('does not flag mutable-commented tuple', () => {
    expect(lint('type A = /* mutable */ [string, number]')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = [string, number]');
    expect(diag.message).toBe('Array type is not annotated as mutable or readonly.');
  });

  it('quick fix 0: Make readonly', () => {
    const source = 'type A = [string, number]';
    const [diag] = lint(source);
    expect(fix(source, diag, 0)).toBe('type A = readonly [string, number]');
  });

  it('quick fix 1: Mark as mutable', () => {
    const source = 'type A = [string, number]';
    const [diag] = lint(source);
    expect(fix(source, diag, 1)).toBe('type A = /* mutable */ [string, number]');
  });

  it('tuple as element of array gets parenthesized readonly fix', () => {
    const source = 'type A = [string][]';
    const diags = lint(source);
    const fixes = diags.map((d) => fix(source, d, 0));
    expect(fixes).toContain('type A = (readonly [string])[]');
  });

  it('tuple as element of array gets parenthesized mutable fix', () => {
    const source = 'type A = [string][]';
    const diags = lint(source);
    const fixes = diags.map((d) => fix(source, d, 1));
    expect(fixes).toContain('type A = (/* mutable */ [string])[]');
  });
});

// Array<T> generic

describe('Array<T> generic', () => {
  it('flags unannotated Array<T>', () => {
    expect(lint('type A = Array<string>')).toHaveLength(1);
  });

  it('does not flag readonly Array<T>', () => {
    expect(lint('type A = readonly Array<string>')).toHaveLength(0);
  });

  it('does not flag mutable-commented Array<T>', () => {
    expect(lint('type A = /* mutable */ Array<string>')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = Array<string>');
    expect(diag.message).toBe('Array type is not annotated as mutable or readonly.');
  });

  it('quick fix 0: normalises to readonly T[]', () => {
    const source = 'type A = Array<string>';
    const [diag] = lint(source);
    expect(fix(source, diag, 0)).toBe('type A = readonly string[]');
  });

  it('quick fix 1: normalises to /* mutable */ T[]', () => {
    const source = 'type A = Array<string>';
    const [diag] = lint(source);
    expect(fix(source, diag, 1)).toBe('type A = /* mutable */ string[]');
  });
});

// Map<K, V>

describe('Map<K, V>', () => {
  it('flags unannotated Map', () => {
    expect(lint('type A = Map<string, number>')).toHaveLength(1);
  });

  it('does not flag mutable-commented Map', () => {
    expect(lint('type A = /* mutable */ Map<string, number>')).toHaveLength(0);
  });

  it('does not flag Map with fewer than 2 type arguments', () => {
    // Map<K> is invalid TypeScript but the linter should not crash and not flag it
    expect(lint('declare const m: Map<string>')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = Map<string, number>');
    expect(diag.message).toBe('Map type is not annotated as mutable or readonly.');
  });

  it('quick fix 0: ReadonlyMap', () => {
    const source = 'type A = Map<string, number>';
    const [diag] = lint(source);
    expect(fix(source, diag, 0)).toBe('type A = ReadonlyMap<string, number>');
  });

  it('quick fix 1: mutable comment', () => {
    const source = 'type A = Map<string, number>';
    const [diag] = lint(source);
    expect(fix(source, diag, 1)).toBe('type A = /* mutable */ Map<string, number>');
  });
});

// Set<T>

describe('Set<T>', () => {
  it('flags unannotated Set', () => {
    expect(lint('type A = Set<string>')).toHaveLength(1);
  });

  it('does not flag mutable-commented Set', () => {
    expect(lint('type A = /* mutable */ Set<string>')).toHaveLength(0);
  });

  it('does not flag Set with no type arguments', () => {
    expect(lint('declare const s: Set')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = Set<string>');
    expect(diag.message).toBe('Set type is not annotated as mutable or readonly.');
  });

  it('quick fix 0: ReadonlySet', () => {
    const source = 'type A = Set<string>';
    const [diag] = lint(source);
    expect(fix(source, diag, 0)).toBe('type A = ReadonlySet<string>');
  });

  it('quick fix 1: mutable comment', () => {
    const source = 'type A = Set<string>';
    const [diag] = lint(source);
    expect(fix(source, diag, 1)).toBe('type A = /* mutable */ Set<string>');
  });
});

// Record<K, V>

describe('Record<K, V>', () => {
  it('flags unannotated Record', () => {
    expect(lint('type A = Record<string, number>')).toHaveLength(1);
  });

  it('does not flag mutable-commented Record', () => {
    expect(lint('type A = /* mutable */ Record<string, number>')).toHaveLength(0);
  });

  it('does not flag Record already wrapped in Readonly<>', () => {
    expect(lint('type A = Readonly<Record<string, number>>')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = Record<string, number>');
    expect(diag.message).toBe('Record type is not annotated as mutable or readonly.');
  });

  it('quick fix 0: Readonly<Record<...>>', () => {
    const source = 'type A = Record<string, number>';
    const [diag] = lint(source);
    expect(fix(source, diag, 0)).toBe('type A = Readonly<Record<string, number>>');
  });

  it('quick fix 1: mutable comment', () => {
    const source = 'type A = Record<string, number>';
    const [diag] = lint(source);
    expect(fix(source, diag, 1)).toBe('type A = /* mutable */ Record<string, number>');
  });
});

// Mapped type { [K in ...]: V }

describe('Mapped type { [K in ...]: V }', () => {
  it('flags unannotated mapped type', () => {
    expect(lint('type A = { [K in string]: number }')).toHaveLength(1);
  });

  it('does not flag mapped type with readonly token', () => {
    expect(lint('type A = { readonly [K in string]: number }')).toHaveLength(0);
  });

  it('does not flag mutable-commented mapped type', () => {
    expect(lint('type A = /* mutable */ { [K in string]: number }')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = { [K in string]: number }');
    expect(diag.message).toBe('Mapped type is not annotated as mutable or readonly.');
  });

  it('quick fix 0: inserts readonly before [', () => {
    const source = 'type A = { [K in string]: number }';
    const [diag] = lint(source);
    expect(fix(source, diag, 0)).toBe('type A = { readonly [K in string]: number }');
  });

  it('quick fix 1: mutable comment before {', () => {
    const source = 'type A = { [K in string]: number }';
    const [diag] = lint(source);
    expect(fix(source, diag, 1)).toBe('type A = /* mutable */ { [K in string]: number }');
  });
});

// Property signature { a: T }

describe('Property signature { a: T }', () => {
  it('flags unannotated property in type literal', () => {
    expect(lint('type A = { foo: string }')).toHaveLength(1);
  });

  it('does not flag readonly property', () => {
    expect(lint('type A = { readonly foo: string }')).toHaveLength(0);
  });

  it('does not flag mutable-commented property', () => {
    expect(lint('type A = { /* mutable */ foo: string }')).toHaveLength(0);
  });

  it('does not flag property inside an interface', () => {
    expect(lint('interface A { foo: string }')).toHaveLength(0);
  });

  it('does not flag property inside a class', () => {
    expect(lint('class A { foo: string = "" }')).toHaveLength(0);
  });

  it('message is correct', () => {
    const [diag] = lint('type A = { foo: string }');
    expect(diag.message).toBe('Property is not annotated as mutable or readonly.');
  });

  it('quick fix 0: inserts readonly before property name', () => {
    const source = 'type A = { foo: string }';
    const [diag] = lint(source);
    expect(fix(source, diag, 0)).toBe('type A = { readonly foo: string }');
  });

  it('quick fix 1: mutable comment before property name', () => {
    const source = 'type A = { foo: string }';
    const [diag] = lint(source);
    expect(fix(source, diag, 1)).toBe('type A = { /* mutable */ foo: string }');
  });

  it('flags multiple properties in type literal', () => {
    expect(lint('type A = { foo: string; bar: number }')).toHaveLength(2);
  });
});
