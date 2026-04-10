import * as vscode from "vscode";
import { DIAGNOSTIC_CODE, DIAGNOSTIC_SOURCE } from "./linter.js";

export interface DiagnosticData {
  kind: "array" | "tuple" | "generic";
  nodeStart: number;
  nodeEnd: number;
  typeNameEnd?: number;
}

export class MutableArrayCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (
        diagnostic.source !== DIAGNOSTIC_SOURCE ||
        diagnostic.code !== DIAGNOSTIC_CODE
      ) {
        continue;
      }

      const data = (diagnostic as vscode.Diagnostic & { data?: DiagnosticData }).data;
      if (data === undefined) continue;

      actions.push(buildMarkMutableAction(document, diagnostic, data));
      actions.push(buildMakeReadonlyAction(document, diagnostic, data));
    }

    return actions;
  }
}

function buildMarkMutableAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  data: DiagnosticData
): vscode.CodeAction {
  const action = new vscode.CodeAction(
    "Mark as mutable",
    vscode.CodeActionKind.QuickFix
  );
  action.diagnostics = [diagnostic];
  action.isPreferred = false;

  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(data.nodeStart), "/* mutable */ ");
  action.edit = edit;

  return action;
}

function buildMakeReadonlyAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  data: DiagnosticData
): vscode.CodeAction {
  const action = new vscode.CodeAction(
    "Make readonly",
    vscode.CodeActionKind.QuickFix
  );
  action.diagnostics = [diagnostic];
  action.isPreferred = true;

  const edit = new vscode.WorkspaceEdit();

  if (data.kind === "generic") {
    // Array<T> → ReadonlyArray<T>: replace only the "Array" identifier
    const nameStart = document.positionAt(data.nodeStart);
    const nameEnd = document.positionAt(data.typeNameEnd!);
    edit.replace(document.uri, new vscode.Range(nameStart, nameEnd), "ReadonlyArray");
  } else {
    // T[] → readonly T[]  or  [T, U] → readonly [T, U]
    edit.insert(document.uri, document.positionAt(data.nodeStart), "readonly ");
  }

  action.edit = edit;
  return action;
}
