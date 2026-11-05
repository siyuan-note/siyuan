import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {transpileModule, ScriptTarget} from "typescript";

const source = readFileSync(path.join(__dirname, "index.ts"), "utf8");
const section = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const initialize = section("    const initializeDocument =", '    try {\n        if (!("inert"');
const complete = section("    const completeSwitch =", "    const openTreeFile =");
const actions = section("    const runAction =", "    const action =");
const command = section("    const command =", "    unsubscribeInitialization();");

const setup = () => {
    const renders: unknown[] = [];
    const callbacks: Array<Record<string, (...args: any[]) => any>> = [];
    const editors: Array<{destroyed: boolean; destroy(): void}> = [];
    const responses: boolean[] = [];
    const preferenceWrites: unknown[] = [];
    const openedLinks: string[] = [];
    let failEditor = false;
    let resolveResource: (value: string) => void;
    const resource = new Promise<string>(resolve => {resolveResource = resolve;});
    const element = {className: "", inert: true, textContent: "", replaceChildren() {}, setAttribute() {}};
    const bridge = {
        host: {}, resolveResource: () => resource, openLink: async (url: string) => {openedLinks.push(url);},
        preferences: async (patch: Partial<import("./bridge").MarkdownPreferences>) => {preferenceWrites.push({...patch});},
        tree: {commitOpen: async () => snapshot("b")}, bootstrap: async () => snapshot("b"),
        respond: async (_id: string, accepted: boolean) => {responses.push(accepted);},
    };
    class Session {
        constructor(readonly options: {sessionId: string; content: string; onChange(state: unknown): void}) {}
        getState() {return {sessionId: this.options.sessionId, lifecycle: "open", content: this.options.content};}
        updateEditor() {this.options.onChange(this.getState());}
        invalidateReload() {}
    }
    const deps = {
        MarkdownSession: Session, bridge, renders, callbacks, URL, clearTimeout,
        location: {href: "https://editor.invalid/"},
        createMarkdownEditor: async (options: Record<string, (...args: any[]) => any>) => {
            callbacks.push(options);
            if (failEditor) throw new Error("Editor unavailable");
            const editor = {destroyed: false, destroy() {this.destroyed = true;}};
            editors.push(editor);
            return editor;
        },
        control: () => element, root: element, text: (key: string) => key,
        render: (state: unknown) => renders.push(state), reportError: () => {}, scheduleAutoSave: () => {},
        modeChoice: {setValue() {}}, tree: {syncSelection: async () => {}, refresh: async () => {}},
        windowChrome: undefined as undefined, checkpointBackground: async () => {throw new Error("Unready editor must not checkpoint");},
        applyTheme: async () => {}, protectExit: async () => {throw new Error("Unready editor must not close");},
    };
    // 执行实际生命周期函数，只替换编辑器、宿主和界面边界；无显示服务器时也能验证异步流程。
    const body = transpileModule(`
        let bootstrap, editor, session, autoSave, pendingSwitch, switchTask, pendingFileAction;
        let disposed = false, initializationClosing = false, documentGeneration = 0, targetGeneration = 0;
        let actionMessage = "", resourceUnavailable = false, editPending = false, sourceOnly = false, history;
        let outline = {enabled: false, visible: false, available: false};
        let preferences = {mode: "ir", theme: "light"}, systemDark = false, preparing = false, prepared = false;
        let activeMode = preferences.mode;
        let switching = true, frozen = true, exitSequence = 0;
        const freeze = value => {frozen = value;};
        ${initialize}\n${complete}\n${command}\n${actions}
        return {initializeDocument, completeSwitch, command, runAction, waitActions: () => pendingFileAction,
            pending(value) {pendingSwitch = value;}, task(value) {switchTask = value;},
            dispose() {disposed = true; documentGeneration++;},
            state: () => ({editor, session, pendingSwitch, frozen, documentGeneration, history, outline, resourceUnavailable, preferences, activeMode})};
    `, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const lifecycle = new Function("deps", `with (deps) { ${body} }`)(deps);
    return {lifecycle, callbacks, editors, renders, responses, bridge, resolveResource, preferenceWrites, openedLinks,
        failEditor(value: boolean) {failEditor = value;}};
};
const snapshot = (sessionId: string) => ({sessionId, content: sessionId + "\n", lang: "en", preferences: {mode: "ir", theme: "light"}});

test("the Markdown footer stays hidden during normal editing and saving but exposes actionable problems", () => {
    const controls = new Map<string, {textContent: string; hidden: boolean; dataset: Record<string, string>; setAttribute(): void}>();
    const control = (name: string) => {
        if (!controls.has(name)) controls.set(name, {textContent: "", hidden: false, dataset: {}, setAttribute() {}});
        return controls.get(name);
    };
    const deps = {control, document: {title: ""}, text: (key: string) => key,
        markdownErrorKey: (error: {code: string}) => error.code,
        bridge: {state: async () => {}}, modeChoice: {setDisabled() {}}};
    const body = transpileModule(`
        let disposed = false, actionMessage = "", editPending = false, pendingSwitch, frozen = false;
        let resourceUnavailable = false, sourceOnly = false, targetGeneration = 0;
        const history = {canUndo: false, canRedo: false}, bootstrap = {recovered: false};
        const outline = {enabled: false, visible: false, available: false};
        ${section("    const render =", "    const reportError =")}
        return (state, pending = false, message = "", switching = false) => {
            editPending = pending; actionMessage = message; pendingSwitch = switching;
            render(state);
        };
    `, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const render = new Function("deps", `with (deps) { ${body} }`)(deps);
    const state = {status: "saved", targetGeneration: 0, revision: 1, draftRevision: 1, hasUnsavedChanges: false};
    for (const status of ["view", "draft", "dirty", "saving", "saved"]) {
        for (const pending of [false, true]) {
            render({...state, status}, pending);
            assert.equal(control("markdownFooter").hidden, true, `${status}, pending=${pending}`);
        }
    }
    for (const problem of [{kind: "blocked", error: {code: "io", recoverable: true}},
        {kind: "indeterminate", error: {code: "io"}}, {kind: "conflict", baseline: "old"}]) {
        render({...state, status: problem.kind === "conflict" ? "conflict" : "blocked", problem});
        assert.equal(control("markdownFooter").hidden, false, problem.kind);
    }
    render({...state, recoveryError: {code: "io"}});
    assert.equal(control("markdownFooter").hidden, false);
    render(state, false, "markdownTooLarge");
    assert.equal(control("markdownFooter").hidden, false);
    render(state, false, "", true);
    assert.equal(control("markdownFooter").hidden, false);
    render(state);
    assert.equal(control("markdownFooter").hidden, true, "resolving the problem hides the footer");
});

test("outline intent survives document recreation and ignores callbacks from the replaced editor", async () => {
    const {lifecycle, callbacks, preferenceWrites} = setup();
    await lifecycle.initializeDocument(snapshot("a"));
    callbacks[0].onOutlineChange({enabled: true, visible: true, available: true});
    await lifecycle.initializeDocument(snapshot("b"));
    assert.equal(callbacks[1].outline, true);
    assert.deepEqual(lifecycle.state().outline, {enabled: true, visible: false, available: false});
    callbacks[0].onOutlineChange({enabled: false, visible: false, available: true});
    assert.equal(lifecycle.state().outline.enabled, true);
    callbacks[1].onOutlineChange({enabled: true, visible: false, available: false});
    assert.deepEqual(preferenceWrites, [], "outline state is local to the open window");
});

test("automatic source fallback stays local while explicit mode choices become the next document's preference", async () => {
    const {lifecycle, callbacks, preferenceWrites} = setup();
    await lifecycle.initializeDocument(snapshot("large"));
    callbacks[0].onModeChange("sv", "automatic");
    assert.equal(lifecycle.state().activeMode, "sv");
    assert.equal(lifecycle.state().preferences.mode, "ir");
    assert.deepEqual(preferenceWrites, []);
    await lifecycle.initializeDocument(snapshot("small"));
    assert.equal(callbacks[1].mode, "ir");
    assert.equal(lifecycle.state().activeMode, "ir");
    callbacks[1].onModeChange("wysiwyg", "user");
    assert.equal(lifecycle.state().preferences.mode, "wysiwyg");
    assert.deepEqual(preferenceWrites, [{mode: "wysiwyg"}]);
    await lifecycle.initializeDocument(snapshot("next"));
    assert.equal(callbacks[2].mode, "wysiwyg");
    callbacks[1].onModeChange("sv", "user");
    assert.equal(lifecycle.state().preferences.mode, "wysiwyg", "a stale editor cannot replace the current preference");
    assert.equal(preferenceWrites.length, 1);
});

test("only the active Markdown editor forwards clicked links to the system host", async () => {
    const {lifecycle, callbacks, openedLinks} = setup();
    await lifecycle.initializeDocument(snapshot("first"));
    callbacks[0].onLink("https://example.com/first");
    await lifecycle.initializeDocument(snapshot("second"));
    callbacks[0].onLink("https://example.com/stale");
    callbacks[1].onLink("https://example.com/second");
    assert.deepEqual(openedLinks, ["https://example.com/first", "https://example.com/second"]);
    lifecycle.dispose();
    callbacks[1].onLink("https://example.com/closed");
    assert.equal(openedLinks.length, 2);
});

test("document replacement invalidates old editor callbacks, resources and session renders", async () => {
    const fixture = setup();
    const {lifecycle, callbacks, renders, editors} = fixture;
    await lifecycle.initializeDocument(snapshot("a"));
    const oldSession = lifecycle.state().session;
    const delayedResource = callbacks[0].resolveResource("a.png");
    await lifecycle.initializeDocument(snapshot("b"));
    assert.equal(editors[0].destroyed, true);
    assert.notEqual(lifecycle.state().session, oldSession);
    assert.equal(lifecycle.state().session.getState().sessionId, "b");
    const before = renders.length;
    callbacks[0].onEdit({content: "late A"});
    callbacks[0].onHistoryChange({canUndo: true, canRedo: true});
    callbacks[0].onResourceUnavailable();
    oldSession.updateEditor();
    assert.equal(renders.length, before, "late A callbacks cannot render B");
    assert.deepEqual(lifecycle.state().history, {canUndo: false, canRedo: false});
    assert.equal(lifecycle.state().resourceUnavailable, false);
    fixture.resolveResource("old-capability");
    assert.equal(await delayedResource, undefined, "a delayed capability cannot cross the document boundary");
    callbacks[1].onEdit({content: "current B"});
    assert.equal(renders.length, before + 1);
});

test("committed document initialization failure keeps retry and refuses close/background until recovered", async () => {
    const fixture = setup();
    const {lifecycle, callbacks, renders, responses} = fixture;
    await lifecycle.initializeDocument(snapshot("a"));
    lifecycle.pending({ticket: "ticket-b", sessionId: "b"});
    fixture.failEditor(true);
    assert.equal(await lifecycle.completeSwitch(), false);
    assert.equal(lifecycle.state().pendingSwitch.sessionId, "b");
    assert.equal(lifecycle.state().frozen, true);
    const before = renders.length;
    callbacks[1].onEdit({content: "failed editor"});
    assert.equal(renders.length, before, "failed initialization callbacks are invalidated");
    await lifecycle.command({id: "close-failed", type: "close"});
    await lifecycle.command({id: "background-failed", type: "background"});
    assert.deepEqual(responses, [false, false]);
    fixture.failEditor(false);
    assert.equal(await lifecycle.completeSwitch(), true);
    assert.equal(lifecycle.state().pendingSwitch, undefined);
    assert.equal(lifecycle.state().session.getState().sessionId, "b");
    assert.equal(lifecycle.state().frozen, false);
});

test("unconfirmed commit never replaces the current document and waiting lifecycle commands get false", async () => {
    const fixture = setup();
    const {lifecycle, bridge, responses, editors} = fixture;
    await lifecycle.initializeDocument(snapshot("a"));
    lifecycle.pending({ticket: "ticket-b", sessionId: "b"});
    let commits = 0;
    bridge.tree.commitOpen = async () => {commits++; throw new Error("Lost bridge");};
    bridge.bootstrap = async () => snapshot("a");
    assert.equal(await lifecycle.completeSwitch(), false);
    assert.equal(commits, 2);
    assert.equal(editors.length, 1);
    lifecycle.task(Promise.resolve(false));
    await lifecycle.command({id: "waiting-close", type: "close"});
    await lifecycle.command({id: "waiting-background", type: "background"});
    assert.deepEqual(responses, [false, false]);
});


test("document actions drain every outstanding task before switching or closing", async () => {
    const {lifecycle} = setup();
    let first: () => void;
    let second: () => void;
    const pendingFirst = new Promise<void>(resolve => {first = resolve;});
    const pendingSecond = new Promise<void>(resolve => {second = resolve;});
    lifecycle.runAction(() => pendingFirst, true);
    lifecycle.runAction(() => pendingSecond, true);
    let drained = false;
    const waiting = lifecycle.waitActions().then(() => {drained = true;});
    second();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drained, false, "a newer completed action does not hide an older pending one");
    first();
    await waiting;
    assert.equal(drained, true);
    assert.equal(lifecycle.waitActions(), undefined);
});
