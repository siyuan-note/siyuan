import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/util/fileTreeReorder.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (responses: any[], accept: boolean | "move" = false,
                 paths: Record<string, {notebook: string, path: string}> = {
                     a: {notebook: "notebook", path: "/parent/a.sy"},
                     b: {notebook: "notebook", path: "/parent/b.sy"},
                     c: {notebook: "notebook", path: "/c.sy"},
                 }, onConfirm?: () => void) => {
    const requests: any[] = [];
    const moves: any[] = [];
    const extraActions: boolean[] = [];
    const messages: unknown[][] = [];
    const processed: unknown[] = [];
    let confirmations = 0;
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: {removeSorts: "Sort", fileTreeDragRemoveSorts: "Confirm",
            _kernel: {87: "Cannot move to this location"}}}},
        require: () => ({
            getRelativeReorderRequest: (sourceIDs: string[], targetID: string, after: boolean) => ({
                sourceIDs, targetID, position: after ? "after" : "before",
            }),
            fetchSyncPost: async (_url: string, data: any, _headers: unknown, process: boolean) => {
                assert.equal(process, false);
                if (_url.endsWith("/getPathByID")) {
                    return paths[data.id] ? {code: 0, data: paths[data.id]} : {code: -1};
                }
                if (_url.endsWith("/moveDocs")) {
                    moves.push(data);
                    return responses.shift();
                }
                requests.push(data);
                assert.ok(responses.length > 0);
                return responses.shift();
            },
            showMessage: (...args: unknown[]) => messages.push(args),
            processMessage: (response: unknown) => processed.push(response),
            confirmDialog: (_title: string, _text: string, confirm: () => void, cancel: () => void,
                            _isDelete: boolean, extraAction?: {callback: () => void}) => {
                confirmations++;
                extraActions.push(!!extraAction);
                assert.equal(requests[requests.length - 1].preview, true);
                onConfirm?.();
                if (accept === "move") {
                    assert.ok(extraAction);
                    extraAction.callback();
                } else {
                    (accept ? confirm : cancel)();
                }
            },
        }),
    });
    return {
        requests,
        moves,
        extraActions,
        messages,
        processed,
        confirmations: () => confirmations,
        sort: () => exports.reorderSortedFileTree(["a", "b"], "c", false),
    };
};

const preview = (conflict: boolean) => ({code: 0, data: {changed: true, conflict}});
const applied = {code: 0, data: {notebook: "notebook", parentPath: "/"}};

test("invalid move targets close automatically after seven seconds in preview and execution", async () => {
    const failure: {code: number, msg: string, data: null} = {code: -1, msg: "Cannot move to this location", data: null};
    for (const responses of [[failure], [preview(false), failure]]) {
        const f = fixture(responses);
        assert.equal(await f.sort(), undefined);
        assert.deepEqual(f.messages, [[failure.msg, 7000, "error"]]);
        assert.ok(!f.processed.includes(failure));
    }
});

test("other reorder errors retain standard message processing", async () => {
    const failure: {code: number, msg: string, data: null} = {code: -1, msg: "Other error", data: null};
    const f = fixture([failure]);
    await f.sort();
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.processed, [failure]);
});

test("canceling or closing a conflict dialog does not move documents", async () => {
    const f = fixture([preview(true)]);
    assert.equal(await f.sort(), undefined);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].preview, true);
    assert.equal(f.confirmations(), 1);
});

test("confirmation applies the full selection and relative anchor", async () => {
    const f = fixture([preview(true), applied], true);
    assert.deepEqual({...await f.sort()}, applied.data);
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

test("keeping sorting moves only documents outside the destination and never reorders", async () => {
    const f = fixture([preview(true), {code: 0}], "move", {
        a: {notebook: "other", path: "/a.sy"},
        b: {notebook: "notebook", path: "/b.sy"},
        c: {notebook: "notebook", path: "/c.sy"},
    });
    assert.deepEqual({...await f.sort()}, applied.data);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.moves)), [{
        fromPaths: ["/a.sy"], toNotebook: "notebook", toPath: "/",
    }]);
});

test("keeping sorting supports multiple documents and nested destinations", async () => {
    const f = fixture([preview(true), {code: 0}], "move", {
        a: {notebook: "notebook", path: "/a.sy"},
        b: {notebook: "notebook", path: "/b.sy"},
        c: {notebook: "notebook", path: "/parent/c.sy"},
    });
    assert.deepEqual({...await f.sort()}, {notebook: "notebook", parentPath: "/parent.sy"});
    assert.deepEqual(JSON.parse(JSON.stringify(f.moves)), [{
        fromPaths: ["/a.sy", "/b.sy"], toNotebook: "notebook", toPath: "/parent.sy",
    }]);
});

test("same-level conflicts do not offer a move that keeps sorting", async () => {
    const f = fixture([preview(true)], false, {
        a: {notebook: "notebook", path: "/a.sy"},
        b: {notebook: "notebook", path: "/b.sy"},
        c: {notebook: "notebook", path: "/c.sy"},
    });
    await f.sort();
    assert.deepEqual(f.extraActions, [false]);
    assert.equal(f.moves.length, 0);
});

test("failed moves do not report success or apply a reorder", async () => {
    const f = fixture([preview(true), {code: -1}], "move");
    assert.equal(await f.sort(), undefined);
    assert.equal(f.moves.length, 1);
    assert.equal(f.requests.length, 1);
});

test("unavailable documents abort before showing the conflict dialog", async () => {
    const f = fixture([preview(true)], false, {});
    assert.equal(await f.sort(), undefined);
    assert.equal(f.confirmations(), 0);
    assert.equal(f.moves.length, 0);
});

test("moving after confirmation resolves the current source and target paths", async () => {
    const paths = {
        a: {notebook: "notebook", path: "/parent/a.sy"},
        b: {notebook: "notebook", path: "/parent/b.sy"},
        c: {notebook: "notebook", path: "/c.sy"},
    };
    const f = fixture([preview(true), {code: 0}], "move", paths, () => {
        paths.a.path = "/new/a.sy";
        paths.c.path = "/new/c.sy";
    });
    assert.deepEqual({...await f.sort()}, {notebook: "notebook", parentPath: "/new.sy"});
    assert.deepEqual(JSON.parse(JSON.stringify(f.moves)), [{
        fromPaths: ["/parent/b.sy"], toNotebook: "notebook", toPath: "/new.sy",
    }]);
});

test("a document removed while the dialog is open prevents the move", async () => {
    const paths: Record<string, {notebook: string, path: string}> = {
        a: {notebook: "notebook", path: "/parent/a.sy"},
        b: {notebook: "notebook", path: "/parent/b.sy"},
        c: {notebook: "notebook", path: "/c.sy"},
    };
    const f = fixture([preview(true)], "move", paths, () => delete paths.a);
    assert.equal(await f.sort(), undefined);
    assert.equal(f.moves.length, 0);
});
