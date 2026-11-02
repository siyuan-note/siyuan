import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("transaction.ts", readFileSync(__dirname + "/transaction.ts", "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.filter(isVariableStatement).flatMap(statement => Array.from(statement.declarationList.declarations))
    .find(item => item.name.getText(source) === "transaction");
const compiled = transpileModule(`const transaction = ${declaration.initializer.getText(source)};`, {
    compilerOptions: {target: ScriptTarget.ES2022},
}).outputText;

for (const mode of ["cancel", "tagsOnly", "withEntries", "error"]) {
    test(`tag deletion transaction ${mode} waits for confirmation before writing`, async () => {
        let settle: (value: unknown) => void;
        const preview = new Promise(resolve => settle = resolve);
        const writes: {doOperations: IOperation[], undoOperations: IOperation[]}[] = [];
        let restored = 0;
        let history = 0;
        const messages: string[] = [];
        const protyle = {disabled: false, undo: {add: () => history++}, wysiwyg: {element: {querySelectorAll: (): Element[] => []}}};
        const cleanup: IOperation = {action: "cleanupAttrViewBlocks", avID: "database", data: {ruleVersion: "version", items: []}};
        const dependencies = {
            window: {siyuan: {config: {fileTree: {openFilesUseCurrentTab: false}}}},
            prepareViewFoldTransaction: (_protyle: unknown, doOperations: IOperation[], undoOperations: IOperation[]) => ({doOperations, undoOperations}),
            cleanBlockSelectionModeOperations() {}, cleanHeadingNumberOperations() {}, restoreInlineElementBoundaryHTML: (html: string) => html,
            retainTableCellRichMetadata: (html: string) => html,
            getTagRemovalChanges: () => [{id: "block", tags: ["todo"]}],
            disabledProtyle: () => protyle.disabled = true, enableProtyle: () => protyle.disabled = false,
            waitForPendingTransactions: async () => {},
            previewTagRemoval: async () => { const result = await preview; if (mode === "error") { throw new Error("failed"); } return result; },
            tagRemovalOperations: (groups: unknown[]) => groups.length ? [cleanup] : [],
            reloadProtyle: (_protyle: unknown, _focus: boolean, _readonly: boolean, done: () => void) => { restored++; done(); },
            showMessage: (message: string) => messages.push(message),
            promiseTransaction: (options: typeof writes[number]) => writes.push(options),
        };
        const transaction = new Function(...Object.keys(dependencies), compiled + "\nreturn transaction;")(...Object.values(dependencies));
        const operations: IOperation[] = [{action: "update", id: "block", data: "after"}];
        const undo: IOperation[] = [{action: "update", id: "block", data: "before"}];
        transaction(protyle, operations, undo);
        assert.equal(protyle.disabled, true);
        assert.equal(history, 0);
        assert.equal(writes.length, 0);
        settle(mode === "cancel" ? null : mode === "withEntries" ? [{}] : []);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(protyle.disabled, false);
        if (mode === "cancel" || mode === "error") {
            assert.equal(writes.length, 0);
            assert.equal(history, 0);
            assert.equal(restored, 1);
            assert.equal(messages.length, mode === "error" ? 1 : 0);
        } else {
            assert.equal(history, 1);
            assert.deepEqual(writes[0].doOperations, mode === "withEntries" ? [...operations, cleanup] : operations);
            assert.deepEqual(writes[0].undoOperations, mode === "withEntries" ? [...undo, cleanup] : undo);
        }
    });
}
