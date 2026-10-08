import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    for (const mobile of [false, true]) {
        document.body.innerHTML = "";
        const dialogs: FakeDialog[] = [];
        const messages: string[] = [];
        const writes: {revision?: string; snippets: ISnippet[]}[] = [];
        let settingsWrites = 0;
        let outcome = {code: -1, msg: "snippet revision conflict"};
        let revision: string | undefined = "original-revision";
        let rejectNetwork = false;
        let delayClose = false;
        const original = [{id: "one", name: "Original", type: "css", content: "body{}", enabled: true, disabledInPublish: false}];
        const exports = {} as typeof import("./snippets");
        class FakeDialog {
            element: HTMLElement;
            closed = false;
            constructor(public options: {content: string; destroyCallback?: (options?: IObject) => void}) {
                this.element = document.createElement("div");
                this.element.innerHTML = options.content;
                document.body.appendChild(this.element);
                dialogs.push(this);
            }
            destroy(options?: IObject) {
                if (this.closed) return;
                this.closed = true;
                const finish = () => {
                    this.element.remove();
                    this.options.destroyCallback?.(options);
                };
                if (delayClose) setTimeout(finish, 20);
                else finish();
            }
        }
        Object.defineProperty(window, "siyuan", {configurable: true, writable: true, value: {
            config: {snippet: {enabledCSS: true, enabledJS: false}, publish: {enable: true}},
            languages: {snippetConflict: "Keep your draft and reopen"},
        }});
        const dependencies = {
            Dialog: FakeDialog, isMobile: () => mobile,
            Constants: {DIALOG_SNIPPETS: "snippets"},
            objEquals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
            confirmDialog: (_title: string, _text: string, confirm: () => void) => confirm(),
            showMessage: (text: string) => messages.push(text),
            refreshHeadingNumberMeasurements: () => {},
            getHostCapabilities: () => ({customAppearance: true}),
            fetchPost: (url: string, _args: unknown, callback?: (result: unknown) => void) => {
                if (url === "/api/snippet/getSnippet") callback({data: {snippets: original, revision}});
                else if (url === "/api/setting/setSnippet") settingsWrites++;
                else throw new Error(`Unexpected request: ${url}`);
                return Promise.resolve();
            },
            fetchSyncPost: async (_url: string, data: {revision?: string; snippets: ISnippet[]}) => {
                writes.push(data);
                if (rejectNetwork) throw new Error("network failure");
                return outcome;
            },
        };
        new Function("exports", "require", source)(exports, () => dependencies);
        const current = () => dialogs.at(-1);
        const save = () => current().element.querySelector<HTMLButtonElement>(".b3-dialog__action .b3-button--text").click();
        const edit = (value: string) => {
            current().element.querySelector<HTMLTextAreaElement>("textarea").value = value;
        };

        exports.openSnippets();
        edit("local draft");
        const dialog = current();
        save();
        save();
        await settle();
        check.equal(writes.length, 1, "duplicate clicks must not start parallel saves");
        check.equal(writes[0].revision, revision);
        check.equal(dialog.element.isConnected, true, "conflict must keep the editor open");
        check.equal(dialog.element.querySelector("textarea").value, "local draft");
        check.equal(settingsWrites, 0, "failed list save must not change global switches");
        check.equal(messages.at(-1), window.siyuan.languages.snippetConflict);

        dialog.element.querySelector<HTMLElement>("#addCodeSnippetCSS").click();
        dialog.element.querySelector<HTMLElement>("#addCodeSnippetCSS").click();
        const rows = Array.from(dialog.element.querySelectorAll<HTMLElement>("[data-id]"));
        rows.forEach((row, index) => {
            row.querySelector<HTMLInputElement>("input.b3-text-field").value = `draft-${index}`;
            row.querySelector("textarea").value = `code-${index}`;
        });
        dialog.destroy();
        await settle();
        check.notEqual(current(), dialog, "closing before a conflict must restore a draft editor");
        check.equal(current().element.isConnected, true);
        check.deepEqual(Array.from(current().element.querySelectorAll("textarea")).map(item => item.value), ["code-0", "code-1", "code-2"]);
        check.deepEqual(Array.from(current().element.querySelectorAll<HTMLInputElement>("[data-id] input.b3-text-field")).map(item => item.value), ["draft-0", "draft-1", "draft-2"]);
        check.equal(settingsWrites, 0);
        current().destroy({cancel: "true"});

        revision = undefined;
        exports.openSnippets();
        edit("missing revision");
        const count = writes.length;
        save();
        await settle();
        check.equal(writes.length, count, "missing revision must not fall back to unconditional save");
        current().destroy({cancel: "true"});

        revision = "fresh-revision";
        rejectNetwork = true;
        exports.openSnippets();
        current().element.querySelector<HTMLInputElement>('[data-action="toggleCSS"]').checked = false;
        current().destroy();
        await settle();
        check.equal(current().element.querySelector("textarea").value, "body{}");
        check.equal(current().element.querySelector<HTMLInputElement>('[data-action="toggleCSS"]').checked, false);
        check.equal(current().element.isConnected, true);
        rejectNetwork = false;
        outcome = {code: 0, msg: ""};
        save();
        await settle();
        check.equal(settingsWrites, 1);
        check.equal(window.siyuan.config.snippet.enabledCSS, false, "restored switch-only edits must remain unsaved until retry succeeds");
        check.equal(current().element.isConnected, false);
        check.equal(writes.at(-1).revision, "fresh-revision");

        delayClose = true;
        exports.openSnippets();
        edit("save while closing");
        const beforeClosingSave = writes.length;
        const beforeClosingDialogs = dialogs.length;
        save();
        current().destroy();
        await new Promise(resolve => setTimeout(resolve, 40));
        check.equal(writes.length, beforeClosingSave + 1, "delayed close must not save a completed draft again");
        check.equal(dialogs.length, beforeClosingDialogs, "successful delayed close must not reopen a stale draft");
    }
    return "Snippet save cases passed on desktop and mobile";
};

test("snippet saves preserve drafts on conflict, closing and network failures", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "snippets.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-snippet-save-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Snippet save cases passed on desktop and mobile/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
