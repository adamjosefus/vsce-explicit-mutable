import { clearTimeout, setTimeout } from 'node:timers';
import * as VScode from 'vscode';
import { MutableArrayCodeActionProvider } from './codeActions.js';
import { DIAGNOSTIC_SOURCE, lintDocument } from './linter.js';

const DEBOUNCE_MS = 300;
const SUPPORTED_LANGUAGES = ['typescript', 'typescriptreact'];

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
    if (!SUPPORTED_LANGUAGES.includes(document.languageId)) {
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
