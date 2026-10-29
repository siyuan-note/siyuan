import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {queueTransaction} from "../util/transactionQueue";

interface EditorState {
    owner: IProtyle;
    saved: string;
    revision: string;
    refreshPending: boolean;
    composing: boolean;
    disposed: boolean;
    fragment: {getBlockHTML: () => string, protyle: {wysiwyg: {flushPendingInput: () => void}, upload?: {isUploading: boolean}}};
    flush: (acceptedRevision?: string) => Promise<void>;
    refresh: () => Promise<void>;
    showConflict: () => void;
    copyDraftAndReload: () => Promise<boolean>;
    applyValue: (value: {blockDOM: string, revision: string}) => void;
    destroy: () => void;
}
interface Request {
    transactions: Array<{doOperations: Array<{id: string, data: {blockDOM: string, expectedRevision: string}}>}>;
}

const setup = () => {
    let html = "initial";
    let clipboardStatus = "rich";
    let acknowledgements = 0;
    let conflicts = 0;
    const copies: unknown[] = [];
    const requests: Array<{data: Request, resolve: (value: unknown) => void}> = [];
    const source = transpileModule(readFileSync(join(__dirname, "documentTitleEditor.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const moduleExports: {DocumentTitleEditor?: {prototype: EditorState}} = {};
    runInNewContext(source, {
        exports: moduleExports, clearTimeout,
        window: {siyuan: {languages: {settingsPendingSaveError: "Save failed", uploading: "Uploading"}}},
        require: (name: string) => {
            if (name === "../../constants") return {Constants: {SIYUAN_APPID: "app"}};
            if (name === "../../util/fetch") return {fetchSyncPost: (_url: string, data: Request) =>
                new Promise(resolve => requests.push({data, resolve}))};
            if (name === "../util/transactionQueue") return {queueTransaction};
            if (name === "../../dialog/message") return {showMessage: () => {}};
            if (name === "../util/editorSave") return {acknowledgeDocumentTitleReload: () => acknowledgements++};
            if (name === "../util/blockDOMClipboard") return {buildBlockDOMClipboardData: (_lute: unknown, value: string) =>
                ({textPlain: value, textHTML: value, textSiyuan: value})};
            if (name === "../util/richClipboard") return {prepareExternalClipboardHTML: (value: string) => value};
            if (name === "../util/compatibility") return {writeClipboardData: async (data: unknown) => {
                copies.push(data); return {status: clipboardStatus};
            }};
            if (name === "./documentTitleDOM") return {
                prepareDocumentTitleBlockDOM: (value: string) => value,
                getDocumentTitleDOMFingerprint: (value: string) => value,
            };
            return {};
        },
    });
    let mirrors = 0;
    let refreshes = 0;
    const state: EditorState = Object.create(moduleExports.DocumentTitleEditor.prototype);
    Object.defineProperty(state, "editable", {value: {blur: () => {}}});
    Object.assign(state, {
        owner: {id: "owner", block: {rootID: "document"}, undo: {add: () => mirrors++}},
        saved: "initial", revision: "r0", composing: false, disposed: false, refreshPending: false,
        fragment: {getBlockHTML: () => html, protyle: {wysiwyg: {flushPendingInput: () => {}}}},
        refresh: async () => { refreshes++; state.refreshPending = false; },
        showConflict: () => { conflicts++; },
        applyValue: (value: {blockDOM: string, revision: string}) => {
            html = value.blockDOM; state.saved = html; state.revision = value.revision;
        },
    });
    const finish = (index: number, revision: string) => requests[index].resolve({code: 0,
        data: [{doOperations: [{action: "setDocTitle", id: "document", retData: revision}]}]});
    return {state, requests, finish, setHTML: (value: string) => { html = value; },
        setClipboardStatus: (value: string) => { clipboardStatus = value; }, copies,
        counts: () => ({mirrors, refreshes, acknowledgements, conflicts})};
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("title saves serialize the current source revision while retaining edits made during an acknowledgement", async () => {
    const {state, requests, finish, setHTML, counts} = setup();
    setHTML("first edit");
    const first = state.flush();
    await tick();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.transactions[0].doOperations[0].data.expectedRevision, "r0");
    setHTML("second edit with formatting");
    const second = state.flush();
    await tick();
    assert.equal(requests.length, 1);
    finish(0, "r1");
    await tick();
    assert.equal(requests.length, 2);
    const operation = requests[1].data.transactions[0].doOperations[0];
    assert.equal(operation.id, "document");
    assert.equal(operation.data.expectedRevision, "r1");
    assert.equal(operation.data.blockDOM, "second edit with formatting");
    finish(1, "r2");
    await Promise.all([first, second]);
    assert.equal(state.saved, "second edit with formatting");
    assert.equal(state.revision, "r2");
    assert.equal(counts().mirrors, 2);
    assert.ok(counts().refreshes >= 1);
});

test("rejected title writes keep the draft and revision so a retry cannot silently overwrite another editor", async () => {
    const {state, requests, finish, setHTML} = setup();
    setHTML("local draft");
    const failure = assert.rejects(state.flush(), /Conflict/);
    await tick();
    requests[0].resolve({code: -1, msg: "Conflict", data: null});
    await failure;
    assert.equal(state.saved, "initial");
    assert.equal(state.revision, "r0");
    assert.equal(state.fragment.getBlockHTML(), "local draft");
    const retry = state.flush();
    await tick();
    assert.equal(requests[1].data.transactions[0].doOperations[0].data.expectedRevision, "r0");
    finish(1, "r1");
    await retry;
    assert.equal(state.saved, "local draft");
});

test("composition and readonly drafts reject handoff while destroyed title editors never submit text", async () => {
    const {state, requests, setHTML} = setup();
    setHTML("composing");
    state.composing = true;
    await assert.rejects(state.flush(), /Save failed/);
    state.composing = false;
    state.owner.disabled = true;
    await assert.rejects(state.flush(), /Save failed/);
    assert.equal(state.fragment.getBlockHTML(), "composing");
    assert.equal(state.saved, "initial");
    setHTML("initial");
    await state.flush();
    state.owner.disabled = false;
    state.disposed = true;
    await state.flush();
    assert.equal(requests.length, 0);
});

test("readonly handoff waits for an in-flight title acknowledgement and still protects newer draft text", async () => {
    const {state, requests, finish, setHTML} = setup();
    setHTML("submitted text");
    const saving = state.flush();
    await tick();
    assert.equal(requests.length, 1);
    setHTML("newer text before readonly");
    state.owner.disabled = true;
    const failedSave = assert.rejects(saving, /Save failed/);
    const readonlyHandoff = assert.rejects(state.flush(), /Save failed/);
    finish(0, "r1");
    await Promise.all([failedSave, readonlyHandoff]);
    assert.equal(state.saved, "submitted text");
    assert.equal(state.fragment.getBlockHTML(), "newer text before readonly");
    assert.equal(requests.length, 1);
});

test("title flush also saves input arriving during its final source refresh", async () => {
    const {state, requests, finish, setHTML} = setup();
    state.refresh = Object.getPrototypeOf(state).refresh;
    Object.assign(state, {refreshVersion: 0, refreshPending: true, onSummary: () => {}, refreshDynamicAnchors: () => {}});
    const flushing = state.flush();
    await tick();
    assert.equal(requests.length, 1, "clean title waits for its pending source refresh");
    setHTML("typed during source refresh");
    requests[0].resolve({code: 0, data: {text: "initial", empty: false, blockDOM: "initial", revision: "r0"}});
    await tick();
    assert.equal(requests.length, 2, "late input must be submitted before handoff resolves");
    assert.equal(requests[1].data.transactions[0].doOperations[0].data.blockDOM, "typed during source refresh");
    finish(1, "r1");
    await tick();
    assert.equal(requests.length, 3);
    requests[2].resolve({code: 0, data: {text: "typed during source refresh", empty: false,
        blockDOM: "typed during source refresh", revision: "r1"}});
    await flushing;
    assert.equal(state.saved, "typed during source refresh");
});

test("readonly changes during fragment input processing cannot submit an unconfirmed draft", async () => {
    const {state, requests, setHTML} = setup();
    setHTML("pending draft");
    let finishInput: () => void;
    state.fragment.protyle.wysiwyg.flushPendingInput = () => new Promise<void>(resolve => { finishInput = resolve; });
    const flushing = assert.rejects(state.flush(), /Save failed/);
    state.owner.disabled = true;
    finishInput();
    await flushing;
    assert.equal(requests.length, 0);
    assert.equal(state.fragment.getBlockHTML(), "pending draft");
});

test("CAS conflicts offer recovery and only a confirmed lossless copy permits reloading source", async () => {
    const {state, requests, setHTML, counts, copies, setClipboardStatus} = setup();
    setHTML("local source including image and styles");
    const failure = assert.rejects(state.flush(), /Conflict/);
    await tick();
    requests[0].resolve({code: -409, msg: "Conflict", data: null});
    await failure;
    assert.equal(counts().conflicts, 1);
    setClipboardStatus("plain");
    const failedCopy = state.copyDraftAndReload();
    requests[1].resolve({code: 0, data: {blockDOM: "remote source", revision: "remote-revision"}});
    assert.equal(await failedCopy, false);
    assert.equal(state.fragment.getBlockHTML(), "local source including image and styles");
    assert.equal(counts().acknowledgements, 0);
    setClipboardStatus("rich");
    const recovery = state.copyDraftAndReload();
    requests[2].resolve({code: 0, data: {blockDOM: "remote source", revision: "remote-revision"}});
    assert.equal(await recovery, true);
    assert.equal(state.fragment.getBlockHTML(), "remote source");
    assert.equal(state.revision, "remote-revision");
    assert.equal(counts().acknowledgements, 1);
    assert.equal((copies[1] as {textSiyuan: string}).textSiyuan, "local source including image and styles");
});

test("manual conflict resolution uses only the displayed revision and never rewrites the acknowledged source revision early", async () => {
    const {state, requests, finish, setHTML} = setup();
    setHTML("my title");
    const saving = state.flush("displayed-remote-revision");
    await tick();
    assert.equal(requests[0].data.transactions[0].doOperations[0].data.expectedRevision, "displayed-remote-revision");
    assert.equal(state.revision, "r0");
    finish(0, "r2");
    await saving;
    assert.equal(state.revision, "r2");
});

test("an unfinished title upload prevents owner flush from discarding its pending image", async () => {
    const {state, requests, setHTML} = setup();
    setHTML("pending image source");
    state.fragment.protyle.upload = {isUploading: true};
    await assert.rejects(state.flush(), /Uploading/);
    assert.equal(requests.length, 0);
    assert.equal(state.fragment.getBlockHTML(), "pending image source");
});

test("destroy clears decrypted title and conflict previews before the dialog closing animation completes", () => {
    const {state} = setup();
    const order: string[] = [];
    Object.assign(state, {conflictDialog: {
        element: {querySelector: () => ({replaceChildren: () => order.push("clear-preview")})},
        destroy: () => order.push("start-dialog-animation"),
    }});
    Object.assign(state.fragment, {destroy: () => order.push("destroy-fragment"),
        wysiwyg: {replaceChildren: () => order.push("clear-title")}});
    state.destroy();
    assert.equal(state.disposed, true);
    assert.deepEqual(order, ["clear-preview", "start-dialog-animation", "destroy-fragment", "clear-title"]);
});

test("destroyed title input tasks and queued saves cannot submit cleared content or replay a removed source", async () => {
    for (const stage of ["input", "queue"]) {
        const {state, requests, setHTML} = setup();
        setHTML("unsaved secret draft");
        Object.assign(state.fragment, {destroy: () => {}, wysiwyg: {replaceChildren: () => setHTML("")}});
        let resume: () => void;
        if (stage === "input") {
            state.fragment.protyle.wysiwyg.flushPendingInput = () => new Promise<void>(resolve => { resume = resolve; });
        } else {
            void queueTransaction(state.owner, () => new Promise<void>(resolve => { resume = resolve; }));
        }
        const saving = state.flush();
        await tick();
        state.destroy();
        resume();
        await saving;
        assert.equal(requests.length, 0, stage);
        assert.equal(state.fragment.getBlockHTML(), "");
    }
});

test("late title success and conflict responses cannot restore undo state or plaintext dialogs after destruction", async () => {
    for (const success of [true, false]) {
        const {state, requests, finish, setHTML, counts} = setup();
        setHTML("submitted secret draft");
        Object.assign(state.fragment, {destroy: () => {}, wysiwyg: {replaceChildren: () => setHTML("")}});
        const saving = state.flush();
        await tick();
        assert.equal(requests.length, 1);
        state.destroy();
        if (success) finish(0, "r1");
        else requests[0].resolve({code: -409, msg: "Conflict", data: null});
        await saving;
        assert.equal(counts().mirrors, 0);
        assert.equal(counts().refreshes, 0);
        assert.equal(counts().conflicts, 0);
        assert.equal(state.fragment.getBlockHTML(), "");
    }
});
