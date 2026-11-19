import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isIfStatement, ScriptTarget, transpileModule} from "typescript";

const branch = (file: string, condition: string) => {
    const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
    let body: string;
    const visit = (node: import("typescript").Node) => {
        if (isIfStatement(node) && node.expression.getText(source).includes(condition)) {
            body = node.thenStatement.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(body, condition);
    return transpileModule(`(function () ${body}).call(panel);`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
};

test("reference panel button and shortcut preserve visibility when opening a tab", () => {
    const button = branch("src/block/Panel.ts", 'type === "stickTab"');
    const shortcut = branch("src/protyle/wysiwyg/keydown.ts", "keymap.editor.general.openInNewTab");
    for (const hidden of [false, true]) {
        for (const code of [button, shortcut]) {
            const opened: any[] = [];
            let destroyed = 0;
            const panel = {refDefs: [{refID: "target"}], element: {contains: () => true}, destroy: () => destroyed++};
            runInNewContext(code, {
                panel,
                options: {app: "app"},
                protyle: {app: "app"},
                event: {preventDefault() {}, stopPropagation() {}},
                nodeElement: {getAttribute: () => "target"},
                window: {siyuan: {blockPanels: [panel]}},
                checkReferenceFold: (id: string, callback: any) => {
                    assert.equal(id, "target");
                    callback(hidden, [hidden ? "all" : "context"]);
                },
                openFileById: (options: any) => opened.push(options),
            });
            assert.equal(opened.length, 1);
            assert.equal(opened[0].zoomIn, hidden);
            assert.equal(opened[0].openNewTab, true);
            assert.equal(destroyed, 1);
        }
    }
});
