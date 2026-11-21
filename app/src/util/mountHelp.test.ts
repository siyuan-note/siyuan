import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("opening the user guide reveals its notebook after refreshing the visible document tree", () => {
    const source = transpileModule(readFileSync("src/util/mount.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    for (const mobile of [false, true]) {
        for (const visible of [false, true]) {
            const calls: string[] = [];
            const notebook = {id: "guide", closed: false};
            const files = {
                element: {clientHeight: visible ? 280 : 0},
                init: (initial: boolean) => calls.push(`init:${initial}`),
                docTree: {ensureRendered: (key: string) => calls.push(key)},
            };
            const exports: {mountHelp?: () => void} = {};
            const dependencies: Record<string, object> = {
                "../constants": {Constants: {HELP_PATH: {en: "guide"}, SIYUAN_APPID: "app"}},
                "./functions": {isMobile: () => mobile},
                "./fetch": {fetchPost: (url: string, body: {notebook: string}, complete: () => void) => {
                    assert.equal(body.notebook, notebook.id);
                    calls.push(url);
                    complete();
                }},
                "./pathName": {setNoteBook: (complete: (notebooks: typeof notebook[]) => void) => {
                    calls.push("notebooks");
                    complete([notebook]);
                }},
                "../layout/tabUtil": {getDockByType: () => mobile ? undefined : {data: {file: files}}},
                "../layout/dock/docTree/rowData": {notebookTreeItem: () => ({occurrenceKey: "notebook:guide"})},
            };
            runInNewContext(source, {
                exports,
                require: (name: string) => dependencies[name] ?? {},
                window: {siyuan: {config: {appearance: {lang: "en"}}, mobile: mobile ? {docks: {file: files}} : undefined}},
            });
            exports.mountHelp();
            assert.deepEqual(calls, ["/api/notebook/removeNotebook", "/api/notebook/openNotebook", "notebooks", "init:false",
                ...(visible ? ["notebook:guide"] : [])]);
        }
    }
});
