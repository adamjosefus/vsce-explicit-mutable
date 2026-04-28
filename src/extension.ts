import { clearTimeout, setTimeout } from 'node:timers';
import * as VScode from 'vscode';
import { MutableArrayCodeActionProvider } from './codeActions.js';
import { DIAGNOSTIC_SOURCE, lintDocument } from './linter.js';

const DEBOUNCE_MS = 300;
const SUPPORTED_LANGUAGES = ['typescript', 'typescriptreact'];
const CONFIG_SECTION = 'explicit-mutable';

const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts', '.d.tsx', '.d.mtsx', '.d.ctsx'];
const TSX_SUFFIXES = ['.tsx', '.mtsx', '.ctsx'];

type FileTypeKey = 'declarations' | 'tsx' | 'ts';

function getFileTypeSettingKey(fileName: string): FileTypeKey {
  const lower = fileName.toLowerCase();
  if (DECLARATION_SUFFIXES.some((s) => lower.endsWith(s))) {
    return 'declarations';
  }
  if (TSX_SUFFIXES.some((s) => lower.endsWith(s))) {
    return 'tsx';
  }
  return 'ts';
}

function isDocumentEnabled(document: VScode.TextDocument): boolean {
  if (!SUPPORTED_LANGUAGES.includes(document.languageId)) {
    return false;
  }

  const config = VScode.workspace.getConfiguration(CONFIG_SECTION, document.uri);

  if (
    config.get<boolean>('ignoreNodeModules', true) &&
    document.uri.fsPath.includes('/node_modules/')
  ) {
    return false;
  }

  const key = getFileTypeSettingKey(document.fileName);
  return config.get<boolean>(`enable.${key}`, true);
}

export function activate(context: VScode.ExtensionContext): void {
  const diagnostics = VScode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  context.subscriptions.push(diagnostics);

  const selector: VScode.DocumentSelector = SUPPORTED_LANGUAGES.map((language) => ({
    language,
  }));

  context.subscriptions.push(
    VScode.languages.registerCodeActionsProvider(selector, new MutableArrayCodeActionProvider(), {
      providedCodeActionKinds: [VScode.CodeActionKind.QuickFix],
    })
  );

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleUpdate(document: VScode.TextDocument): void {
    if (!isDocumentEnabled(document)) {
      diagnostics.delete(document.uri);
      return;
    }

    const key = document.uri.toString();
    const existing = debounceTimers.get(key);
    if (existing !== undefined) {
      globalThis.clearTimeout(existing);
    }

    debounceTimers.set(
      key,
      globalThis.setTimeout(() => {
        debounceTimers.delete(key);
        diagnostics.set(document.uri, lintDocument(document));
      }, DEBOUNCE_MS)
    );
  }

  for (const document of VScode.workspace.textDocuments) {
    scheduleUpdate(document);
  }

  context.subscriptions.push(
    VScode.workspace.onDidOpenTextDocument(scheduleUpdate),
    VScode.workspace.onDidChangeTextDocument((e) => scheduleUpdate(e.document)),
    VScode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        for (const doc of VScode.workspace.textDocuments) {
          scheduleUpdate(doc);
        }
      }
    }),
    VScode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const timer = debounceTimers.get(key);
      if (timer !== undefined) {
        clearTimeout(timer);
        debounceTimers.delete(key);
      }
      diagnostics.delete(document.uri);
    })
  );
}

export function deactivate(): void {
  // DiagnosticCollection disposed via context.subscriptions
}
