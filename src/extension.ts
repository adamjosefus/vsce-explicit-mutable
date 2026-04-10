import { clearTimeout, setTimeout } from 'node:timers';
import * as vscode from 'vscode';
import { MutableArrayCodeActionProvider } from './codeActions.js';
import { DIAGNOSTIC_SOURCE, lintDocument } from './linter.js';

const DEBOUNCE_MS = 300;
const SUPPORTED_LANGUAGES = ['typescript', 'typescriptreact'];

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  context.subscriptions.push(diagnostics);

  const selector: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map((language) => ({
    language,
  }));

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(selector, new MutableArrayCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    })
  );

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleUpdate(document: vscode.TextDocument): void {
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

  for (const document of vscode.workspace.textDocuments) {
    scheduleUpdate(document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleUpdate),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleUpdate(e.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
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
