import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/util/fileTreeReorder.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (responses: any[], accept = false) => {
    const requests: any[] = [];
    let confirmations = 0;
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: {removeSorts: "Sort", fileTreeDragRemoveSorts: "Confirm"}}},
        require: () => ({
            getRelativeReorderRequest: (sourceIDs: string[], targetID: string, after: boolean) => ({
                sourceIDs, targetID, position: after ? "after" : "before",
            }),
            fetchSyncPost: async (_url: string, data: any) => {
                requests.push(data);
                assert.ok(responses.length > 0);
                return responses.shift();
            },
            confirmDialog: (_title: string, _text: string, confirm: () => void, cancel: () => void) => {
                confirmations++;
                assert.equal(requests[requests.length - 1].preview, true);
                (accept ? confirm : cancel)();
            },
        }),
    });
    return {
        requests,
        confirmations: () => confirmations,
        sort: () => exports.reorderSortedFileTree(["a", "b"], "c", false),
    };
};

const preview = (conflict: boolean) => ({code: 0, data: {changed: true, conflict}});
const applied = {code: 0, data: {notebook: "notebook", parentPath: "/"}};

test("canceling or closing a conflict dialog does not move documents", async () => {
    const f = fixture([preview(true)]);
    assert.equal(await f.sort(), undefined);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].preview, true);
    assert.equal(f.confirmations(), 1);
});

test("confirmation applies the full selection and relative anchor", async () => {
    const f = fixture([preview(true), applied], true);
    assert.equal(await f.sort(), applied.data);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].removeSorts, true);
    assert.equal(f.requests[1].sourceIDs.join(","), "a,b");
    assert.equal(f.requests[1].targetID, "c");
    assert.equal(f.requests[1].position, "before");
});

test("equal sort values apply without removing rules", async () => {
    const f = fixture([preview(false), applied]);
    await f.sort();
    assert.equal(f.confirmations(), 0);
    assert.equal(f.requests[1].removeSorts, false);
});

test("new conflicts after preview require confirmation", async () => {
    const f = fixture([preview(false), preview(true), preview(true)]);
    assert.equal(await f.sort(), undefined);
    assert.equal(f.requests.length, 3);
    assert.equal(f.requests[2].preview, true);
    assert.equal(f.confirmations(), 1);
});

test("failed and unchanged previews do not write", async () => {
    for (const response of [{code: -1}, {code: 0, data: {changed: false}}]) {
        const f = fixture([response]);
        await f.sort();
        assert.equal(f.requests.length, 1);
        assert.equal(f.confirmations(), 0);
    }
});
