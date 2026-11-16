import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {App} from "../index";
import {documentParentID} from "./documentCreate";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [false, true]) {
    test(`successful document creation closes menus before callbacks and opening (${mobile ? "mobile" : "desktop"})`, () => {
        const methods = {} as typeof import("./newFile");
        const events: string[] = [];
        let complete: (id: string, title: string) => void;
        const source = parse(readFileSync("src/util/newFile.ts", "utf8"), {MOBILE: mobile}, false, true);
        runInNewContext(transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {
            exports: methods,
            window: {siyuan: {menus: {menu: {remove: () => events.push("close")}}}},
            require: (name: string) => ({
                "./documentCreate": {documentParentID},
                "./configuredDocument": {createConfiguredDocument: (_request: unknown, options: {
                    onCreated: typeof complete,
                }) => { complete = options.onCreated; }},
                "../constants": {Constants: {CB_GET_CONTEXT: "context", CB_GET_OPENNEW: "new"}},
                "../editor/util": {openFileById: ({id}: {id: string}) => events.push(`desktop:${id}`)},
                "../mobile/editor": {openMobileFileById: (_app: unknown, id: string) => events.push(`mobile:${id}`)},
            })[name] || {},
        });
        const platform = mobile ? "mobile" : "desktop";
        methods.newFileInTree({} as App, "notebook", "/");
        assert.deepEqual(events, [], "pending or unsuccessful requests leave the menu open");
        complete("created-in-tree", "Title");
        assert.deepEqual(events, ["close", `${platform}:created-in-tree`]);
        events.length = 0;
        methods.newFileInProtyle({app: {}, notebookId: "notebook", path: "/"} as IProtyle,
            (id, title) => events.push(`callback:${id}:${title}`));
        assert.deepEqual(events, []);
        complete("created-in-editor", "Title");
        assert.deepEqual(events, ["close", "callback:created-in-editor:Title", `${platform}:created-in-editor`]);
    });
}

test("an empty detached window creates documents using the first open notebook", () => {
    const methods = {} as typeof import("./newFile");
    const requests: Array<{url: string, data: unknown}> = [];
    const source = readFileSync("src/util/newFile.ts", "utf8")
        .replace(/\/\/\/ #else[\s\S]*?\/\/\/ #endif/g, "");
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        window: {siyuan: {notebooks: [{id: "closed", closed: true}, {id: "open", closed: false}]}},
        require: (name: string) => ({
            "../layout/tabUtil": {getActiveTab() {}, getDockByType() {}},
            "../layout/dock/Files": {Files: class {}},
            "../editor": {Editor: class {}},
            "./pathName": {getOpenNotebookCount: () => 1},
            "./configuredDocument": {createConfiguredDocument: (data: unknown) => requests.push({url: "configured", data})},
        })[name] || {},
    });
    methods.newFile({} as App);
    assert.equal(requests[0].url, "configured");
    assert.equal(JSON.stringify(requests[0].data), JSON.stringify({
        notebook: "open", contextID: null, purpose: "document", placement: "configured",
    }));
});

test("new documents use the focused document identity after its row is unmounted", () => {
    const methods = {} as typeof import("./newFile");
    const requests: unknown[] = [];
    class Files {
        docTree = {getFocusedItem: () => ({notebookId: "selected-box", path: "/20261026120000-parent1/20261026120000-focus01.sy"})};
        element = {querySelector: () => { throw new Error("The focused row is outside the viewport"); }};
    }
    const model = new Files();
    const source = readFileSync("src/util/newFile.ts", "utf8")
        .replace(/\/\/\/ #else[\s\S]*?\/\/\/ #endif/g, "");
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        window: {siyuan: {notebooks: [{id: "fallback", closed: false}]}},
        require: (name: string) => ({
            "../layout/tabUtil": {getActiveTab() {}, getDockByType: () => ({data: {file: model}})},
            "../layout/dock/Files": {Files},
            "../editor": {Editor: class {}},
            "./pathName": {getOpenNotebookCount: () => 1},
            "./documentCreate": {documentParentID},
            "./configuredDocument": {createConfiguredDocument: (data: unknown) => requests.push(data)},
        })[name] || {},
    });
    methods.newFile({} as App);
    assert.equal(JSON.stringify(requests), JSON.stringify([{
        notebook: "selected-box", contextID: "20261026120000-focus01", purpose: "document", placement: "configured",
    }]));
});
