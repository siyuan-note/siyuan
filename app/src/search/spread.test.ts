import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {applySearchOpenOptions} from "./openOptions";
import * as searchConfig from "./config";
import type {App} from "../index";

const compiled = transpileModule(readFileSync("src/search/spread.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("opening and reusing search applies explicit SQL query and method ahead of selected text", async () => {
    const saved = {k: "saved", method: 1, page: 5, hPath: "", idPath: [] as string[]};
    const dialogs: Array<{data: typeof saved, element: unknown, editors: unknown}> = [];
    const body = {querySelector: (): null => null};
    let hotkey = "global";
    let pathCallback: (data: {data: string[]}) => void;
    const element = {isConnected: true, setAttribute: (_name: string, value: string) => { hotkey = value; },
        getAttribute: () => hotkey, querySelector: (selector: string) => selector === "#searchList" ? {} : body};
    const editor = {protyle: {path: "/doc.sy", notebookId: "box"}};
    const api = {} as typeof import("./spread");
    runInNewContext(compiled, {exports: api, window: {siyuan: {storage: {search: saved}, dialogs}},
        getSelection: () => ({rangeCount: 1, getRangeAt: () => ({cloneRange: () => ({}), toString: () => "selection"})}),
        require: (name: string) => ({
            "../util/pathName": {getNotebookName: () => "box", pathPosix: () => ({join: (...parts: string[]) => parts.join("/")})},
            "../constants": {Constants: {LOCAL_SEARCHDATA: "search", DIALOG_GLOBALSEARCH: "global",
                DIALOG_SEARCH: "document", DIALOG_REPLACE: "replace"}},
            "../dialog": {Dialog: class {
                element = element;
                constructor() { dialogs.push(this as unknown as typeof dialogs[number]); }
            }},
            "../util/fetch": {fetchPost: (_url: string, _data: unknown, callback: typeof pathCallback) => { pathCallback = callback; }},
            "../protyle/util/selectionOffsets": {},
            "./util": {genSearch: () => ({edit: editor}),
                updateConfig: (_body: unknown, config: typeof saved) => config},
            "./request": {}, "./config": searchConfig,
            "./path": {beginSearchPathRequest: () => () => true},
            "../protyle/util/compatibility": {}, "./focus": {}, "./openOptions": {applySearchOpenOptions},
        })[name]});
    const app = {} as App;
    const sql = "-- first line\nSELECT * FROM blocks";
    await api.openSearch({app, hotkey: "global", key: sql, method: 2});
    assert.equal(dialogs[0].data.k, sql);
    assert.equal(dialogs[0].data.method, 2);
    assert.equal(dialogs[0].data.page, 1);
    await api.openSearch({app, hotkey: "global", key: "SELECT * FROM blocks WHERE type='p'", method: 2});
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].data.k, "SELECT * FROM blocks WHERE type='p'");
    await api.openSearch({app, hotkey: "document", key: sql, method: 2});
    pathCallback({data: ["/Document"]});
    assert.equal(dialogs[0].data.k, sql);
    assert.equal(dialogs[0].data.method, 2);
    await api.openSearch({app, hotkey: "global", key: "", method: 0});
    assert.equal(dialogs[0].data.k, "");
    assert.equal(dialogs[0].data.method, 0);
    await api.openSearch({app, hotkey: "global"});
    assert.equal(dialogs[0].data.method, 0);
    assert.equal(saved.k, "saved");
});
