import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const action = ts.createSourceFile("action.ts", readFileSync("src/protyle/render/av/action.ts", "utf8"),
    ts.ScriptTarget.Latest, true);
const template = ts.createSourceFile("newItemTemplate.ts", readFileSync("src/protyle/render/av/newItemTemplate.ts", "utf8"),
    ts.ScriptTarget.Latest, true);
const create = template.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(declaration => declaration.name.getText(template) === "createAttributeViewItem"));

for (const type of ["av-add-more", "av-add-bottom"]) {
    test(`map ${type} creates and opens records with optional templates and preserves insertion position`, () => {
        let branch: ts.Statement;
        const visit = (node: ts.Node) => {
            if (ts.isIfStatement(node) && node.expression.getText(action) === `type === "${type}" && !protyle.disabled`) {
                branch = node.thenStatement;
            }
            ts.forEachChild(node, visit);
        };
        visit(action);
        assert.ok(branch);
        const compiled = ts.transpileModule(create.getText(template).replace(/^export /, "") +
            `\n(() => ${branch.getText(action)})();`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
        for (const layout of ["map", "table"]) {
            for (const templateID of ["", "template-id"]) {
                const requests: Array<{templateID: string; previousID: string; groupID: string}> = [];
                const opened: Array<{itemID: string; focusPrimary: boolean}> = [];
                let inserted = 0;
                let rendered = 0;
                const blockElement = {
                    dataset: {avId: "database", nodeId: "carrier", avType: layout},
                    getAttribute: (name: string) => name === "data-av-type" ? layout : "view",
                    querySelector: () => ({dataset: {defaultTemplateId: templateID}}),
                    removeAttribute() {},
                };
                runInNewContext(compiled, {
                    blockElement, viewType: layout, target: {},
                    Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"},
                    protyle: {app: {appId: "app"}, id: "editor", notebookId: "notebook"},
                    event: {preventDefault() {}, stopPropagation() {}},
                    hasClosestByClassName: () => ({getAttribute: () => ""}),
                    getAvBodyData: () => ({rows: [{id: "previous-row"}]}),
                    getCalendarCreationDate: (): number | undefined => undefined,
                    fetchPost: (url: string, payload: typeof requests[number], callback: (response: unknown) => void) => {
                        assert.equal(url, "/api/av/createAttributeViewItem");
                        requests.push(payload);
                        callback({code: 0, data: {itemID: "new-record", content: "New record", isDetached: true}});
                    },
                    insertRows: () => inserted++,
                    avRender: () => rendered++,
                    openDatabaseRowByData: (_protyle: unknown, record: typeof opened[number]) => opened.push(record),
                });
                if (layout === "table" && !templateID) {
                    assert.equal(inserted, 1);
                    assert.equal(requests.length, 0);
                } else {
                    assert.equal(inserted, 0);
                    assert.equal(requests.length, 1);
                    assert.equal(requests[0].templateID, templateID);
                    assert.equal(requests[0].previousID, type === "av-add-bottom" ? "previous-row" : "");
                    assert.equal(requests[0].groupID, "");
                    assert.equal(rendered, 1);
                }
                assert.equal(opened.length, layout === "map" ? 1 : 0);
                if (layout === "map") {
                    assert.equal(opened[0].itemID, "new-record");
                    assert.equal(opened[0].focusPrimary, true);
                }
            }
        }
    });
}
