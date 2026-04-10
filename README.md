# Explicit Mutable

A TypeScript linter that warns whenever a mutable type is not explicitly annotated — forcing you to choose between `readonly` and `/* mutable */` rather than leaving mutability implicit.

## Why

TypeScript's type system allows arrays, maps, sets, records, and object properties to be silently mutable. This makes it easy to accidentally mutate data that was never intended to be changed.

**Explicit Mutable** surfaces these cases as warnings and provides one-click fixes, so every mutable type in your codebase is a deliberate choice.

## Features

The extension warns on the following patterns:

### Arrays — `T[]` and `Array<T>`

```ts
// Warning
const items: string[] = [];

// Fix: make readonly
const items: readonly string[] = [];

// Fix: mark as mutable
const items: /* mutable */ string[] = [];
```

### Tuples — `[T, U]`

```ts
// Warning
type Pair = [number, string];

// Fix: make readonly
type Pair = readonly [number, string];

// Fix: mark as mutable
type Pair = /* mutable */ [number, string];
```

### Map — `Map<K, V>`

```ts
// Warning
const cache: Map<string, number> = new Map();

// Fix: make readonly
const cache: ReadonlyMap<string, number> = new Map();

// Fix: mark as mutable
const cache: /* mutable */ Map<string, number> = new Map();
```

### Set — `Set<T>`

```ts
// Warning
const ids: Set<number> = new Set();

// Fix: make readonly
const ids: ReadonlySet<number> = new Set();

// Fix: mark as mutable
const ids: /* mutable */ Set<number> = new Set();
```

### Record — `Record<K, V>`

```ts
// Warning
type Config = Record<string, string>;

// Fix: make readonly
type Config = Readonly<Record<string, string>>;

// Fix: mark as mutable
type Config = /* mutable */ Record<string, string>;
```

### Mapped types — `{ [K in keyof T]: V }`

```ts
// Warning
type Flags = { [K in keyof Options]: boolean };

// Fix: make readonly
type Flags = { readonly [K in keyof Options]: boolean };

// Fix: mark as mutable
type Flags = /* mutable */ { [K in keyof Options]: boolean };
```

### Object type literal properties

```ts
// Warning
type Point = { x: number; y: number };

// Fix: make readonly
type Point = { readonly x: number; readonly y: number };

// Fix: mark as mutable
type Point = { /* mutable */ x: number; /* mutable */ y: number };
```

## Quick Fixes

Every warning comes with two code actions:

| Action                          | Result                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| **Make readonly** _(preferred)_ | Applies the appropriate `readonly` annotation for the type                 |
| **Mark as mutable**             | Adds `/* mutable */` to explicitly document that mutability is intentional |

Use `Ctrl+.` / `Cmd+.` on a warning to trigger the 💡 quick fix menu.

## Supported Languages

- TypeScript (`.ts`)
- TypeScript React (`.tsx`)

## License

MIT
