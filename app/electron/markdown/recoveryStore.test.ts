const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createMarkdownRecoveryStore} = require("./recoveryStore");

const format = {bom: false, newline: "\n"};
const target = {handle: "new-target", identity: "new-identity", displayName: "note.md", baseline: "before", writable: true, format};
const draft = (revision = 1, content = "draft", targetGeneration = 0) => ({
    sessionId: "test-session", operationId: "draft-" + revision, targetGeneration, revision, content, format,
});
const transaction = (revision = 1) => ({
    operation: {...draft(revision), operationId: "save-as", targetGeneration: 1, target, reservationId: "reserved", expectedBaseline: "before"},
    previousTarget: {...target, handle: "old-target"},
});
const commit = intent => ({...intent, receipt: {kind: "committed", baseline: "after", durability: "local"}, nextTargetGeneration: 1});

const fixture = async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-recovery-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true});
    });
    return {directory, store: createMarkdownRecoveryStore(directory)};
};

test("empty drafts survive restart with their private target metadata", async t => {
    const {directory, store} = await fixture(t);
    await store.putDraft(draft(1, ""), {path: "/private/note.md"});
    const restarted = createMarkdownRecoveryStore(directory);
    const {records, errors} = await restarted.list();
    assert.equal(errors.length, 0);
    assert.equal(records.length, 1);
    assert.equal(records[0].draft.content, "");
    assert.deepEqual(records[0].hostData, {path: "/private/note.md"});
});

test("saved revision tombstones prevent delayed drafts from returning after restart", async t => {
    const {directory, store} = await fixture(t);
    await store.putDraft(draft(3));
    await store.clearDraft(draft(3));
    const restarted = createMarkdownRecoveryStore(directory);
    await restarted.putDraft(draft(2));
    await restarted.putDraft(draft(3));
    assert.deepEqual(await restarted.list(), {records: [], errors: []});
    await restarted.putDraft(draft(4, "new edit"));
    await restarted.clearDraft(draft(3));
    assert.equal((await restarted.read("test-session")).draft.content, "new edit");
});

test("target generation takes precedence over a stale target revision", async t => {
    const {store} = await fixture(t);
    await store.putDraft(draft(4, "new target", 1));
    await store.putDraft(draft(100, "old target", 0));
    await store.clearDraft(draft(100, "", 0));
    assert.equal((await store.read("test-session")).draft.content, "new target");
});

test("draft inputs are snapshotted before asynchronous persistence", async t => {
    const {store} = await fixture(t);
    const input = draft();
    const writing = store.putDraft(input, {path: "/old.md"});
    input.content = "mutated";
    input.format = {bom: true, newline: "\r"};
    await writing;
    assert.equal((await store.read("test-session")).draft.content, "draft");
    assert.deepEqual((await store.read("test-session")).draft.format, format);
});

test("uncertain Save As retains source and candidate after clearing a source draft", async t => {
    const {directory, store} = await fixture(t);
    await store.putDraft(draft());
    const intent = transaction();
    await store.prepareSaveAs(intent, {source: "/old.md", candidate: "/new.md"});
    await store.clearDraft(draft());
    const records = (await createMarkdownRecoveryStore(directory).list()).records;
    assert.equal(records.length, 1);
    assert.equal(records[0].draft, undefined);
    assert.equal(records[0].intent.operation.content, "draft");
    assert.equal(records[0].intent.previousTarget.handle, "old-target");
    assert.deepEqual(records[0].intent.hostData, {source: "/old.md", candidate: "/new.md"});
    await assert.rejects(store.prepareSaveAs({...intent, operation: {...intent.operation, operationId: "other"}}), {code: "EBUSY"});
});

test("Save As binding commits atomically and retains edits made while writing", async t => {
    const {directory, store} = await fixture(t);
    const intent = transaction();
    await store.putDraft(draft());
    await store.prepareSaveAs(intent);
    await store.putDraft(draft(2, "newer edit"));
    await store.commitSaveAs(commit(intent), {path: "/new.md"});
    await store.commitSaveAs(commit(intent), {path: "/new.md"});
    const record = await createMarkdownRecoveryStore(directory).read("test-session");
    assert.equal(record.intent, undefined);
    assert.equal(record.binding.baseline, "after");
    assert.equal(record.draft.content, "newer edit");
    assert.equal(record.draft.targetGeneration, 1);
    assert.equal(record.draft.target.baseline, "after");
    await store.putDraft(draft(3, "late old target"));
    assert.equal((await store.read("test-session")).draft.content, "newer edit");
});

test("successful Save As cleans only its committed revision and rejects unrelated receipts", async t => {
    const {store} = await fixture(t);
    const intent = transaction();
    await store.prepareSaveAs(intent);
    await assert.rejects(store.commitSaveAs({...commit(intent), operation: {...intent.operation, operationId: "other"}}), {code: "ESTALE"});
    assert.ok((await store.read("test-session")).intent);
    await store.commitSaveAs(commit(intent));
    assert.deepEqual(await store.list(), {records: [], errors: []});
    await store.putDraft(draft(1, "late", 1));
    assert.equal((await store.read("test-session")).draft, undefined);
});

test("aborting a settled candidate preserves the latest source draft", async t => {
    const {store} = await fixture(t);
    await store.prepareSaveAs(transaction());
    await store.putDraft(draft(2, "unsaved source"));
    await assert.rejects(store.abortSaveAs({sessionId: "test-session", operationId: "other"}), {code: "ESTALE"});
    await store.abortSaveAs({sessionId: "test-session", operationId: "save-as"});
    const record = await store.read("test-session");
    assert.equal(record.intent, undefined);
    assert.equal(record.draft.content, "unsaved source");
});

test("failed atomic replacement preserves the last recovery and permits subsequent writes", async t => {
    const {directory, store} = await fixture(t);
    await store.putDraft(draft(1, "protected"));
    let fail = true;
    const failing = createMarkdownRecoveryStore(directory, {fs: {...fs, rename: async (...args) => {
        if (fail) {
            throw Object.assign(new Error("full"), {code: "ENOSPC"});
        }
        return fs.rename(...args);
    }}});
    await assert.rejects(failing.putDraft(draft(2, "failed")), {code: "ENOSPC"});
    assert.equal((await store.read("test-session")).draft.content, "protected");
    assert.equal((await fs.readdir(directory)).length, 1);
    fail = false;
    await failing.putDraft(draft(3, "retried"));
    assert.equal((await store.read("test-session")).draft.content, "retried");
});

test("corrupt and unknown records are reported and never overwritten", async t => {
    const {directory, store} = await fixture(t);
    await store.putDraft(draft());
    const file = path.join(directory, (await fs.readdir(directory))[0]);
    const original = await fs.readFile(file, "utf8");
    for (const corrupted of ["{truncated", original.replace("draft", "changed"), original.replace('"version":1', '"version":2')]) {
        await fs.writeFile(file, corrupted);
        const listed = await store.list();
        assert.equal(listed.records.length, 0);
        assert.equal(listed.errors[0].code, "ECORRUPT");
        await assert.rejects(store.putDraft(draft(2)), {code: "ECORRUPT"});
        assert.equal(await fs.readFile(file, "utf8"), corrupted);
    }
});

test("capacity errors retain existing unsaved drafts without eviction", async t => {
    const {directory, store} = await fixture(t);
    await store.putDraft(draft());
    const limited = createMarkdownRecoveryStore(directory, {limits: {records: 1, documentBytes: 8}});
    await assert.rejects(limited.putDraft({...draft(), sessionId: "second"}), {code: "ENOSPC"});
    assert.throws(() => limited.putDraft(draft(2, "123456789")), {code: "EFBIG"});
    const noSpace = createMarkdownRecoveryStore(directory, {limits: {totalBytes: (await fs.stat(path.join(directory, (await fs.readdir(directory))[0]))).size + 1}});
    await assert.rejects(noSpace.putDraft(draft(2, "large new content")), {code: "ENOSPC"});
    assert.equal((await store.read("test-session")).draft.content, "draft");
});

test("invalid identifiers and counters cannot escape the private recovery directory", async t => {
    const {store} = await fixture(t);
    for (const sessionId of ["../escape", "", "a/b", "a\\b"]) {
        assert.throws(() => store.putDraft({...draft(), sessionId}), {code: "EINVAL"});
        assert.throws(() => store.read(sessionId), {code: "EINVAL"});
    }
    assert.throws(() => store.clearDraft({...draft(), revision: NaN}), {code: "EINVAL"});
    assert.throws(() => store.clearDraft({...draft(), targetGeneration: -1}), {code: "EINVAL"});
});
