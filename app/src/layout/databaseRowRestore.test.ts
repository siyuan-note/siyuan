import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IDatabaseRowOpenData} from "../protyle/render/av/openDatabaseRow";

const {parse} = require("ifdef-loader/preprocessor");

test("bound row layout restores navigation with its source view and current item", () => {
    let initialize: () => void;
    let restored: IDatabaseRowOpenData;
    class Editor {
        public databaseRow?: IDatabaseRowOpenData;
        public editor = {protyle: {notebookId: "target-notebook", block: {id: "bound", rootID: "document", showAll: true},
            preview: {element: {classList: {contains: () => true}}},
            element: {dataset: {databaseRowId: "bound"}}}};
        constructor(options?: {afterInitProtyle: (editor: Editor["editor"]) => void}) {
            if (options) { initialize = () => options.afterInitProtyle(this.editor); }
        }
    }
    class UnusedModel {}
    const modules: Record<string, unknown> = {
        "../editor": {Editor},
        "../constants": {Constants: {CB_GET_ALL: "all", CB_GET_SCROLL: "scroll", CB_GET_FOCUS: "focus"}},
        "../util/functions": {isWindow: () => false},
        "../util/pathName": {isEncryptedBox: (id: string) => id === "encrypted-notebook"},
        "../protyle/util/compatibility": {isPhablet: () => false},
        "../protyle/render/av/openDatabaseRow": {
            showDatabaseRowPreview: (model: Editor, data: IDatabaseRowOpenData) => {
                assert.equal(model.databaseRow, data);
                restored = data;
            },
        },
    };
    const exports = {} as typeof import("./util");
    runInNewContext(transpileModule(parse(readFileSync("src/layout/util.ts", "utf8"),
        {MOBILE: false, BROWSER: true}, false, true), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, window: {}, require: (name: string) => modules[name] ||
        new Proxy({}, {get: () => UnusedModel})});
    const model = new Editor();
    model.databaseRow = {avID: "database", databaseBlockID: "carrier", notebookID: "source-notebook",
        itemID: "third", valueID: "third-value", boundBlockID: "bound", title: "", isDetached: false,
        navigation: {viewID: "view", query: "search", groupID: "group"}};
    const json: ILayoutJSON = {};
    exports.layoutToJSON(model as never, json);
    const persisted = JSON.parse(JSON.stringify(json));
    const reopened = exports.newModelByInitData({} as never, {} as never, persisted) as unknown as Editor;
    initialize();
    assert.deepEqual(restored, model.databaseRow);
    assert.equal(reopened.editor.protyle.element.dataset.databaseRowId, "bound");
    assert.equal(exports.isSensitiveTab({model} as never), false);
    model.databaseRow.notebookID = "encrypted-notebook";
    assert.equal(exports.isSensitiveTab({model} as never), true, "source database context must not leak into a plaintext layout");
});
