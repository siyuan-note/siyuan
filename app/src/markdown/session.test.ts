import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {MarkdownSession} from "./session";
import type {
    MarkdownCommitted, MarkdownDraft, MarkdownDraftWatermark, MarkdownHost, MarkdownReadResult,
    MarkdownReservation, MarkdownSaveAsCommitResult, MarkdownTarget, MarkdownWriteRequest, MarkdownWriteResult,
} from "./contracts";

const deferred = <T>() => {
    let resolve: (value: T) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
};
const turn = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const target = (handle: string, writable = true): MarkdownTarget => ({
    handle, identity: `identity:${handle}`, displayName: `${handle}.md`, baseline: `baseline:${handle}`, writable,
    format: {bom: false, newline: "\n"},
    capabilities: {persistentPermission: true, conditionalWrite: false, atomicReplace: true, coordinatedAccess: false},
});
const committed = (baseline = "saved"): MarkdownCommitted => ({kind: "committed", baseline, durability: "local"});
const edit = (session: MarkdownSession, content: string) => session.updateEditor({content, edited: true, composing: false});

class MemoryHost implements MarkdownHost {
    writes: MarkdownWriteRequest[] = [];
    reservations = new Map<string, {sessionId: string; reservation: MarkdownReservation}>();
    owners = new Map<string, string>();
    prepared: MarkdownWriteRequest[] = [];
    released: string[] = [];
    closed: string[] = [];
    drafts = new Map<string, MarkdownDraft>();
    watermarks = new Map<string, number>();
    cleared: MarkdownDraftWatermark[] = [];
    read: MarkdownHost["read"] = async request => ({kind: "read", content: "external", target: {...request.target, baseline: "external"}});
    writeResult: (request: MarkdownWriteRequest) => Promise<MarkdownWriteResult> = async request => committed(`saved:${request.revision}`);
    reconcileWrite: MarkdownHost["reconcileWrite"] = async () => committed("reconciled");
    commitResult?: (request: Parameters<MarkdownHost["commitSaveAs"]>[0]) => Promise<MarkdownSaveAsCommitResult>;
    putResult?: (draft: MarkdownDraft) => Promise<void>;

    async write(request: MarkdownWriteRequest) {
        this.writes.push(request);
        return this.writeResult(request);
    }

    async reserveSaveAs(request: Parameters<MarkdownHost["reserveSaveAs"]>[0]): ReturnType<MarkdownHost["reserveSaveAs"]> {
        const owner = this.owners.get(request.target.handle) ?? this.reservations.get(request.target.handle)?.sessionId;
        if (owner && owner !== request.sessionId) return {kind: "occupied", sessionId: owner};
        const reservation = {id: request.operationId, target: {...request.target, format: request.format}};
        this.reservations.set(request.target.handle, {sessionId: request.sessionId, reservation});
        return {kind: "reserved", reservation};
    }

    async prepareSaveAs(request: Parameters<MarkdownHost["prepareSaveAs"]>[0]) {
        this.prepared.push(request.operation);
    }

    async commitSaveAs(request: Parameters<MarkdownHost["commitSaveAs"]>[0]): ReturnType<MarkdownHost["commitSaveAs"]> {
        if (this.commitResult) return this.commitResult(request);
        if (request.previousTarget) this.owners.delete(request.previousTarget.handle);
        this.reservations.delete(request.operation.target.handle);
        this.owners.set(request.operation.target.handle, request.operation.sessionId);
        return {kind: "committed", target: {...request.operation.target, baseline: request.receipt.baseline}};
    }

    async releaseSaveAs(request: Parameters<MarkdownHost["releaseSaveAs"]>[0]) {
        this.released.push(request.reservationId);
        for (const [key, value] of this.reservations) {
            if (value.reservation.id === request.reservationId) this.reservations.delete(key);
        }
    }

    async putDraft(draft: MarkdownDraft) {
        if (this.putResult) await this.putResult(draft);
        const key = `${draft.sessionId}/${draft.targetGeneration}`;
        if (draft.revision > (this.watermarks.get(key) ?? -1) && draft.revision >= (this.drafts.get(key)?.revision ?? -1)) {
            this.drafts.set(key, draft);
        }
    }

    async clearDraft(watermark: MarkdownDraftWatermark) {
        this.cleared.push(watermark);
        const key = `${watermark.sessionId}/${watermark.targetGeneration}`;
        this.watermarks.set(key, Math.max(watermark.revision, this.watermarks.get(key) ?? -1));
        if ((this.drafts.get(key)?.revision ?? -1) <= watermark.revision) this.drafts.delete(key);
    }

    async releaseSession(request: Parameters<MarkdownHost["releaseSession"]>[0]) {
        this.closed.push(request.sessionId);
    }
}

const create = (host = new MemoryHost(), sessionId = "a", initialTarget: MarkdownTarget = target("original")) => {
    host.owners.set(initialTarget.handle, sessionId);
    return {host, session: new MarkdownSession({sessionId, host, content: "initial", target: initialTarget})};
};

describe("MarkdownSession save transactions", () => {
    it("does not save initialization, normalization, or a mode-only event", async () => {
        const {host, session} = create();
        session.updateEditor({content: "normalized", edited: false, composing: false});
        await session.flush();
        assert.equal(session.getState().content, "initial");
        assert.equal(host.writes.length, 0);
        assert.equal(host.drafts.size, 0);
    });

    it("serializes slow writes and coalesces newer edits without clearing their dirty state", async () => {
        const {host, session} = create();
        const first = deferred<MarkdownWriteResult>();
        const second = deferred<MarkdownWriteResult>();
        host.writeResult = request => request.revision === 1 ? first.promise : second.promise;
        edit(session, "one");
        const saving = session.save();
        await turn();
        edit(session, "two");
        edit(session, "three");
        assert.equal(host.writes.length, 1);
        first.resolve(committed("first"));
        await turn();
        assert.equal(session.getState().savedRevision, 1);
        assert.equal(session.getState().status, "saving");
        assert.equal(host.writes.length, 2);
        assert.equal(host.writes[0].content, "one");
        assert.equal(host.writes[1].content, "three");
        assert.equal(host.writes[1].expectedBaseline, "first");
        second.resolve(committed("second"));
        await saving;
        await session.flush();
        assert.equal(session.getState().savedRevision, 3);
        assert.equal(session.getState().status, "saved");
    });

    it("flushes editor-internal delayed input but never writes during IME composition", async () => {
        const {host, session} = create();
        session.updateEditor({content: "composing", edited: true, composing: true});
        await session.save();
        assert.equal(host.writes.length, 0);
        assert.equal(await session.close(), false);
        await session.flush({flush: () => ({content: "committed input", edited: true, composing: false})});
        assert.equal(host.writes.length, 1);
        assert.equal(host.writes[0].content, "committed input");
    });

    it("rejects an asynchronous editor snapshot that predates a committed edit", async () => {
        const {host, session} = create();
        const snapshot = deferred<{content: string; edited: boolean; composing: boolean}>();
        const flushing = session.flush({flush: () => snapshot.promise});
        edit(session, "newer input");
        snapshot.resolve({content: "older delayed input", edited: true, composing: false});
        assert.equal(await flushing, false);
        assert.equal(session.getState().content, "newer input");
        assert.equal(host.writes.length, 0);
    });

    it("keeps read-only copy edits in a draft", async () => {
        const {host, session} = create(new MemoryHost(), "a", target("readonly", false));
        assert.equal(session.getState().status, "view");
        edit(session, "copy edit");
        await session.flush();
        assert.equal(host.writes.length, 0);
        assert.equal(host.drafts.get("a/0").content, "copy edit");
        assert.equal(session.getState().status, "blocked");
    });

    it("retains an indeterminate operation and reconciles without repeating its write", async () => {
        const {host, session} = create();
        host.writeResult = async () => { throw new Error("acknowledgement lost"); };
        edit(session, "one");
        await session.flush();
        assert.equal(session.getState().problem.kind, "indeterminate");
        assert.equal(await session.close(), false);
        assert.equal(host.closed.length, 0);
        await session.save();
        assert.equal(host.writes.length, 1);
        await session.retry();
        assert.equal(host.writes.length, 1);
        assert.equal(session.getState().status, "saved");
        assert.equal(session.getState().target.baseline, "reconciled");
    });

    it("requires explicit retry after a definite failure and scopes overwrite to one baseline", async () => {
        const {host, session} = create();
        host.writeResult = async () => ({kind: "blocked", error: {code: "offline", recoverable: true}});
        edit(session, "local");
        await session.save();
        await session.save();
        assert.equal(host.writes.length, 1);
        host.writeResult = async () => ({kind: "conflict", baseline: "external one"});
        await session.retry();
        assert.equal(session.getState().status, "conflict");
        assert.equal(await session.overwrite("other"), false);
        host.writeResult = async request => {
            assert.equal(request.expectedBaseline, "external one");
            return {kind: "conflict", baseline: "external two"};
        };
        assert.equal(await session.overwrite("external one"), false);
        assert.equal(session.getState().problem.kind, "conflict");
        assert.equal(await session.overwrite("external one"), false);
    });

    it("allows corrected content after a size or encoding rejection without retrying the invalid snapshot", async () => {
        for (const code of ["size", "encoding"] as const) {
            const {host, session} = create();
            host.writeResult = async () => ({kind: "blocked", error: {code, recoverable: false}});
            edit(session, "invalid content");
            await session.save();
            await session.retry();
            assert.equal(host.writes.length, 1);
            host.writeResult = async () => committed();
            edit(session, "corrected content");
            await session.save();
            assert.equal(host.writes.length, 2);
            assert.equal(host.writes[1].content, "corrected content");
            assert.equal(session.getState().status, "saved");
        }
    });
});

describe("MarkdownSession Save As", () => {
    it("reserves a target before the first write and rejects another active owner", async () => {
        const {host, session} = create();
        host.owners.set("other", "b");
        edit(session, "local");
        assert.deepEqual(await session.saveAs(target("other")), {kind: "occupied", sessionId: "b"});
        assert.equal(host.writes.length, 0);
        assert.equal(session.getState().target.handle, "original");
        assert.equal(session.getState().content, "local");
    });

    it("captures delayed editor input for Save As without first overwriting the original", async () => {
        const {host, session} = create();
        const result = await session.saveAs(target("new"), {editor: {
            flush: () => ({content: "latest delayed input", edited: true, composing: false}),
        }});
        assert.deepEqual(result, {kind: "saved"});
        assert.equal(host.writes.length, 1);
        assert.equal(host.writes[0].target.handle, "new");
        assert.equal(host.writes[0].content, "latest delayed input");
    });

    it("preserves newer edits when an asynchronous Save As editor capture becomes stale", async () => {
        const {host, session} = create();
        const snapshot = deferred<{content: string; edited: boolean; composing: boolean}>();
        const saving = session.saveAs(target("new"), {editor: {flush: () => snapshot.promise}});
        await turn();
        edit(session, "newer edit");
        snapshot.resolve({content: "older capture", edited: true, composing: false});
        assert.deepEqual(await saving, {kind: "blocked"});
        assert.equal(host.writes.length, 0);
        assert.equal(host.reservations.size, 0);
        assert.equal(session.getState().content, "newer edit");
    });

    it("releases the unused target when editor capture fails or cancellation precedes the transaction", async () => {
        const {host, session} = create();
        assert.deepEqual(await session.saveAs(target("capture"), {editor: {
            flush: () => { throw new Error("editor unavailable"); },
        }}), {kind: "blocked"});
        const cancellation = new AbortController();
        cancellation.abort();
        assert.deepEqual(await session.saveAs(target("cancelled"), {signal: cancellation.signal}), {kind: "cancelled"});
        assert.equal(host.writes.length, 0);
        assert.equal(host.reservations.size, 0);
        assert.equal(host.released.length, 2);
        assert.equal(session.getState().target.handle, "original");
    });

    it("lets only one of two sessions write the same new target", async () => {
        const host = new MemoryHost();
        const a = create(host, "a", target("a")).session;
        const b = create(host, "b", target("b")).session;
        const pending = deferred<MarkdownWriteResult>();
        host.writeResult = async request => {
            assert.equal(host.reservations.get("new").sessionId, request.sessionId);
            assert.equal(host.prepared.length, 1);
            return pending.promise;
        };
        edit(a, "a edit");
        edit(b, "b edit");
        const saving = a.saveAs(target("new"));
        await turn();
        assert.deepEqual(await b.saveAs(target("new")), {kind: "occupied", sessionId: "a"});
        assert.equal(host.writes.length, 1);
        pending.resolve(committed());
        assert.deepEqual(await saving, {kind: "saved"});
        assert.equal(host.owners.get("new"), "a");
    });

    it("waits for old writes and switches only after a durable binding commit", async () => {
        const {host, session} = create();
        const oldWrite = deferred<MarkdownWriteResult>();
        const binding = deferred<MarkdownSaveAsCommitResult>();
        host.writeResult = request => request.target.handle === "original" ? oldWrite.promise : Promise.resolve(committed("new"));
        host.commitResult = () => binding.promise;
        edit(session, "one");
        const oldSaving = session.save();
        await turn();
        const savingAs = session.saveAs(target("new"));
        edit(session, "two");
        await turn();
        assert.equal(host.writes.length, 1);
        oldWrite.resolve(committed("old"));
        await oldSaving;
        await turn();
        assert.equal(host.writes[1].content, "two");
        assert.equal(host.writes[1].targetGeneration, 1);
        assert.equal(session.getState().target.handle, "original");
        assert.equal(session.getState().targetGeneration, 0);
        binding.resolve({kind: "committed", target: {...target("new"), baseline: "new"}});
        assert.deepEqual(await savingAs, {kind: "saved"});
        assert.equal(session.getState().target.handle, "new");
        assert.equal(session.getState().savedRevision, 2);
    });

    it("keeps an old uncertain write when Save As was queued before its acknowledgement", async () => {
        const {host, session} = create();
        const oldWrite = deferred<MarkdownWriteResult>();
        host.writeResult = () => oldWrite.promise;
        edit(session, "old target input");
        const saving = session.save();
        await turn();
        const savingAs = session.saveAs(target("new"));
        oldWrite.resolve({kind: "indeterminate", error: {code: "io", recoverable: true}});
        await saving;
        assert.deepEqual(await savingAs, {kind: "blocked"});
        assert.equal(host.writes.length, 1);
        assert.equal(host.reservations.size, 0);
        assert.equal(session.getState().target.handle, "original");
        let reconciled: MarkdownWriteRequest;
        host.reconcileWrite = async request => {
            reconciled = request;
            return committed("settled original");
        };
        await session.retry();
        assert.equal(reconciled.target.handle, "original");
        assert.equal(session.getState().status, "saved");
        assert.equal(session.getState().targetGeneration, 0);
    });

    it("preserves source encoding and saves edits made while the new target is writing", async () => {
        const original = {...target("original"), format: {bom: true, newline: "\r\n" as const}};
        const {host, session} = create(new MemoryHost(), "a", original);
        const first = deferred<MarkdownWriteResult>();
        host.writeResult = request => request.revision === 1 ? first.promise : Promise.resolve(committed("latest"));
        edit(session, "one");
        const saving = session.saveAs(target("new"));
        await turn();
        edit(session, "two");
        first.resolve(committed("first"));
        await saving;
        assert.equal(host.writes.length, 2);
        assert.deepEqual(host.writes[0].target.format, original.format);
        assert.equal(host.writes[1].target.handle, "new");
        assert.equal(host.writes[1].content, "two");
        assert.equal(session.getState().status, "saved");
    });

    it("retains the candidate reservation while the write result or binding is uncertain", async () => {
        const {host, session} = create();
        host.writeResult = async () => ({kind: "indeterminate", error: {code: "io", recoverable: true}});
        edit(session, "local");
        assert.deepEqual(await session.saveAs(target("new")), {kind: "blocked"});
        assert.equal(host.released.length, 0);
        assert.equal(host.reservations.has("new"), true);
        assert.equal(session.getState().target.handle, "original");
        host.commitResult = async () => ({kind: "blocked", error: {code: "space", recoverable: true}});
        await session.retry();
        assert.equal(session.getState().target.handle, "original");
        assert.equal(session.getState().problem.kind, "indeterminate");
        assert.equal(host.released.length, 0);
        host.commitResult = undefined;
        await session.retry();
        assert.equal(session.getState().target.handle, "new");
        assert.equal(host.writes.length, 1);
    });

    it("releases a cancelled reservation before writing and finishes a started transaction", async () => {
        const {host, session} = create();
        const signal = new AbortController();
        const prepare = deferred<void>();
        host.prepareSaveAs = () => prepare.promise;
        const cancelled = session.saveAs(target("cancelled"), {signal: signal.signal});
        await turn();
        signal.abort();
        prepare.resolve();
        assert.deepEqual(await cancelled, {kind: "cancelled"});
        assert.equal(host.writes.length, 0);
        assert.equal(host.reservations.size, 0);
        const secondSignal = new AbortController();
        const write = deferred<MarkdownWriteResult>();
        host.writeResult = () => write.promise;
        const completing = session.saveAs(target("completed"), {signal: secondSignal.signal});
        await turn();
        secondSignal.abort();
        write.resolve(committed());
        assert.deepEqual(await completing, {kind: "saved"});
        assert.equal(session.getState().target.handle, "completed");
    });

    it("releases a definite write failure and retains the original binding", async () => {
        const {host, session} = create();
        host.writeResult = async () => ({kind: "blocked", error: {code: "space", recoverable: true}});
        edit(session, "local");
        await session.saveAs(target("new"));
        assert.equal(host.reservations.size, 0);
        assert.equal(host.released.length, 1);
        assert.equal(session.getState().target.handle, "original");
        assert.equal(session.getState().content, "local");
    });

    it("never applies a candidate conflict version or retry to the original target", async () => {
        const {host, session} = create();
        host.writeResult = async () => ({kind: "conflict", baseline: "candidate external version"});
        edit(session, "local");
        await session.saveAs(target("candidate"));
        assert.equal(session.getState().problemTargetHandle, "candidate");
        assert.equal(await session.overwrite("candidate external version"), false);
        await session.retry();
        assert.equal(host.writes.length, 1);
        assert.equal(session.getState().target.baseline, "baseline:original");
        host.writeResult = async () => ({kind: "blocked", error: {code: "offline", recoverable: true}});
        await session.saveAs(target("candidate"));
        await session.retry();
        assert.equal(host.writes.length, 2);
        assert.equal(host.writes.every(request => request.target.handle === "candidate"), true);
    });

    it("coalesces queued reconciliation attempts without creating a phantom uncertainty", async () => {
        const {host, session} = create();
        host.writeResult = async () => ({kind: "indeterminate", error: {code: "io", recoverable: true}});
        edit(session, "local");
        await session.save();
        await Promise.all([session.retry(), session.retry()]);
        assert.equal(session.getState().status, "saved");
        assert.equal(host.writes.length, 1);
    });
});

describe("MarkdownSession reload races", () => {
    it("invalidates a read before pending editor input has produced a Markdown snapshot", async () => {
        const {host, session} = create();
        const read = deferred<MarkdownReadResult>();
        host.read = () => read.promise;
        const reloading = session.reload();
        session.invalidateReload();
        read.resolve({kind: "read", content: "external", target: {...target("original"), baseline: "external"}});
        assert.equal(await reloading, false);
        assert.equal(session.getState().content, "initial");
        assert.equal(session.getState().target.baseline, "baseline:original");
        assert.equal(session.getState().savedRevision, 0);
        assert.equal(host.writes.length, 0);
        edit(session, "pending input");
        assert.equal(session.getState().content, "pending input");
    });

    it("does not apply a read after a newer edit or change its baseline", async () => {
        const {host, session} = create();
        const read = deferred<MarkdownReadResult>();
        host.read = () => read.promise;
        const reloading = session.reload();
        edit(session, "new input");
        read.resolve({kind: "read", content: "external", target: {...target("original"), baseline: "external"}});
        assert.equal(await reloading, false);
        assert.equal(session.getState().content, "new input");
        assert.equal(session.getState().target.baseline, "baseline:original");
        assert.equal(session.getState().savedRevision, 0);
    });

    it("invalidates a read when composition starts even if composition is later cancelled", async () => {
        const {host, session} = create();
        const read = deferred<MarkdownReadResult>();
        host.read = () => read.promise;
        const reloading = session.reload();
        session.updateEditor({content: "initial", edited: false, composing: true});
        session.updateEditor({content: "initial", edited: false, composing: false});
        read.resolve({kind: "read", content: "external", target: target("original")});
        assert.equal(await reloading, false);
        assert.equal(session.getState().content, "initial");
    });

    it("applies only the latest overlapping read and never writes it back", async () => {
        const {host, session} = create();
        const old = deferred<MarkdownReadResult>();
        const latest = deferred<MarkdownReadResult>();
        let calls = 0;
        host.read = () => calls++ === 0 ? old.promise : latest.promise;
        const firstReload = session.reload();
        const secondReload = session.reload();
        latest.resolve({kind: "read", content: "newest", target: {...target("original"), baseline: "newest"}});
        assert.equal(await secondReload, true);
        old.resolve({kind: "read", content: "old", target: {...target("original"), baseline: "old"}});
        assert.equal(await firstReload, false);
        await session.flush();
        assert.equal(session.getState().content, "newest");
        assert.equal(session.getState().target.baseline, "newest");
        assert.equal(host.writes.length, 0);
    });

    it("rejects stale reads after target switching or closing", async () => {
        const {host, session} = create();
        const read = deferred<MarkdownReadResult>();
        host.read = () => read.promise;
        const reloading = session.reload();
        await session.saveAs(target("new"));
        read.resolve({kind: "read", content: "old result", target: target("original")});
        assert.equal(await reloading, false);
        assert.equal(session.getState().target.handle, "new");
        const second = deferred<MarkdownReadResult>();
        host.read = () => second.promise;
        const closingRead = session.reload();
        assert.equal(await session.close(), true);
        second.resolve({kind: "read", content: "late", target: target("new")});
        assert.equal(await closingRead, false);
        assert.equal(session.getState().status, "closed");
        assert.equal(edit(session, "late input"), false);
    });

    it("blocks external identity replacement and protects dirty edits", async () => {
        const {host, session} = create();
        host.read = async () => ({kind: "read", content: "replacement", target: {...target("original"), identity: "other"}});
        assert.equal(await session.reload(), false);
        assert.equal(session.getState().content, "initial");
        assert.equal(session.getState().problem.kind, "blocked");
        edit(session, "dirty");
        host.read = async () => ({kind: "read", content: "external", target: {...target("original"), baseline: "external"}});
        assert.equal(await session.reload(), false);
        assert.equal(session.getState().status, "conflict");
        const problem = session.getState().problem;
        assert.equal(problem.kind === "conflict" && problem.baseline, "external");
        assert.equal(session.getState().target.baseline, "baseline:original");
        assert.equal(session.getState().content, "dirty");
    });

    it("ignores a self-write notification while collecting the external version for a real conflict", async () => {
        const {host, session} = create();
        edit(session, "local");
        host.read = async request => ({kind: "read", content: "initial", target: request.target});
        assert.equal(await session.reload(), false);
        assert.equal(session.getState().status, "dirty");
        host.read = async request => ({kind: "read", content: "external", target: {...request.target, baseline: "external"}});
        assert.equal(await session.reload(), false);
        assert.equal(await session.overwrite("external"), true);
        assert.equal(host.writes[0].expectedBaseline, "external");
    });
});

describe("MarkdownSession recovery", () => {
    it("closes an untouched blank document without creating a recovery record", async () => {
        const host = new MemoryHost();
        const session = new MarkdownSession({sessionId: "blank", host});
        assert.equal(session.getState().hasUnsavedChanges, false);
        assert.equal(await session.close(), true);
        assert.equal(host.drafts.size, 0);
        assert.equal(host.writes.length, 0);
        assert.equal(host.closed.length, 1);
    });

    it("still preserves edited-to-empty and recovered empty drafts", async () => {
        const host = new MemoryHost();
        const session = new MarkdownSession({sessionId: "edited-empty", host});
        edit(session, "input");
        edit(session, "");
        await session.flush();
        assert.equal(session.getState().hasUnsavedChanges, true);
        assert.equal(host.drafts.get("edited-empty/0").content, "");
        const recovered = new MarkdownSession({sessionId: "recovered-empty", host, content: "",
            recovered: {revision: 0, targetGeneration: 0}});
        assert.equal(recovered.getState().hasUnsavedChanges, true);
        assert.equal(await recovered.close(), true);
        assert.equal(host.drafts.get("recovered-empty/0").content, "");
    });

    it("can explicitly save an untouched blank document as an empty file", async () => {
        const host = new MemoryHost();
        const session = new MarkdownSession({sessionId: "empty-file", host});
        assert.deepEqual(await session.saveAs(target("empty-target")), {kind: "saved"});
        assert.equal(host.writes.length, 1);
        assert.equal(host.writes[0].content, "");
        assert.equal(session.getState().status, "saved");
        assert.equal(session.getState().hasUnsavedChanges, false);
    });

    it("does not clear a newer recovery revision when an older write succeeds", async () => {
        const {host, session} = create();
        const firstWrite = deferred<MarkdownWriteResult>();
        const nextWrite = deferred<MarkdownWriteResult>();
        host.writeResult = request => request.revision === 1 ? firstWrite.promise : nextWrite.promise;
        edit(session, "one");
        const saving = session.save();
        await turn();
        edit(session, "two");
        await turn();
        firstWrite.resolve(committed("one"));
        await turn();
        assert.equal(host.drafts.get("a/0").revision, 2);
        assert.equal(host.drafts.get("a/0").content, "two");
        nextWrite.resolve({kind: "blocked", error: {code: "offline", recoverable: true}});
        await saving;
        assert.equal(await session.close(), true);
        assert.equal(host.drafts.get("a/0").content, "two");
    });

    it("waits for a pending draft before closing and refuses close if neither copy is durable", async () => {
        const {host, session} = create();
        const draft = deferred<void>();
        host.putResult = () => draft.promise;
        host.writeResult = async () => ({kind: "blocked", error: {code: "offline", recoverable: true}});
        edit(session, "local");
        const closing = session.close();
        await turn();
        assert.equal(host.closed.length, 0);
        draft.reject(new Error("disk full"));
        assert.equal(await closing, false);
        assert.equal(session.getState().lifecycle, "open");
        assert.equal(session.getState().content, "local");
        assert.equal(session.getState().recoveryError.code, "io");
    });

    it("claims closing before an asynchronous editor flush and rejects concurrent close and reload", async () => {
        const {host, session} = create();
        const editor = deferred<{content: string; edited: boolean; composing: boolean}>();
        const closing = session.close({flush: () => editor.promise});
        assert.equal(session.getState().lifecycle, "closing");
        assert.equal(await session.close(), false);
        assert.equal(await session.reload(), false);
        assert.deepEqual(await session.saveAs(target("another")), {kind: "blocked"});
        editor.resolve({content: "latest input", edited: true, composing: false});
        assert.equal(await closing, true);
        assert.equal(host.writes[0].content, "latest input");
        assert.equal(host.closed.length, 1);
    });

    it("restores drafts without automatically overwriting the revalidated external file", async () => {
        const host = new MemoryHost();
        const session = new MarkdownSession({sessionId: "recovered", host, content: "recovery", target: target("file"),
            recovered: {revision: 43, targetGeneration: 2}});
        await session.flush();
        assert.equal(host.writes.length, 0);
        assert.equal(session.getState().status, "conflict");
        assert.equal(session.getState().content, "recovery");
        assert.equal(session.getState().revision, 43);
        assert.equal(session.getState().targetGeneration, 2);
        assert.equal(await session.overwrite("baseline:file"), true);
        assert.equal(host.writes.length, 1);
        assert.equal(host.writes[0].revision, 43);
    });

    it("drafts an untitled document without reporting it saved to an original file", async () => {
        const host = new MemoryHost();
        const session = new MarkdownSession({sessionId: "untitled", host});
        edit(session, "new document");
        await session.flush();
        assert.equal(session.getState().status, "draft");
        assert.equal(session.getState().draftRevision, 1);
        assert.equal(host.writes.length, 0);
        assert.equal(await session.close(), true);
    });

    it("uses distinct transaction identities when restoring the same persistent session", async () => {
        const host = new MemoryHost();
        const first = new MarkdownSession({sessionId: "persistent", host, content: "first", target: target("file")});
        edit(first, "one");
        await first.flush();
        const restored = new MarkdownSession({sessionId: "persistent", host, content: "restored", target: target("file"),
            recovered: {revision: 2, targetGeneration: 0}});
        await restored.overwrite("baseline:file");
        assert.notEqual(host.writes[0].operationId, host.writes[1].operationId);
        assert.equal(host.writes[1].revision, 2);
    });
});
