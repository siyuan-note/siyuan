import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

interface IPanelHarness {
    loadChildren(row: unknown, children: unknown, generation: number): Promise<void>;
    drop(ids: string[], x: number, y: number): Promise<void>;
    click(event: unknown): void;
    previewDrop(): void;
    clearDrop(): void;
    scheduleRefresh(): void;
    dropTarget?: {id: string, position: string};
    suppressClick?: boolean;
}

const loadPanel = (fetchCode = 0) => {
    const calls: {kind: string, args: unknown[]}[] = [];
    const record = (kind: string) => async (...args: unknown[]) => {
        calls.push({kind, args});
        return {code: kind === "http" ? fetchCode : 0};
    };
    const exports: {PinnedDocs?: {prototype: object}} = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "PinnedDocs.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        require: (name: string) => {
            if (name.endsWith("/pinnedDocs")) { return {updatePinnedDocs: record("pin")}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: record("http")}; }
            if (name.endsWith("/fileTreeReorder")) { return {reorderSortedFileTree: record("reorder")}; }
            return {};
        },
    });
    const panel = Object.create(exports.PinnedDocs.prototype) as IPanelHarness;
    panel.clearDrop = () => { panel.dropTarget = undefined; };
    panel.scheduleRefresh = () => {};
    return {panel, calls};
};

test("root drops create an entry without invoking source movement", async () => {
    const {panel, calls} = loadPanel();
    panel.previewDrop = () => { panel.dropTarget = {id: "parent", position: "pin-before"}; };
    await panel.drop(["child"], 0, 0);
    assert.deepEqual(calls, [{kind: "pin", args: [["child"], "pin", "parent", false]}]);
});

test("child ordering uses the existing conflict confirmation and inside drops move the source", async () => {
    const {panel, calls} = loadPanel();
    panel.previewDrop = () => { panel.dropTarget = {id: "sibling", position: "after"}; };
    await panel.drop(["child"], 0, 0);
    assert.deepEqual(calls, [{kind: "reorder", args: [["child"], "sibling", true]}]);
    calls.length = 0;
    panel.previewDrop = () => { panel.dropTarget = {id: "parent", position: "inside"}; };
    await panel.drop(["child"], 0, 0);
    assert.equal(calls[0].kind, "http");
    assert.equal(calls[0].args[0], "/api/filetree/moveDocsByID");
    assert.equal(JSON.stringify(calls[0].args[1]), JSON.stringify({fromIDs: ["child"], toID: "parent"}));
});

test("invalid drop targets and self moves do not mutate source documents", async () => {
    const {panel, calls} = loadPanel();
    panel.previewDrop = () => { panel.dropTarget = undefined; };
    await panel.drop(["child"], 0, 0);
    panel.previewDrop = () => { panel.dropTarget = {id: "child", position: "inside"}; };
    await panel.drop(["child"], 0, 0);
    await panel.drop([], 0, 0);
    assert.equal(calls.length, 0);
});

test("panel clicks never bubble into the mobile source tree handler", () => {
    const {panel} = loadPanel();
    let stopped = 0;
    let prevented = 0;
    panel.suppressClick = true;
    panel.click({stopPropagation: () => stopped++, preventDefault: () => prevented++});
    panel.suppressClick = false;
    panel.click({stopPropagation: () => stopped++, target: {closest: (): Element | null => null}});
    assert.equal(stopped, 2);
    assert.equal(prevented, 1);
});

test("notebook root expansion requests physical root while documents keep their own paths", async () => {
    const {panel, calls} = loadPanel(-1);
    for (const id of ["notebook", "document"]) {
        await panel.loadChildren({dataset: {notebook: "notebook", nodeId: id, path: `/${id}.sy`}}, {}, 0);
    }
    assert.equal(JSON.stringify(calls[0].args[1]), JSON.stringify({notebook: "notebook", path: "/", maxListCount: 0}));
    assert.equal(JSON.stringify(calls[1].args[1]), JSON.stringify({notebook: "notebook", path: "/document.sy", maxListCount: 0}));
});
