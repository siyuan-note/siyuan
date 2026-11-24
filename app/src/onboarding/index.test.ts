import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {DialogCloseReason} from "../dialog/adaptiveDialog";
import type {App} from "../index";

const preprocess: (source: string, options: {MOBILE: boolean}) => string = require("ifdef-loader/preprocessor").parse;
const source = readFileSync("src/onboarding/index.ts", "utf8");

const setup = ({mobile = true, documentImportExport = true} = {}) => {
    const config = {onboarding: {newUser: true, dismissed: false, state: "completed", documentID: "doc", notebookID: "box"}};
    const app = {} as App;
    const events = new EventTarget();
    const window = Object.assign(events, {
        siyuan: {config, user: false, languages: {onboardingWelcome: "Welcome", onboardingDescription: "First notebook", close: "Close"}},
        setTimeout: (callback: () => void) => callback(),
    });
    const entries: string[] = [];
    const dialogs: DialogFixture[] = [];
    let desktopCard: Surface;
    let finishDocument: (opened: boolean) => void;
    let returnFromSettings: () => void;
    let finishImport: () => void;
    class Surface {
        dataset: Record<string, string> = {};
        className = "";
        innerHTML = "";
        private listener: (event: {target: {closest: () => {dataset: {type: string}}}}) => void;
        addEventListener(_name: string, listener: typeof this.listener) { this.listener = listener; }
        click(type: string) { this.listener({target: {closest: () => ({dataset: {type}})}}); }
        remove() { desktopCard = undefined; }
    }
    class DialogFixture {
        element = new Surface();
        private closeOptions: IObject;
        constructor(public options: {title: string; content: string; destroyCallback: (options?: IObject) => void}) {
            dialogs.push(this);
        }
        async requestClose(reason: DialogCloseReason, options?: IObject) {
            entries.push(reason);
            this.destroy(options);
            return true;
        }
        destroy(options?: IObject) {
            this.element.dataset.dialogClosing = "true";
            this.closeOptions = options;
        }
        finishClose() {
            dialogs.splice(dialogs.indexOf(this), 1);
            this.options.destroyCallback(this.closeOptions);
        }
    }
    const document = {
        createElement: () => new Surface(),
        body: {append: (element: Surface) => { desktopCard = element; }},
        querySelector: (selector: string) => selector === ".onboarding" ? desktopCard : undefined,
    };
    const dependencies = {
        Constants: {CB_GET_CONTEXT: "context", CB_GET_FOCUSFIRST: "focus"}, AdaptiveDialog: DialogFixture,
        fetchPost: (url: string) => entries.push(url), getHostCapabilities: () => ({documentImportExport}),
        isPaidUser: () => window.siyuan.user, getAllTabs: (): [] => [], parseUriInfo: () => ({}),
        openFileById: async ({id}: {id: string}) => { entries.push(id); },
        openMobileFileById: (_app: App, id: string) => new Promise<boolean>(resolve => {
            entries.push(id);
            finishDocument = resolve;
        }),
        openDataMigration: (options: {notebookID: string; onContentImportComplete: () => void}) => {
            entries.push(options.notebookID);
            finishImport = options.onContentImportComplete;
        },
        openMobileSetting: (_app: App, tab: string, back: () => void) => {
            assert.equal(dialogs.length, 0);
            entries.push(tab);
            returnFromSettings = back;
        },
        closeModel: () => entries.push("close model"), mountHelp: () => entries.push("guide"),
        syncGuide: (_app: App, openSettings: () => void) => { entries.push("sync guide"); openSettings?.(); },
    };
    const api = {} as typeof import("./index");
    const script = transpileModule(preprocess(source, {MOBILE: mobile}), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(script, {exports: api, require: () => dependencies, window, document, console});
    const tick = () => new Promise<void>(resolve => setImmediate(resolve));
    return {api, app, config, entries, dialogs, window, tick, card: () => desktopCard,
        openInitial: async () => { api.openMobileOnboarding(app); finishDocument(true); await tick(); },
        completeDocument: () => finishDocument(true), back: () => returnFromSettings(), importDone: () => finishImport()};
};

test("mobile onboarding waits for the first document and remembers closing the sheet once", async () => {
    for (const reason of ["drag", "back", "scrim", "cancel"] as const) {
        const f = setup();
        assert.equal(f.api.openMobileOnboarding(f.app), true);
        assert.equal(f.api.openMobileOnboarding(f.app), true);
        assert.equal(f.dialogs.length, 0);
        assert.deepEqual(f.entries, ["doc"]);
        f.completeDocument();
        await f.tick();
        const dialog = f.dialogs[0];
        assert.match(dialog.options.title, /Welcome/);
        assert.match(dialog.options.content, /b3-dialog__content/);
        if (reason === "cancel") dialog.element.click("close");
        else await dialog.requestClose(reason);
        dialog.finishClose();
        assert.equal(f.config.onboarding.dismissed, true);
        assert.equal(f.entries.filter(entry => entry === "/api/system/dismissOnboarding").length, 1);
        assert.equal(f.api.openMobileOnboarding(f.app), false);
    }
});

test("mobile onboarding hands Back to Settings and resumes until sync succeeds", async () => {
    const f = setup();
    await f.openInitial();
    const first = f.dialogs[0];
    first.element.click("sync");
    first.finishClose();
    assert.deepEqual(f.entries, ["doc", "programmatic", "sync"]);
    assert.equal(f.config.onboarding.dismissed, false);
    assert.equal(f.api.openMobileOnboarding(f.app), true);
    assert.equal(f.dialogs.length, 0);
    f.back();
    const second = f.dialogs[0];
    assert.notEqual(second, first);
    assert.equal(f.entries.filter(entry => entry === "doc").length, 1);
    second.element.click("sync");
    second.finishClose();
    f.window.siyuan.user = true;
    f.window.dispatchEvent(new Event("siyuan-login-success"));
    assert.equal(f.entries.filter(entry => entry === "sync guide").length, 1);
    f.window.dispatchEvent(new Event("siyuan-sync-success"));
    f.back();
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.entries.filter(entry => entry === "/api/system/dismissOnboarding").length, 1);
});

test("onboarding keeps the import and guide actions and the desktop welcome card", async () => {
    const mobile = setup();
    await mobile.openInitial();
    const dialog = mobile.dialogs[0];
    assert.match(dialog.options.content, /data-type="import"/);
    dialog.element.click("import");
    assert.deepEqual(mobile.entries, ["doc", "box"]);
    assert.equal(mobile.config.onboarding.dismissed, false);
    mobile.importDone();
    dialog.finishClose();
    assert.equal(mobile.entries.filter(entry => entry === "/api/system/dismissOnboarding").length, 1);

    const restricted = setup({documentImportExport: false});
    await restricted.openInitial();
    assert.doesNotMatch(restricted.dialogs[0].options.content, /data-type="import"/);

    const desktop = setup({mobile: false});
    desktop.api.openDesktopOnboarding(desktop.app);
    assert.equal(desktop.card().className, "onboarding");
    assert.equal(desktop.dialogs.length, 0);
    desktop.card().click("guide");
    assert.deepEqual(desktop.entries, ["doc", "guide", "/api/system/dismissOnboarding"]);
});
