export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position
  ) {}
}

export class Diagnostic {
  public source?: string;
  public code?: string | number;
  public data?: unknown;

  constructor(
    public readonly range: Range,
    public readonly message: string,
    public readonly severity: number
  ) {}
}

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;
