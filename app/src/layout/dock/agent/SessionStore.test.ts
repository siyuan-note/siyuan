import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/SessionStore.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("pinning waits for a new session to be saved and uses the independent metadata endpoint", async () => {
    let resolveSave: (result: unknown) => void;
    let pinFailure = false;
    const calls: {url: string, body: Record<string, unknown>}[] = [];
    const exports = {} as {SessionStore: typeof import("./SessionStore").SessionStore};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Constants: {SIYUAN_APPID: "test-app"},
            fetchSyncPost: (url: string, body: Record<string, unknown>, headers: Record<string, string>) => {
                calls.push({url, body});
                assert.equal(headers["X-SiYuan-App-ID"], "test-app");
                if (url.endsWith("/saveSession")) {
                    return new Promise(resolve => { resolveSave = resolve; });
                }
                assert.equal(url, "/api/ai/agent/setPinned");
                return Promise.resolve(pinFailure ? {code: -1, msg: "Pin rejected"} :
                    {code: 0, data: {pinnedAt: body.pinned ? 123 : 0}});
            },
        }),
    });
    const store = exports.SessionStore;
    const save = store.save({id: "session", title: "New", createdAt: 1, updatedAt: 1});
    const pin = store.setPinned("session", true);
    assert.equal(calls.length, 1);
    resolveSave({code: 0, data: {revision: 1}});
    await save;
    assert.equal(await pin, 123);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.id, "session");
    assert.equal(calls[1].body.pinned, true);
    assert.equal(store.getRevision("session"), 1, "pinning leaves conversation revisions alone");
    assert.equal(await store.setPinned("session", false), 0);
    pinFailure = true;
    await assert.rejects(store.setPinned("session", true), /Pin rejected/);
});

test("a save conflict can reload an older canonical session without replaying the rejected write", async () => {
    const exports = {} as typeof import("./SessionStore");
    const session = {id: "session", title: "Latest content", createdAt: 1, updatedAt: 1, revision: 8};
    let disk = {...session};
    let holdRead = false;
    let finishRead: (result: unknown) => void;
    const submitted: number[] = [];
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Constants: {SIYUAN_APPID: "test-app"},
            fetchSyncPost: (url: string, body: {expectedRevision: number}) => {
                if (url.endsWith("/getSession")) {
                    if (holdRead) {
                        holdRead = false;
                        return new Promise(resolve => { finishRead = resolve; });
                    }
                    return Promise.resolve({code: 0, data: disk});
                }
                assert.ok(url.endsWith("/saveSession"));
                submitted.push(body.expectedRevision);
                if (body.expectedRevision !== disk.revision) {
                    return Promise.resolve({code: -1, msg: "agent session revision conflict", data: {revision: disk.revision}});
                }
                return Promise.resolve({code: 0, data: {revision: disk.revision + 1}});
            },
        }),
    });
    const {SessionStore: store, SessionRevisionConflict} = exports;
    assert.equal((await store.load(session.id))?.revision, 8);
    holdRead = true;
    const inFlight = store.load(session.id);
    await Promise.resolve();
    disk = {...session, title: "Restored content", revision: 3};
    assert.equal(await store.load(session.id), null, "ordinary reads do not accept older versions");
    let conflict: InstanceType<typeof SessionRevisionConflict>;
    await assert.rejects(store.save(session), (error: unknown) => {
        assert.ok(error instanceof SessionRevisionConflict);
        conflict = error;
        return true;
    });
    assert.equal(store.getRevision(session.id), 8, "a rejection does not update the cached revision");
    assert.equal((await store.load(session.id, conflict))?.title, "Restored content");
    assert.deepEqual(submitted, [8]);
    finishRead({code: 0, data: session});
    assert.equal((await inFlight)?.title, "Restored content", "a read started before the rollback cannot restore stale data");
    const canonical = await store.load(session.id);
    assert.equal((await store.save({...canonical, title: "New title"})).revision, 4);
    assert.deepEqual(submitted, [8, 3]);
});
