const assert = require("node:assert/strict");
const {test} = require("node:test");
const {EventEmitter} = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createMarkdownWindows, registerMarkdownSchemes} = require("./windows");
const {MarkdownDesktopHost} = require("./host");

const fixture = async (t, options = {}) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-windows-"));
    const appDirectory = path.join(directory, "app");
    const build = path.join(appDirectory, "stage", "build", "markdown");
    await fs.mkdir(build, {recursive: true});
    await fs.writeFile(path.join(build, "index.html"), "<!doctype html><title>Markdown</title>");
    await fs.mkdir(path.join(appDirectory, "appearance", "langs"), {recursive: true});
    await fs.writeFile(path.join(appDirectory, "appearance", "langs", "en.json"), JSON.stringify({markdownEditor: "Markdown editor", untitled: "Untitled"}));
    const windows = [];
    let id = 0;
    class BrowserWindow extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.webContents = new EventEmitter();
            this.webContents.id = ++id;
            this.webContents.mainFrame = {url: ""};
            this.webContents.send = (channel, message) => this.webContents.emit("send", channel, message);
            this.webContents.setWindowOpenHandler = callback => { this.webContents.openHandler = callback; };
            this.webContents.session = {
                setPermissionRequestHandler: callback => { this.permissionRequest = callback; },
                setPermissionCheckHandler: callback => { this.permissionCheck = callback; },
                webRequest: {onBeforeRequest: callback => { this.network = callback; }},
                protocol: {handle: (_scheme, callback) => { this.request = callback; }, unhandle() {}},
            };
            windows.push(this);
        }
        isDestroyed() { return this.destroyed || false; }
        isMinimized() { return false; }
        show() { this.shown = true; }
        focus() { this.focused = true; }
        setMenu() {}
        setTitle(title) { this.title = title; }
        setDocumentEdited() {}
        async loadURL(url) {
            this.url = url;
            this.webContents.mainFrame.url = url;
            if (options.failLoad) throw new Error("Page unavailable");
            this.emit("ready-to-show");
        }
        close() {
            let cancelled = false;
            this.emit("close", {preventDefault: () => { cancelled = true; }});
            if (!cancelled) { this.destroyed = true; this.emit("closed"); }
        }
    }
    let receive;
    const opens = [];
    const dialog = {showMessageBox: async () => ({response: 0}), showOpenDialog: async () => ({canceled: true}), showSaveDialog: async () => ({canceled: true})};
    const host = new MarkdownDesktopHost({directory: path.join(directory, "config", "recovery")});
    let emptied = 0;
    const manager = createMarkdownWindows({app: {getLocale: () => "en"}, BrowserWindow,
        ipcMain: {handle: (_channel, callback) => { receive = callback; }}, dialog,
        shell: {openExternal: async url => opens.push(url)}, rootDirectory: appDirectory,
        configDirectory: path.join(directory, "config"), host, onEmpty: () => emptied++});
    const call = (window, action, payload, event = {}) => receive({sender: window.webContents,
        senderFrame: window.webContents.mainFrame, ...event}, action, payload);
    t.after(async () => {
        for (const window of windows) {
            if (!window.isDestroyed()) {
                window.destroyed = true;
                window.emit("closed");
            }
        }
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true, maxRetries: 3});
    });
    return {directory, build, manager, host, windows, call, dialog, opens, emptied: () => emptied};
};

test("Markdown scheme registration grants only required local browser capabilities", () => {
    let registered;
    registerMarkdownSchemes({registerSchemesAsPrivileged: entries => { registered = entries; }});
    assert.equal(registered.length, 1);
    assert.equal(registered[0].scheme, "siyuan-markdown");
    assert.deepEqual(registered[0].privileges, {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true});
});

test("independent windows are sandboxed, deny navigation and reject foreign bridge frames", async t => {
    const {manager, call} = await fixture(t);
    const window = await manager.open();
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.webSecurity, true);
    assert.equal(window.options.webPreferences.webviewTag, false);
    const bootstrap = await call(window, "bootstrap");
    assert.ok(bootstrap.sessionId);
    assert.equal(bootstrap.content, "");
    assert.equal(manager.owns(window.webContents), true);
    assert.deepEqual(window.webContents.openHandler({url: "https://example.com"}), {action: "deny"});
    assert.equal(window.permissionCheck(), false);
    let allowed = true;
    window.permissionRequest(null, "media", value => { allowed = value; });
    assert.equal(allowed, false);
    for (const event of ["will-navigate", "will-frame-navigate", "will-attach-webview"]) {
        let prevented = false;
        window.webContents.emit(event, {preventDefault: () => { prevented = true; }});
        assert.equal(prevented, true);
    }
    await assert.rejects(call(window, "bootstrap", null, {senderFrame: {url: window.url}}));
    await assert.rejects(call(window, "bootstrap", null, {sender: {id: window.webContents.id}}));
    await assert.rejects(call(window, "host:releaseSession", {sessionId: "foreign", targetGeneration: 0}));
    await assert.rejects(call(window, "host:unknown", {}));
});

test("static protocol rejects traversal, cross-session resources and all external requests", async t => {
    const {directory, manager} = await fixture(t);
    const window = await manager.open();
    const origin = new URL(window.url);
    const base = `${origin.protocol}//${origin.host}`;
    const response = await window.request({url: window.url, method: "GET"});
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Markdown/);
    assert.match(response.headers.get("content-security-policy"), /frame-src 'none'/);
    assert.equal(response.headers.get("content-security-policy").includes("unsafe-eval"), false);
    await fs.writeFile(path.join(directory, "private.txt"), "secret");
    for (const url of [base + "/..%2f..%2fprivate.txt", window.url.replace(origin.hostname, "foreign"),
        "file:///private.txt", "https://example.com/file", base + "/resource/missing"]) {
        const result = await window.request({url, method: "GET"});
        assert.notEqual(result.status, 200);
    }
    for (const url of ["https://example.com/pixel", "http://localhost:6806/api/system/getConf", "file:///private.txt"]) {
        let cancelled;
        window.network({url}, result => { cancelled = result.cancel; });
        assert.equal(cancelled, true);
    }
    let cancelled;
    window.network({url: window.url}, result => { cancelled = result.cancel; });
    assert.equal(cancelled, false);
});

test("relative images require a separate directory grant and remain scoped to the session", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "![image](image.png)");
    await fs.writeFile(path.join(directory, "image.png"), Buffer.from([137, 80, 78, 71]));
    const window = await manager.open(file);
    assert.equal(await call(window, "resource", "image.png"), undefined);
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [directory]});
    assert.equal(await call(window, "authorize-resources"), true);
    const resource = await call(window, "resource", "image.png");
    assert.match(resource, /\/resource\/[a-f\d-]+$/);
    assert.equal(resource.includes(directory), false);
    assert.equal(await call(window, "resource", "image.png"), resource);
    assert.equal((await window.request({url: resource, method: "GET"})).status, 200);
    assert.equal(await call(window, "resource", "https://example.com/image.png"), undefined);
    const other = await manager.open();
    assert.equal((await other.request({url: resource, method: "GET"})).status, 403);
});

test("image insertion saves to the chosen new location and grants only that resource", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const document = path.join(directory, "note.md");
    const source = path.join(directory, "source.png");
    const destination = path.join(directory, "new image.png");
    await fs.writeFile(document, "text");
    await fs.writeFile(source, "image bytes");
    const window = await manager.open(document);
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [source]});
    dialog.showSaveDialog = async () => ({canceled: false, filePath: destination});
    assert.deepEqual(await call(window, "insert-image"), {kind: "inserted", reference: "new%20image.png"});
    assert.equal(await fs.readFile(destination, "utf8"), "image bytes");
    assert.equal(await fs.readFile(document, "utf8"), "text");
    assert.ok(await call(window, "resource", "new%20image.png"));
    assert.equal(await call(window, "resource", "source.png"), undefined);
    await fs.writeFile(destination, "existing resource");
    assert.deepEqual(await call(window, "insert-image"), {kind: "blocked"});
    assert.equal(await fs.readFile(destination, "utf8"), "existing resource");
    dialog.showSaveDialog = async () => ({canceled: true});
    assert.deepEqual(await call(window, "insert-image"), {kind: "cancelled"});
});

test("duplicate opens focus their owner and picker reservations are cancelled explicitly", async t => {
    const {directory, manager, windows, call, dialog} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "existing");
    const window = await manager.open(file);
    await manager.open(file);
    assert.equal(windows.length, 1);
    assert.equal(window.focused, true);
    const destination = path.join(directory, "new.md");
    dialog.showSaveDialog = async () => ({canceled: false, filePath: destination});
    const first = await call(window, "save-as", {bom: false, newline: "\n"});
    assert.equal(first.kind, "selected");
    await call(window, "cancel-save-as", first.target.handle);
    const next = await call(window, "save-as", {bom: false, newline: "\n"});
    assert.equal(next.kind, "selected");
    await call(window, "cancel-save-as", next.target.handle);
    await assert.rejects(fs.stat(destination), {code: "ENOENT"});
});

test("quit cancellation thaws windows and close requires completed host release", async t => {
    const {manager, call, emptied} = await fixture(t);
    const window = await manager.open();
    const bootstrap = await call(window, "bootstrap");
    const commands = [];
    window.webContents.on("send", (_channel, command) => {
        commands.push(command.type);
        if (command.type === "prepare-quit") call(window, "response", {id: command.id, accepted: false});
        if (command.type === "close") call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.prepareQuit(), false);
    assert.ok(commands.includes("cancel-quit"));
    assert.equal(await manager.closeAll(), false);
    assert.equal(window.isDestroyed(), false);
    window.webContents.removeAllListeners("send");
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: bootstrap.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.closeAll(), true);
    assert.equal(manager.hasWindows(), false);
    assert.equal(emptied(), 1);
});

test("explicit links permit only web and email schemes", async t => {
    const {manager, call, opens} = await fixture(t);
    const window = await manager.open();
    await call(window, "link", "https://example.com/path");
    await call(window, "link", "mailto:test@example.com");
    for (const url of ["file:///secret", "javascript:alert(1)", "data:text/html,hello", "siyuan://blocks/test", "https://a:b@example.com"]) {
        await assert.rejects(call(window, "link", url));
    }
    assert.deepEqual(opens, ["https://example.com/path", "mailto:test@example.com"]);
});

test("quit during an authorized file read drains the open and never creates a late window", async t => {
    const {directory, manager, host, windows} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "original");
    const authorize = host.authorizeOpen.bind(host);
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    host.authorizeOpen = async (...args) => {
        const opened = await authorize(...args);
        started();
        await wait;
        return opened;
    };
    const opening = manager.open(file);
    await ready;
    assert.equal(manager.hasWindows(), false);
    assert.equal(manager.hasPendingWork(), true);
    const closing = manager.closeAll();
    release();
    await opening;
    assert.equal(await closing, true);
    assert.equal(windows.length, 0);
    assert.equal(host.sessions.size, 0);
    assert.equal(await fs.readFile(file, "utf8"), "original");
});

test("a crashed renderer can close through native recovery protection without a dead bridge", async t => {
    const {manager, host, call, dialog} = await fixture(t);
    const window = await manager.open();
    const {sessionId} = await call(window, "bootstrap");
    await call(window, "host:putDraft", {sessionId, operationId: sessionId + ":test:1", targetGeneration: 0,
        revision: 1, content: "confirmed draft", format: {bom: false, newline: "\n"}});
    window.webContents.emit("render-process-gone");
    assert.equal(host.sessions.get(sessionId).crashed, true);
    dialog.showMessageBox = async () => ({response: 1});
    assert.equal(await manager.closeAll(), false);
    assert.equal(window.isDestroyed(), false);
    dialog.showMessageBox = async () => ({response: 0});
    assert.equal(await manager.prepareQuit(), true);
    dialog.showMessageBox = async () => assert.fail("prepared close must not prompt a second time");
    assert.equal(await manager.closeAll(), true);
    assert.equal(window.isDestroyed(), true);
    assert.equal((await host.recovery.read(sessionId)).draft.content, "confirmed draft");
});

test("a failed page load remains visible and closes through native protection instead of waiting on a dead bridge", async t => {
    const {manager, host, dialog, emptied} = await fixture(t, {failLoad: true});
    const window = await manager.open();
    assert.equal(window.shown, true);
    assert.equal([...host.sessions.values()][0].crashed, true);
    dialog.showMessageBox = async () => ({response: 0});
    assert.equal(await manager.closeAll(), true);
    assert.equal(host.sessions.size, 0);
    assert.equal(manager.hasPendingWork(), false);
    assert.equal(emptied(), 1);
});

const treeFile = async (call, window, name) => {
    const state = await call(window, "tree-state");
    assert.equal(state.kind, "ready");
    const location = {rootId: state.rootId, generation: state.generation, nodeId: state.rootId};
    const result = await call(window, "tree-list", location);
    assert.equal(result.kind, "listed");
    const file = result.entries.find(entry => entry.name === name);
    assert.ok(file, name);
    return {...location, nodeId: file.id};
};

test("tree switching keeps the native container and root while preserving the old draft and rejecting old permissions", async t => {
    const {directory, manager, host, windows, call, dialog} = await fixture(t);
    const first = path.join(directory, "first.md");
    const second = path.join(directory, "second.md");
    await fs.writeFile(first, "first content");
    await fs.writeFile(second, "second content");
    await fs.writeFile(path.join(directory, "image.png"), "image");
    const window = await manager.open(first);
    const originalURL = window.url;
    const initial = await call(window, "bootstrap");
    const originalRoot = await call(window, "tree-state");
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [directory]});
    await call(window, "authorize-resources");
    const oldResource = await call(window, "resource", "image.png");
    const selected = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    assert.equal(selected.kind, "ready");
    assert.notEqual(selected.sessionId, initial.sessionId);
    assert.equal(selected.content, undefined);
    assert.equal(host.sessions.size, 2);
    assert.equal((await call(window, "bootstrap")).sessionId, initial.sessionId);
    await assert.rejects(call(window, "tree-commit-open", selected.ticket));
    await call(window, "host:putDraft", {sessionId: initial.sessionId, operationId: initial.sessionId + ":test:1",
        targetGeneration: 0, revision: 1, content: "unsaved first", format: initial.target.format, target: initial.target});
    await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
    const next = await call(window, "tree-commit-open", selected.ticket);
    assert.equal(next.sessionId, selected.sessionId);
    assert.equal(next.content, "second content");
    assert.deepEqual(await call(window, "tree-commit-open", selected.ticket), next);
    assert.equal((await call(window, "bootstrap")).sessionId, selected.sessionId);
    assert.equal(windows.length, 1);
    assert.equal(window.url, originalURL);
    assert.equal((await call(window, "tree-state")).rootId, originalRoot.rootId);
    assert.equal((await host.recovery.read(initial.sessionId)).draft.content, "unsaved first");
    assert.equal((await window.request({url: oldResource, method: "GET"})).status, 404);
    assert.equal(await call(window, "resource", "image.png"), undefined);
    await assert.rejects(call(window, "host:read", {sessionId: initial.sessionId, targetGeneration: 0,
        operationId: initial.sessionId + ":test:2", target: initial.target}));
    await call(window, "state", {sessionId: next.sessionId, status: "saved", revision: 0, savedRevision: 0});
    const title = window.title;
    await call(window, "state", {sessionId: initial.sessionId, status: "dirty", revision: 99, savedRevision: 0});
    assert.equal(window.title, title);
    await manager.open(second);
    assert.equal(windows.length, 1);
    assert.equal(window.focused, true);
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: next.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.closeAll(), true);
    assert.equal(host.sessions.size, 0);
});

test("tree current, occupied, invalid and cancelled selections leave the current editor and registry intact", async t => {
    const {directory, manager, host, windows, call} = await fixture(t);
    for (const [name, content] of [["first.md", "first"], ["second.md", "second"], ["large.md", "x".repeat(8 * 1024 * 1024 + 1)],
        ["invalid.md", Buffer.from([255])], ["free.md", "free"]]) await fs.writeFile(path.join(directory, name), content);
    const window = await manager.open(path.join(directory, "first.md"));
    const second = await manager.open(path.join(directory, "second.md"));
    const initial = await call(window, "bootstrap");
    assert.deepEqual(await call(window, "tree-prepare-open", await treeFile(call, window, "first.md")), {kind: "current"});
    assert.deepEqual(await call(window, "tree-prepare-open", await treeFile(call, window, "second.md")), {kind: "occupied"});
    assert.equal(second.focused, true);
    assert.equal((await call(window, "tree-prepare-open", await treeFile(call, window, "large.md"))).error.code, "size");
    assert.equal((await call(window, "tree-prepare-open", await treeFile(call, window, "invalid.md"))).error.code, "encoding");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "free.md"));
    assert.equal(candidate.kind, "ready");
    await call(window, "tree-cancel-open", candidate.ticket);
    await call(window, "tree-cancel-open", candidate.ticket);
    await assert.rejects(call(window, "tree-commit-open", candidate.ticket));
    assert.equal(host.sessions.size, 2);
    assert.equal(host.disk.registry.entries.size, 2);
    assert.equal(windows.length, 2);
    assert.equal((await call(window, "bootstrap")).sessionId, initial.sessionId);
});

test("choosing a root changes only the file tree and grants no image access", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const file = path.join(directory, "first.md");
    const other = path.join(directory, "other");
    await fs.writeFile(file, "first");
    await fs.mkdir(other);
    await fs.writeFile(path.join(other, "image.png"), "image");
    const window = await manager.open(file);
    const initial = await call(window, "bootstrap");
    const previous = await call(window, "tree-state");
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [other]});
    const result = await call(window, "tree-choose-root");
    assert.equal(result.kind, "ready");
    assert.equal(result.rootName, "other");
    assert.equal(result.currentNodeId, undefined);
    assert.equal(result.generation, previous.generation + 1);
    assert.equal((await call(window, "tree-state")).rootId, result.rootId);
    assert.equal((await call(window, "bootstrap")).sessionId, initial.sessionId);
    assert.equal(await call(window, "resource", "other/image.png"), undefined);
    dialog.showOpenDialog = async () => ({canceled: true});
    assert.deepEqual(await call(window, "tree-choose-root"), {kind: "cancelled"});
    assert.equal((await call(window, "tree-state")).rootId, result.rootId);
});

test("quit waits for candidate authorization and closes without a late session or native window", async t => {
    const {directory, manager, host, windows, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    const location = await treeFile(call, window, "second.md");
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const authorize = host.authorizeOpen.bind(host);
    host.authorizeOpen = async (...args) => {
        const result = await authorize(...args);
        started();
        await waiting;
        return result;
    };
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    const preparing = call(window, "tree-prepare-open", location);
    await ready;
    const closing = manager.closeAll();
    release();
    assert.equal((await preparing).kind, "blocked");
    assert.equal(await closing, true);
    assert.equal(host.sessions.size, 0);
    assert.equal(host.disk.registry.entries.size, 0);
    assert.equal(windows.length, 1);
    assert.equal(window.isDestroyed(), true);
});

test("closing a prepared but uncommitted switch releases its candidate", async t => {
    const {directory, manager, host, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    assert.equal(candidate.kind, "ready");
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.closeAll(), true);
    assert.equal(host.sessions.size, 0);
    assert.equal(host.disk.registry.entries.size, 0);
});

const saveAsThroughBridge = async ({call, window, dialog, sessionId, target, generation, sequence, file}) => {
    dialog.showSaveDialog = async () => ({canceled: false, filePath: file});
    const selected = await call(window, "save-as", target.format);
    assert.equal(selected.kind, "selected");
    const operationId = sessionId + ":test:" + sequence;
    const reserved = await call(window, "host:reserveSaveAs", {sessionId, operationId, target: selected.target, format: target.format});
    assert.equal(reserved.kind, "reserved");
    const operation = {sessionId, operationId, targetGeneration: generation + 1, revision: sequence,
        content: "saved copy", target: reserved.reservation.target, expectedBaseline: selected.target.baseline,
        reservationId: reserved.reservation.id};
    await call(window, "host:prepareSaveAs", {operation, previousTarget: target});
    const receipt = await call(window, "host:write", operation);
    assert.equal(receipt.kind, "committed");
    const result = await call(window, "host:commitSaveAs", {operation, previousTarget: target, receipt, nextTargetGeneration: generation + 1});
    assert.equal(result.kind, "committed");
    return result.target;
};

test("Save As retains an enclosing root and follows the parent when saving outside it", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const notes = path.join(directory, "notes");
    const other = path.join(directory, "other");
    await fs.mkdir(notes);
    await fs.mkdir(other);
    await fs.writeFile(path.join(notes, "first.md"), "first");
    const window = await manager.open(path.join(notes, "first.md"));
    const initial = await call(window, "bootstrap");
    const root = await call(window, "tree-state");
    const next = await saveAsThroughBridge({call, window, dialog, sessionId: initial.sessionId, target: initial.target,
        generation: 0, sequence: 1, file: path.join(notes, "copy.md")});
    assert.equal((await call(window, "tree-state")).rootId, root.rootId);
    await saveAsThroughBridge({call, window, dialog, sessionId: initial.sessionId, target: next,
        generation: 1, sequence: 2, file: path.join(other, "copy.md")});
    const after = await call(window, "tree-state");
    assert.equal(after.rootName, "other");
    assert.notEqual(after.rootId, root.rootId);
    assert.equal(after.generation, root.generation + 1);
});

test("Save As during switch protection retains the selected tree until that switch is cancelled", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const notes = path.join(directory, "notes");
    const other = path.join(directory, "other");
    await fs.mkdir(notes);
    await fs.mkdir(other);
    await fs.writeFile(path.join(notes, "first.md"), "first");
    await fs.writeFile(path.join(notes, "second.md"), "second");
    const window = await manager.open(path.join(notes, "first.md"));
    const initial = await call(window, "bootstrap");
    const root = await call(window, "tree-state");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    assert.equal(candidate.kind, "ready");
    await saveAsThroughBridge({call, window, dialog, sessionId: initial.sessionId, target: initial.target,
        generation: 0, sequence: 1, file: path.join(other, "copy.md")});
    assert.equal((await call(window, "tree-state")).rootId, root.rootId);
    await call(window, "tree-cancel-open", candidate.ticket);
    assert.equal((await call(window, "tree-state")).rootName, "other");
});

test("a resource picker completed after switching cannot grant access to the new document", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    await fs.writeFile(path.join(directory, "image.png"), "image");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    let finishPicker;
    dialog.showOpenDialog = () => new Promise(resolve => { finishPicker = resolve; });
    const resourceGrant = call(window, "authorize-resources");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
    await call(window, "tree-commit-open", candidate.ticket);
    finishPicker({canceled: false, filePaths: [directory]});
    assert.equal(await resourceGrant, false);
    assert.equal(await call(window, "resource", "image.png"), undefined);
});

test("a candidate being cancelled cannot be committed while its release is still pending", async t => {
    const {directory, manager, host, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
    const releaseSession = host.releaseSession.bind(host);
    let finish;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const waiting = new Promise(resolve => { finish = resolve; });
    host.releaseSession = async request => {
        if (request.sessionId === candidate.sessionId) { started(); await waiting; }
        return releaseSession(request);
    };
    const cancelling = call(window, "tree-cancel-open", candidate.ticket);
    await ready;
    await assert.rejects(call(window, "tree-commit-open", candidate.ticket));
    finish();
    await cancelling;
    assert.equal(host.sessions.size, 0);
});

test("native destruction drains a candidate read, retains the durable draft and releases settled sessions", async t => {
    const {directory, manager, host, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    await call(window, "host:putDraft", {sessionId: initial.sessionId, operationId: initial.sessionId + ":test:1",
        targetGeneration: 0, revision: 1, content: "durable content", format: initial.target.format, target: initial.target});
    const location = await treeFile(call, window, "second.md");
    let finish;
    let started;
    let cleaned;
    const ready = new Promise(resolve => { started = resolve; });
    const waiting = new Promise(resolve => { finish = resolve; });
    const cleanup = new Promise(resolve => { cleaned = resolve; });
    const authorize = host.authorizeOpen.bind(host);
    host.authorizeOpen = async (...args) => {
        const result = await authorize(...args);
        started();
        await waiting;
        return result;
    };
    const releaseSession = host.releaseSession.bind(host);
    host.releaseSession = async request => {
        await releaseSession(request);
        if (request.sessionId === initial.sessionId) cleaned();
    };
    const preparing = call(window, "tree-prepare-open", location);
    await ready;
    window.destroyed = true;
    window.emit("closed");
    finish();
    assert.equal((await preparing).kind, "blocked");
    await cleanup;
    assert.equal(host.sessions.size, 0);
    assert.equal(host.disk.registry.entries.size, 0);
    assert.equal((await host.recovery.read(initial.sessionId)).draft.content, "durable content");
});
