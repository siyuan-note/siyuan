import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("repeated daily-note clicks share the pending creation without replaying template requests", async () => {
    const calls: Array<{body: {notebook: string}; complete: () => void}> = [];
    const opened: string[] = [];
    const exports: {fetchNewDailyNote?: (app: object, notebook: string) => Promise<void>} = {};
    runInNewContext(transpileModule(readFileSync("src/util/mount.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: (name: string) => {
        if (name === "../constants") return {Constants: {SIYUAN_APPID: "app"}};
        if (name === "./fetch") return {fetchPost: (url: string, body: {notebook: string},
                                                   callback: (response: object) => void) => {
            assert.equal(url, "/api/filetree/createDailyNote");
            return new Promise<void>(resolve => calls.push({body, complete: () => {
                callback({code: 0, data: {id: "daily"}});
                resolve();
            }}));
        }};
        if (name === "../editor/util") return {openFileById: () => opened.push("desktop")};
        if (name === "../mobile/editor") return {openMobileFileById: () => opened.push("mobile")};
        return {};
    }});
    const first = exports.fetchNewDailyNote({}, "notebook");
    const second = exports.fetchNewDailyNote({}, "notebook");
    assert.equal(first, second);
    assert.equal(calls.length, 1);
    calls[0].complete();
    await first;
    assert.deepEqual(opened, ["mobile", "desktop"]);
    const later = exports.fetchNewDailyNote({}, "notebook");
    assert.equal(calls.length, 2);
    calls[1].complete();
    await later;
});
