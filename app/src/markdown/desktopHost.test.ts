import {test} from "node:test";
import type {TestContext} from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {MarkdownSession} from "./session";
const {MarkdownDesktopHost} = require("../../electron/markdown/host");
const {MarkdownDiskService} = require("../../electron/markdown/disk");
const {createMarkdownRecoveryStore} = require("../../electron/markdown/recoveryStore");

const fixture = async (t: TestContext) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-host-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true});
    });
    const recoveryDirectory = path.join(directory, "recovery");
    const host = new MarkdownDesktopHost({directory: recoveryDirectory});
    return {directory, recoveryDirectory, host};
};
const open = async (host: InstanceType<typeof MarkdownDesktopHost>, file: string) => {
    const sessionId = host.createSession();
    const opened = await host.authorizeOpen(sessionId, file);
    assert.equal(opened.kind, "opened");
    return new MarkdownSession({host, sessionId, target: opened.target, content: opened.content});
};
const edit = (session: MarkdownSession, content: string) => session.updateEditor({content, edited: true, composing: false});
const gate = () => {
    let release: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return {promise, release};
};
const prepare = async (host: InstanceType<typeof MarkdownDesktopHost>, destination: string) => {
    const sessionId = host.createSession();
    const chosen = await host.authorizeSaveAs(sessionId, destination);
    const operationId = sessionId + ":test:1";
    const result = await host.reserveSaveAs({sessionId, operationId, target: chosen.target, format: chosen.target.format});
    const operation = {sessionId, operationId, targetGeneration: 1, revision: 1, content: "candidate", target: result.reservation.target,
        expectedBaseline: chosen.target.baseline, reservationId: result.reservation.id};
    await host.prepareSaveAs({operation});
    return operation;
};

test("real desktop session preserves BOM and CRLF and recognizes its own atomic replacement", async t => {
    const {directory, host} = await fixture(t);
    const file = path.join(directory, "note.md");
    const original = Buffer.from("\uFEFF# title\r\n\r\ntext\r\n");
    await fs.writeFile(file, original);
    const session = await open(host, file);
    await session.flush();
    assert.deepEqual(await fs.readFile(file), original);
    const identity = session.getState().target.identity;
    edit(session, "# changed\n\ncontent\n");
    await session.flush();
    assert.equal(session.getState().status, "saved");
    assert.equal((await fs.readFile(file)).toString(), "\uFEFF# changed\r\n\r\ncontent\r\n");
    assert.equal(session.getState().target.identity, identity);
    assert.equal(await session.reload(), false);
    assert.deepEqual(await host.recovery.list(), {records: [], errors: []});
    assert.equal(await session.close(), true);
});

test("two desktop windows cannot reserve or open the same Save As candidate", async t => {
    const {directory, host} = await fixture(t);
    const file = path.join(directory, "target.md");
    const a = host.createSession();
    const b = host.createSession();
    const results = await Promise.all([host.authorizeSaveAs(a, file), host.authorizeSaveAs(b, file)]);
    assert.equal(results.filter(result => result.kind === "reserved").length, 1);
    const winner = results[0].kind === "reserved" ? a : b;
    const loser = winner === a ? b : a;
    assert.equal(results.find(result => result.kind === "occupied").sessionId, winner);
    const chosen = results.find(result => result.kind === "reserved");
    const session = new MarkdownSession({host, sessionId: winner, content: "candidate"});
    assert.equal((await session.saveAs(chosen.target)).kind, "saved");
    await session.flush();
    assert.equal((await host.authorizeOpen(loser, file)).sessionId, winner);
    assert.equal(await fs.readFile(file, "utf8"), "candidate");
});

test("Save As commits durable binding before releasing the source and later edits reach only the new file", async t => {
    const {directory, host} = await fixture(t);
    const source = path.join(directory, "source.md");
    const target = path.join(directory, "target.md");
    await fs.writeFile(source, "source");
    const session = await open(host, source);
    edit(session, "unsaved");
    const candidate = await host.authorizeSaveAs(session.getState().sessionId, target);
    assert.equal((await session.saveAs(candidate.target)).kind, "saved");
    await session.flush();
    assert.equal(await fs.readFile(source, "utf8"), "source");
    assert.equal(await fs.readFile(target, "utf8"), "unsaved");
    const recovered = await host.recovery.read(session.getState().sessionId);
    assert.equal(recovered.binding.handle, session.getState().target.handle);
    assert.equal(recovered.hostData.selection, target);
    edit(session, "after switch");
    await session.flush();
    assert.equal(session.getState().status, "saved");
    assert.equal(await fs.readFile(source, "utf8"), "source");
    assert.equal(await fs.readFile(target, "utf8"), "after switch");
    const another = host.createSession();
    assert.equal((await host.authorizeOpen(another, source)).kind, "opened");
});

test("an uncertain replacement is reconciled without writing it a second time", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    let replacements = 0;
    const disk = new MarkdownDiskService({replace: async (source: string, destination: string) => {
        replacements++;
        await fs.rename(source, destination);
        throw Object.assign(new Error("lost acknowledgement"), {code: "EIO"});
    }});
    const host = new MarkdownDesktopHost({directory: recoveryDirectory, disk});
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "old");
    const session = await open(host, file);
    edit(session, "written");
    await session.flush();
    assert.equal(session.getState().problem.kind, "indeterminate");
    assert.equal(await session.close(), false);
    const other = host.createSession();
    assert.equal((await host.authorizeOpen(other, file)).kind, "occupied");
    await session.retry();
    await session.flush();
    assert.equal(session.getState().status, "saved");
    assert.equal(replacements, 1);
    assert.equal(await fs.readFile(file, "utf8"), "written");
});

test("Save As binding persistence failure retains both targets and retries only the binding", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    const recovery = createMarkdownRecoveryStore(recoveryDirectory);
    let fail = true;
    const host = new MarkdownDesktopHost({recovery: {...recovery, commitSaveAs: async (...args: unknown[]) => {
        if (fail) throw new Error("disk unavailable");
        return recovery.commitSaveAs(...args);
    }}});
    const source = path.join(directory, "source.md");
    const target = path.join(directory, "new.md");
    await fs.writeFile(source, "old");
    const session = await open(host, source);
    edit(session, "candidate");
    const candidate = await host.authorizeSaveAs(session.getState().sessionId, target);
    assert.equal((await session.saveAs(candidate.target)).kind, "blocked");
    assert.equal(session.getState().problem.kind, "indeterminate");
    assert.equal(await fs.readFile(target, "utf8"), "candidate");
    const other = host.createSession();
    assert.equal((await host.authorizeOpen(other, source)).kind, "occupied");
    assert.equal((await host.authorizeOpen(other, target)).kind, "occupied");
    assert.ok((await recovery.read(session.getState().sessionId)).intent);
    fail = false;
    await session.retry();
    await session.flush();
    assert.equal(session.getState().status, "saved");
    assert.equal((await host.authorizeOpen(other, source)).kind, "opened");
    assert.equal((await recovery.read(session.getState().sessionId)).intent, undefined);
});

test("same-time external changes conflict and external file replacement blocks saving", async t => {
    const {directory, host} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "original");
    const session = await open(host, file);
    const before = await fs.stat(file);
    await fs.writeFile(file, "external");
    await fs.utimes(file, before.atime, before.mtime);
    edit(session, "local");
    await session.flush();
    assert.equal(session.getState().status, "conflict");
    assert.equal(await fs.readFile(file, "utf8"), "external");
    assert.equal(await session.reload({discardChanges: true}), true);
    const replacement = path.join(directory, "replacement.md");
    await fs.writeFile(replacement, "replacement");
    await fs.rename(replacement, file);
    edit(session, "new local");
    await session.flush();
    assert.equal(session.getState().problem.kind, "blocked");
    assert.equal(await fs.readFile(file, "utf8"), "replacement");
});

test("host rejects foreign handles, stale generations, unprepared candidates and request replay changes", async t => {
    const {directory, host} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "original");
    const session = await open(host, file);
    const {sessionId, target} = session.getState();
    const request = {sessionId, operationId: sessionId + ":test-instance:100", targetGeneration: 0, revision: 1,
        content: "write", target, expectedBaseline: target.baseline};
    assert.equal((await host.write({...request, sessionId: host.createSession()})).error.code, "protocol");
    assert.equal((await host.write({...request, targetGeneration: 1})).error.code, "protocol");
    const candidate = await host.authorizeSaveAs(sessionId, path.join(directory, "new.md"));
    assert.equal((await host.write({...request, target: candidate.target, reservationId: candidate.reservationId,
        targetGeneration: 1})).error.code, "protocol");
    const result = await host.write(request);
    assert.equal(result.kind, "committed");
    assert.deepEqual(await host.write(request), result);
    assert.equal((await host.write({...request, content: "replayed overwrite"})).error.code, "protocol");
    assert.equal(await fs.readFile(file, "utf8"), "write");
});

test("a reload can adopt changed BOM and newline conventions before the next write or Save As", async t => {
    const {directory, host} = await fixture(t);
    const source = path.join(directory, "source.md");
    await fs.writeFile(source, "old\n");
    const session = await open(host, source);
    await fs.writeFile(source, "\uFEFFexternal\r\n");
    assert.equal(await session.reload(), true);
    edit(session, "changed\n");
    await session.flush();
    assert.equal(session.getState().status, "saved");
    assert.equal(await fs.readFile(source, "utf8"), "\uFEFFchanged\r\n");
    const destination = path.join(directory, "new.md");
    const chosen = await host.authorizeSaveAs(session.getState().sessionId, destination);
    assert.equal((await session.saveAs(chosen.target)).kind, "saved");
    await session.flush();
    assert.equal(await fs.readFile(destination, "utf8"), "\uFEFFchanged\r\n");
});

test("draft accepted during durable Save As binding migrates before acknowledgement", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    const recovery = createMarkdownRecoveryStore(recoveryDirectory);
    let entered: () => void;
    const committing = new Promise<void>(resolve => { entered = resolve; });
    let release: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const host = new MarkdownDesktopHost({recovery: {...recovery, commitSaveAs: async (...args: unknown[]) => {
        await recovery.commitSaveAs(...args);
        entered();
        await barrier;
    }}});
    const source = path.join(directory, "source.md");
    await fs.writeFile(source, "old");
    const session = await open(host, source);
    const {sessionId, target} = session.getState();
    const chosen = await host.authorizeSaveAs(sessionId, path.join(directory, "new.md"));
    const saving = session.saveAs(chosen.target);
    await committing;
    let acknowledged = false;
    const putting = host.putDraft({sessionId, operationId: sessionId + ":late:100", targetGeneration: 0,
        revision: 2, content: "typed during binding", target, format: target.format}).then(() => { acknowledged = true; });
    await Promise.resolve();
    assert.equal(acknowledged, false);
    release();
    await Promise.all([saving, putting]);
    await session.flush();
    const stored = await recovery.read(sessionId);
    assert.equal(stored.draft.content, "typed during binding");
    assert.equal(stored.draft.targetGeneration, 1);
    assert.equal(stored.draft.target.handle, session.getState().target.handle);
});

test("completed sessions release recovery capacity and cannot revive their tombstones", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    const recovery = createMarkdownRecoveryStore(recoveryDirectory, {limits: {records: 1}});
    const host = new MarkdownDesktopHost({recovery});
    const file = path.join(directory, "file.md");
    await fs.writeFile(file, "original");
    for (let index = 0; index < 3; index++) {
        const session = await open(host, file);
        edit(session, "edit " + index);
        await session.flush();
        assert.equal(session.getState().status, "saved");
        assert.equal(await session.close(), true);
        assert.equal((await fs.readdir(recoveryDirectory)).length, 0);
        await assert.rejects(host.putDraft({...session.getState(), operationId: "stale", format: {bom: false, newline: "\n"}}));
    }
});

test("cancelling an authorized picker target before core handoff releases only that candidate", async t => {
    const {directory, host} = await fixture(t);
    const sessionId = host.createSession();
    const target = path.join(directory, "target.md");
    const chosen = await host.authorizeSaveAs(sessionId, target);
    assert.equal(chosen.kind, "reserved");
    assert.equal((await host.authorizeSaveAs(sessionId, path.join(directory, "other.md"))).kind, "blocked");
    host.cancelAuthorizedSaveAs(sessionId, chosen.target.handle);
    const next = await host.authorizeSaveAs(sessionId, target);
    assert.equal(next.kind, "reserved");
    await host.reserveSaveAs({sessionId, operationId: sessionId + ":test:1", target: next.target, format: next.target.format});
    assert.throws(() => host.cancelAuthorizedSaveAs(sessionId, next.target.handle));
    await host.releaseSaveAs({sessionId, operationId: sessionId + ":test:1", reservationId: next.reservationId});
    await assert.rejects(fs.stat(target), {code: "ENOENT"});
    await host.releaseSession({sessionId, targetGeneration: 0});
});

test("an ignored read with a different format cannot turn a version conflict into a protocol error", async t => {
    const {directory, host} = await fixture(t);
    const file = path.join(directory, "source.md");
    await fs.writeFile(file, "initial\n");
    const session = await open(host, file);
    await fs.writeFile(file, "\uFEFFaccepted\r\n");
    assert.equal(await session.reload(), true);
    const {sessionId, target} = session.getState();
    await fs.writeFile(file, "ignored\r");
    const ignored = await host.read({sessionId, operationId: sessionId + ":" + host.sessions.get(sessionId).instanceId + ":900",
        targetGeneration: 0, target});
    assert.equal(ignored.kind, "read");
    edit(session, "local\n");
    await session.flush();
    assert.equal(session.getState().status, "conflict");
    assert.equal(await fs.readFile(file, "utf8"), "ignored\r");
});

test("closing an untitled session drains accepted drafts and their cleanup before releasing it", async t => {
    const {recoveryDirectory} = await fixture(t);
    const recovery = createMarkdownRecoveryStore(recoveryDirectory);
    const startup = gate();
    const host = new MarkdownDesktopHost({recovery: {...recovery, collectCompleted: () => startup.promise}});
    const sessionId = host.createSession();
    const watermark = {sessionId, targetGeneration: 0, revision: 1};
    const putting = host.putDraft({...watermark, operationId: sessionId + ":test:1", content: "draft", format: {bom: false, newline: "\n"}});
    let closed = false;
    const closing = host.releaseSession({sessionId, targetGeneration: 0}).then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false);
    await assert.rejects(host.putDraft({...watermark, operationId: "late"}));
    startup.release();
    await Promise.all([putting, closing]);
    const record = await recovery.read(sessionId);
    assert.equal(record.draft.content, "draft");
    assert.equal(host.sessions.has(sessionId), false);
    await assert.rejects(host.putDraft({...watermark, operationId: "later"}));
});

test("releasing a prepared Save As reservation closes its write gate before clearing intent", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    const recovery = createMarkdownRecoveryStore(recoveryDirectory);
    const aborting = gate();
    const continueAbort = gate();
    const host = new MarkdownDesktopHost({recovery: {...recovery, abortSaveAs: async (request: unknown) => {
        aborting.release();
        await continueAbort.promise;
        await recovery.abortSaveAs(request);
    }}});
    const file = path.join(directory, "new.md");
    const operation = await prepare(host, file);
    const releasing = host.releaseSaveAs(operation);
    await aborting.promise;
    const write = await host.write(operation);
    assert.equal(write.kind, "blocked");
    assert.equal(write.error.code, "protocol");
    continueAbort.release();
    await releasing;
    await assert.rejects(fs.stat(file), {code: "ENOENT"});
    assert.equal((await recovery.read(operation.sessionId)).intent, undefined);
});

test("concurrent duplicate Save As commits share the same durable operation", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    const recovery = createMarkdownRecoveryStore(recoveryDirectory);
    const committing = gate();
    const continueCommit = gate();
    let commits = 0;
    const host = new MarkdownDesktopHost({recovery: {...recovery, commitSaveAs: async (...args: unknown[]) => {
        commits++;
        committing.release();
        await continueCommit.promise;
        await recovery.commitSaveAs(...args);
    }}});
    const operation = await prepare(host, path.join(directory, "new.md"));
    const receipt = await host.write(operation);
    const request = {operation, receipt, nextTargetGeneration: 1};
    const a = host.commitSaveAs(request);
    await committing.promise;
    const b = host.commitSaveAs(request);
    continueCommit.release();
    const results = await Promise.all([a, b]);
    assert.equal(commits, 1);
    assert.equal(results[0].kind, "committed");
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(await host.commitSaveAs(request), results[0]);
    assert.equal((await host.commitSaveAs({...request, nextTargetGeneration: 9})).error.code, "protocol");
});

test("queued cleanup snapshots its revision before the caller can mutate it", async t => {
    const {host} = await fixture(t);
    const sessionId = host.createSession();
    await host.putDraft({sessionId, operationId: sessionId + ":test:1", targetGeneration: 0, revision: 2,
        content: "newer", format: {bom: false, newline: "\n"}});
    const watermark = {sessionId, targetGeneration: 0, revision: 1};
    const clearing = host.clearDraft(watermark);
    watermark.revision = 100;
    await clearing;
    assert.equal((await host.recovery.read(sessionId)).draft.content, "newer");
});

test("Save As intent snapshots its content before asynchronous startup completes", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    const startup = gate();
    const recovery = createMarkdownRecoveryStore(recoveryDirectory);
    const host = new MarkdownDesktopHost({recovery: {...recovery, collectCompleted: () => startup.promise}});
    const sessionId = host.createSession();
    const chosen = await host.authorizeSaveAs(sessionId, path.join(directory, "new.md"));
    const operationId = sessionId + ":test:1";
    await host.reserveSaveAs({sessionId, operationId, target: chosen.target, format: chosen.target.format});
    const operation = {sessionId, operationId, targetGeneration: 1, revision: 1, content: "snapshot",
        target: chosen.target, expectedBaseline: chosen.target.baseline, reservationId: chosen.reservationId};
    const preparing = host.prepareSaveAs({operation});
    operation.content = "caller mutation";
    startup.release();
    await preparing;
    assert.equal((await recovery.read(sessionId)).intent.operation.content, "snapshot");
    await host.releaseSaveAs(operation);
});

test("Save As waits for a pending source reload before releasing its binding", async t => {
    const {directory, host} = await fixture(t);
    const file = path.join(directory, "source.md");
    await fs.writeFile(file, "source");
    const session = await open(host, file);
    const reading = gate();
    const finishRead = gate();
    const diskRead = host.disk.read.bind(host.disk);
    host.disk.read = async (request: unknown) => {
        reading.release();
        await finishRead.promise;
        return diskRead(request);
    };
    const reloading = session.reload();
    await reading.promise;
    const chosen = await host.authorizeSaveAs(session.getState().sessionId, path.join(directory, "new.md"));
    let finished = false;
    const saving = session.saveAs(chosen.target).then(result => { finished = true; return result; });
    await Promise.resolve();
    assert.equal(finished, false);
    finishRead.release();
    assert.equal((await saving).kind, "saved");
    assert.equal(await reloading, false);
    await session.flush();
    assert.equal(session.getState().targetGeneration, 1);
});

test("drafts follow the durable binding when its acknowledgement or memory commit fails", async t => {
    const {directory, recoveryDirectory} = await fixture(t);
    const recovery = createMarkdownRecoveryStore(recoveryDirectory);
    let fail = true;
    const host = new MarkdownDesktopHost({recovery: {...recovery, commitSaveAs: async (...args: unknown[]) => {
        await recovery.commitSaveAs(...args);
        if (fail) throw new Error("binding acknowledgement lost");
    }}});
    const source = path.join(directory, "source.md");
    await fs.writeFile(source, "source");
    const session = await open(host, source);
    const chosen = await host.authorizeSaveAs(session.getState().sessionId, path.join(directory, "new.md"));
    assert.equal((await session.saveAs(chosen.target)).kind, "blocked");
    edit(session, "edited after durable binding");
    await session.flush();
    const stored = await recovery.read(session.getState().sessionId);
    assert.equal(session.getState().targetGeneration, 0);
    assert.equal(stored.draft.targetGeneration, 1);
    assert.equal(stored.draft.content, "edited after durable binding");
    assert.equal(stored.draft.target.handle, chosen.target.handle);
    fail = false;
    await session.retry();
    await session.flush();
    assert.equal(session.getState().status, "saved");
    assert.equal(await fs.readFile(path.join(directory, "new.md"), "utf8"), "edited after durable binding");
});
