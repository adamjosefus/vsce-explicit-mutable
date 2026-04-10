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
  edits: readonly TextEdit[];
}

export interface DiagnosticData {
  actions: readonly CodeActionInfo[];
}

export class MutableArrayCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): /* mutable */ vscode.CodeAction[] {
    return context.diagnostics
      .filter((d) => d.source === DIAGNOSTIC_SOURCE && d.code === DIAGNOSTIC_CODE)
      .flatMap((diagnostic) => {
        const data = (diagnostic as vscode.Diagnostic & { readonly data?: DiagnosticData }).data;
        if (data === undefined) {
          return [];
        }

        return data.actions.map((info) => {
          const action = new vscode.CodeAction(info.label, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [diagnostic];
          action.isPreferred = info.isPreferred;

          /* mutable */ const edit = new vscode.WorkspaceEdit();
          for (const te of info.edits) {
            edit.replace(
              document.uri,
              new vscode.Range(document.positionAt(te.start), document.positionAt(te.end)),
              te.newText
            );
          }
          action.edit = edit;
          return action;
        });
      });
  }
}
