import {test} from "node:test";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {MarkdownDesktopHost} = require("./host");
const {MarkdownDiskService} = require("./disk");
const {MarkdownTargetRegistry} = require("./registry");

const fixture = async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-host-recovery-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true});
    });
    const recovery = path.join(directory, "recovery");
    return {directory, recovery, host: new MarkdownDesktopHost({directory: recovery})};
};
const draft = async (host, file?: string) => {
    const sessionId = host.createSession();
    const opened = file ? await host.authorizeOpen(sessionId, file) : undefined;
    if (opened) assert.equal(opened.kind, "opened");
    await host.putDraft({sessionId, operationId: sessionId + ":test:1", targetGeneration: 0, revision: 2,
        content: "unsaved draft", format: {bom: false, newline: "\n"}, target: opened?.target});
    return sessionId;
};

test("recovery revalidates an unchanged file and durably moves its draft to a new session", async t => {
    const {directory, host, recovery} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "original");
    const id = await draft(host, file);
    assert.equal((await host.listRecoveries()).records.length, 0);
    const restarted = new MarkdownDesktopHost({directory: recovery});
    assert.equal((await restarted.listRecoveries()).records.length, 1);
    const restored = await restarted.restoreRecovery(id);
    assert.notEqual(restored.sessionId, id);
    assert.equal(restored.content, "unsaved draft");
    assert.ok(restored.target);
    assert.deepEqual(restored.recovered, {revision: 2, targetGeneration: 0});
    assert.equal(await fs.readFile(file, "utf8"), "original");
    assert.equal(await restarted.recovery.read(id), undefined);
    assert.equal((await restarted.recovery.read(restored.sessionId)).draft.content, "unsaved draft");
});

test("changed, missing and occupied files recover as copies without overwriting them", async t => {
    for (const condition of ["changed", "missing", "occupied"]) {
        const {directory, host, recovery} = await fixture(t);
        const file = path.join(directory, "note.md");
        await fs.writeFile(file, "original");
        const id = await draft(host, file);
        const restarted = new MarkdownDesktopHost({directory: recovery});
        if (condition === "changed") await fs.writeFile(file, "external content");
        if (condition === "missing") await fs.unlink(file);
        if (condition === "occupied") assert.equal((await restarted.authorizeOpen(restarted.createSession(), file)).kind, "opened");
        const restored = await restarted.restoreRecovery(id);
        assert.equal(restored.target, undefined);
        assert.equal(restored.content, "unsaved draft");
        if (condition === "missing") await assert.rejects(fs.stat(file), {code: "ENOENT"});
        else assert.equal(await fs.readFile(file, "utf8"), condition === "changed" ? "external content" : "original");
    }
});

test("a pending Save As intent recovers its newest content as a copy", async t => {
    const {directory, host, recovery} = await fixture(t);
    const id = await draft(host);
    const chosen = await host.authorizeSaveAs(id, path.join(directory, "candidate.md"));
    const request = {sessionId: id, operationId: id + ":test:2", target: chosen.target, format: chosen.target.format};
    const reserved = await host.reserveSaveAs(request);
    const operation = {...request, target: reserved.reservation.target, targetGeneration: 1, revision: 3,
        content: "newer pending content", expectedBaseline: chosen.target.baseline, reservationId: reserved.reservation.id};
    await host.prepareSaveAs({operation});
    const restarted = new MarkdownDesktopHost({directory: recovery});
    const restored = await restarted.restoreRecovery(id);
    assert.equal(restored.content, "newer pending content");
    assert.equal(restored.target, undefined);
    await assert.rejects(fs.stat(path.join(directory, "candidate.md")), {code: "ENOENT"});
});

test("crashed sessions expose their persisted draft while live sessions cannot be discarded", async t => {
    const {host} = await fixture(t);
    const id = await draft(host);
    await assert.rejects(host.discardRecovery(id));
    host.sessions.get(id).crashed = true;
    assert.equal((await host.listRecoveries()).records.length, 1);
    const restored = await host.restoreRecovery(id);
    assert.equal(restored.content, "unsaved draft");
    assert.equal(host.sessions.has(id), false);
    assert.ok(host.sessions.has(restored.sessionId));
});

test("failed recovery migration retains the source record", async t => {
    const {host, recovery} = await fixture(t);
    const id = await draft(host);
    const restarted = new MarkdownDesktopHost({directory: recovery});
    await restarted.startup;
    restarted.recovery.putDraft = async () => { throw new Error("no space"); };
    await assert.rejects(restarted.restoreRecovery(id), /no space/);
    assert.equal((await restarted.recovery.read(id)).draft.content, "unsaved draft");
    assert.equal(restarted.sessions.size, 0);
});

test("startup reserves persisted session IDs before allocating a new session", async t => {
    const {host, recovery} = await fixture(t);
    const id = await draft(host);
    const next = "20261102180000-new0001";
    const ids = [id, next];
    const restarted = new MarkdownDesktopHost({directory: recovery,
        disk: new MarkdownDiskService({registry: new MarkdownTargetRegistry({createId: () => ids.shift() || next})})});
    await restarted.startup;
    assert.equal(restarted.createSession(), next);
    assert.equal((await restarted.recovery.read(id)).draft.content, "unsaved draft");
    assert.equal((await restarted.listRecoveries()).records.length, 1);
});

test("a pre-startup session collision fails closed without writing or clearing the old draft", async t => {
    const {host, recovery} = await fixture(t);
    const id = await draft(host);
    const before = await host.recovery.read(id);
    const restarted = new MarkdownDesktopHost({directory: recovery,
        disk: new MarkdownDiskService({registry: new MarkdownTargetRegistry({createId: () => id})})});
    assert.equal(restarted.createSession(), id);
    const clear = restarted.clearDraft({sessionId: id, targetGeneration: 0, revision: 100});
    const release = restarted.releaseSession({sessionId: id, targetGeneration: 0});
    const write = restarted.putDraft({sessionId: id, operationId: id + ":new:1", targetGeneration: 0, revision: 100,
        content: "must not replace old draft", format: {bom: false, newline: "\n"}});
    const results = await Promise.allSettled([restarted.startup, clear, release, write]);
    assert.ok(results.every(result => result.status === "rejected"));
    assert.deepEqual(await restarted.recovery.read(id), before);
});

test("persisted SiYuan recovery IDs restore into a fresh session", async t => {
    const {host, recovery} = await fixture(t);
    await host.startup;
    const persisted = "20261102180000-draft01";
    await host.recovery.putDraft({sessionId: persisted, operationId: persisted + ":previous:1", targetGeneration: 0, revision: 1,
        content: "persisted content", format: {bom: false, newline: "\n"}});
    const restarted = new MarkdownDesktopHost({directory: recovery});
    assert.equal((await restarted.listRecoveries()).records[0].watermark.sessionId, persisted);
    const restored = await restarted.restoreRecovery(persisted);
    assert.match(restored.sessionId, /^\d{14}-[a-z0-9]{7}$/);
    assert.equal(restored.content, "persisted content");
    assert.equal(await restarted.recovery.read(persisted), undefined);
});
