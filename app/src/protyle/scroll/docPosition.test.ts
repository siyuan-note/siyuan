import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import test from "node:test";
import {ModuleKind, transpileModule} from "typescript";

test("document position reads attributes only for a saved ordinary position and fails safely", async () => {
    const calls: unknown[] = [];
    let fail = false;
    let code = 0;
    const positions: Record<string, {rootId: string, scrollTop: number}> = {};
    const exports: typeof import("./docPosition") = {} as any;
    runInNewContext(transpileModule(readFileSync(join(__dirname, "docPosition.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports, window: {siyuan: {storage: {positions}, config: {fileTree: {}}}},
        require: (name: string) => name.endsWith("constants") ? {Constants: {LOCAL_FILEPOSITION: "positions", CUSTOM_SY_RESTORE_DOC_POSITION: "restore"}} :
            {fetchSyncPost: async (...args: unknown[]) => { calls.push(args); if (fail) throw new Error("offline"); return {code, data: {}}; }}});
    assert.equal(await exports.getDocPosition("doc"), undefined);
    assert.equal(calls.length, 0);
    const explicit = {rootId: "doc", scrollTop: 90};
    assert.equal(await exports.getDocPosition("doc", explicit), explicit);
    assert.equal(calls.length, 0);
    positions.doc = {rootId: "doc", scrollTop: 8000};
    assert.equal(await exports.getDocPosition("doc", {...explicit, rootId: "other"}), positions.doc);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["/api/attr/getBlockAttrs", {id: "doc"}]]);
    code = -1;
    assert.equal(await exports.getDocPosition("doc"), undefined);
    fail = true;
    assert.equal(await exports.getDocPosition("doc"), undefined);
    assert.equal(positions.doc.scrollTop, 8000);
});
