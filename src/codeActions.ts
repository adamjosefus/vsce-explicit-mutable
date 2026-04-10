import * as vscode from 'vscode';
import { DIAGNOSTIC_CODE, DIAGNOSTIC_SOURCE } from './linter.js';

export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface CodeActionInfo {
  label: string;
  isPreferred: boolean;
  edits: TextEdit[];
}

export interface DiagnosticData {
  actions: CodeActionInfo[];
}

export class MutableArrayCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE || diagnostic.code !== DIAGNOSTIC_CODE) {
        continue;
      }

      const data = (diagnostic as vscode.Diagnostic & { data?: DiagnosticData }).data;
      if (data === undefined) {
        continue;
      }

      for (const info of data.actions) {
        const action = new vscode.CodeAction(info.label, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.isPreferred = info.isPreferred;

        const edit = new vscode.WorkspaceEdit();
        for (const te of info.edits) {
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(te.start), document.positionAt(te.end)),
            te.newText
          );
        }
        action.edit = edit;
        actions.push(action);
      }
    }

    return actions;
  }
}
