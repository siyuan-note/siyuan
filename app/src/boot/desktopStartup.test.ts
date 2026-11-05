import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {completeStartup, guardStartup, reportStartupError, setStartupLanguage, setStartupStage} from "./startupError";

const source = readFileSync("src/index.ts", "utf8");
const startupSource = source.slice(source.indexOf("        const notebookPromise = setNoteBook();"),
    source.indexOf("        initBlockPopover(this);"));
const compiled = transpileModule(startupSource, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const start = (failure?: string, render = async () => {}) => {
    const stages: string[] = [];
    const errors: unknown[] = [];
    const calls: string[] = [];
    let language: string;
    let ready = false;
    const previousWindow = globalThis.window;
    const window = Object.assign(new EventTarget(), {siyuan: {isReady: false} as any});
    globalThis.window = window as unknown as Window & typeof globalThis;
    window.addEventListener("siyuan-startup-stage", (event: CustomEvent<string>) => stages.push(event.detail));
    window.addEventListener("siyuan-startup-language", (event: CustomEvent<string>) => language = event.detail);
    window.addEventListener("siyuan-startup-error", (event: CustomEvent<unknown>) => errors.push(event.detail));
    window.addEventListener("siyuan-startup-ready", () => { ready = true; calls.push("ready"); });
    const fail = (step: string) => { if (failure === step) throw new Error(step); };
    const values = {
        window, setStartupStage, setStartupLanguage, guardStartup, reportStartupError, completeStartup,
        setNoteBook: async () => {},
        fetchPost: (url: string, _data: unknown, callback?: (response: unknown) => unknown,
                    _headers?: unknown, onError?: (error: unknown) => unknown) => {
            if (!callback) return;
            if (failure === url) return onError({msg: url, code: 500});
            return callback({data: {conf: {appearance: {lang: "zh-CN", notifications: {browserCompatibility: false}}}}});
        },
        startupRequestFailed: (response: IWebSocketData) => reportStartupError(new Error(response.msg)),
        ensureLute: async (options: {reloadOnFailure: boolean}) => {
            assert.equal(options.reloadOnFailure, false);
            fail("engine");
        },
        addScript() {},
        Constants: {SIYUAN_VERSION: "test", SIYUAN_EMPTY_LAYOUT: {}, SIYUAN_READY_TO_SHOW: "show"},
        systemConfig: (config: unknown) => config,
        loadDesktopHostConnection: async () => {}, ensureUILayout() {}, setBodyHighlight() {},
        loadPlugins: async () => fail("plugins"),
        getLocalStorage: (callback: () => unknown, onError: (error: unknown) => unknown) =>
            failure === "storage" ? onError(new Error("storage")) : callback(),
        loadLanguages: async (_lang: string, _version: string, callback: (value: unknown) => unknown,
                              onError: (error: unknown) => unknown) =>
            failure === "language" ? onError(new Error("language")) : callback({loading: "Loading"}),
        initializeEnglishCommandTranslations() {}, Menus: class {}, ensureOnboarding: async () => {},
        initWindowWithLoading: async (callback: () => Promise<void>) => { await callback(); calls.push("rendered"); },
        onGetConfig: async () => { fail("interface"); await render(); }, setTabPosition() {},
        ipcRenderer: {send: () => calls.push("shown")}, onSetaccount() {}, setTitle() {}, initMessage() {},
        isInMobileApp: () => false, isIOSDevice: () => false, isChromeBrowser: () => true, showMessage() {},
        mainWs: {flushMainMessages: () => calls.push("flushed")}, bootSync() {}, exitAfterSettingsReset() {},
    };
    new Function(...Object.keys(values), compiled)(...Object.values(values));
    return {stages, errors, calls, language: () => language, ready: () => ready,
        dispose: () => { globalThis.window = previousWindow; }};
};

const settle = () => new Promise(resolve => setImmediate(resolve));

test("a closed publish service finishes startup monitoring without initializing the application", () => {
    const begin = source.indexOf("        if (checkPublishServiceClosed())");
    const end = source.indexOf("        registerServiceWorker(", begin);
    let completed = 0;
    new Function("checkPublishServiceClosed", "completeStartup", source.slice(begin, end))(
        () => true, () => completed++);
    assert.equal(completed, 1);
});

test("desktop startup records each phase and completes only after the interface and queued messages are ready", async () => {
    let finish: () => void;
    const rendering = new Promise<void>(resolve => finish = resolve);
    const fixture = start(undefined, () => rendering);
    try {
        await settle();
        assert.deepEqual(fixture.stages, ["configuration", "engine", "plugins", "storage", "language", "interface"]);
        assert.equal(fixture.language(), "zh-CN");
        assert.equal(fixture.ready(), false);
        finish();
        await settle();
        assert.equal(fixture.ready(), true);
        assert.deepEqual(fixture.calls, ["rendered", "shown", "flushed", "ready"]);
        assert.deepEqual(fixture.errors, []);
    } finally { fixture.dispose(); }
});

test("desktop startup reports failed dependencies without claiming successful initialization", async () => {
    for (const failure of ["/api/system/getConf", "engine", "plugins", "storage", "language",
        "/api/setting/getCloudUser", "interface"]) {
        const fixture = start(failure);
        try {
            await settle();
            assert.equal(fixture.ready(), false, failure);
            assert.equal(fixture.errors.length, 1, failure);
            assert.equal((fixture.errors[0] as Error).message, failure);
            assert.equal(fixture.stages.at(-1), failure === "/api/system/getConf" ? "configuration" :
                failure === "/api/setting/getCloudUser" ? "interface" : failure);
        } finally { fixture.dispose(); }
    }
});

test("desktop layout completion preserves diagnostic overlays while ordinary loading is removed", async () => {
    const code = transpileModule(readFileSync("src/boot/loading.ts", "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    for (const failed of [false, true]) {
        let removed = false;
        const loading = {setAttribute() {}, classList: {contains: () => failed}, remove: () => removed = true};
        const document = {getElementById: (id: string) => id === "loading" ? loading : undefined,
            querySelectorAll: (): HTMLElement[] => [], body: {removeAttribute() {}}};
        const exports: {initWindowWithLoading?: (render: () => Promise<void>) => Promise<void>} = {};
        new Function("require", "exports", "document", "window", code)(
            (name: string) => name === "../util/windowPaint" ? {waitForWindowPaint: (render: () => Promise<void>) => render()} : {},
            exports, document, {siyuan: {languages: {loading: "Loading"}}, clearTimeout() {}});
        await exports.initWindowWithLoading(async () => {});
        assert.equal(removed, !failed);
    }
});
