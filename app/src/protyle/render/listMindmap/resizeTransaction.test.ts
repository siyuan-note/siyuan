import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";

test("resizing uses one source update with both dimensions and retains the exact undo source", async () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
        ScriptTarget.ES2021, true);
    const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
    assert.ok(controller && isClassDeclaration(controller));
    let callback = "";
    const visit = (item: import("typescript").Node) => {
        if (isPropertyAssignment(item) && item.name.getText(source) === "commit") {
            callback = item.initializer.getText(source);
        }
        item.forEachChild(visit);
    };
    visit(controller);
    assert.ok(callback);
    const change = controller.members.find(item => item.name?.getText(source) === "change");
    assert.ok(change);
    const compiled = transpileModule(`class Controller {
        ${change.getText(source)}
        constructor(list) { this.list = list; this.commit = ${callback}; }
    }
    globalThis.Controller = Controller;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    let title = "Before editing";
    const list = {isConnected: true, parentElement: {classList: {contains: () => false}},
        style: {width: "50%", height: "40vh", flex: ""},
        get outerHTML() { return JSON.stringify({style: this.style, title}); }};
    const transactions: {before: string, after: string}[] = [];
    const root = {id: "root", children: [] as unknown[]};
    const context: any = {
        canEdit: () => true, readListMindmap: () => ({root, nodes: new Map([["root", root]])}),
        getListMindmapSiblingIDs: () => new Map(), normalizeListMindmapSummaryMetadata: () => {},
        cleanListMindmapHTML: (html: string) => html,
        setBlockHeight: (block: typeof list, height: string) => block.style.height = height,
        updateTransaction: (_owner: unknown, _list: unknown, before: string) => transactions.push({before, after: list.outerHTML}),
        showMessage: (message: string) => assert.fail(message), window: {siyuan: {languages: {listMindmapInvalid: "Invalid"}}}, console,
    };
    runInNewContext(compiled, context);
    const target = Object.assign(new context.Controller(list), {owner: {},
        view: {getSelectedId: () => "root"}, refresh() {}, activeEditor: {finish: async () => {
            title = "Saved node content";
            return true;
        }}});
    assert.equal(await target.commit({width: 320, height: 180}), true);
    assert.equal(transactions.length, 1);
    assert.deepEqual(JSON.parse(transactions[0].before), {
        style: {width: "50%", height: "40vh", flex: ""}, title: "Saved node content",
    });
    assert.deepEqual(JSON.parse(transactions[0].after), {
        style: {width: "320px", height: "180px", flex: "none"}, title: "Saved node content",
    });
    for (let cycle = 0; cycle < 2; cycle++) {
        Object.assign(list.style, JSON.parse(transactions[0].before).style);
        assert.equal(list.style.width, "50%");
        assert.equal(list.style.height, "40vh");
        Object.assign(list.style, JSON.parse(transactions[0].after).style);
        assert.equal(list.style.width, "320px");
        assert.equal(list.style.height, "180px");
    }
    assert.equal(await target.commit({width: 320, height: 180}), true);
    assert.equal(transactions.length, 1, "unchanged dimensions do not create another transaction");
});
