import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import bundledLanguages from "../../appearance/boot/startup-languages.json";

const browserCases = async (startupSource: string, snippetsSource: string, languages: typeof bundledLanguages) => {
    const check: typeof assert = require("node:assert/strict");
    const startup = new Function("bundledLanguages", startupSource +
        "\nreturn {installStartupError, completeStartup, setStartupStage, withStartupErrorSuppressed};")(languages) as typeof import("./startupError");
    const snippets = new Function("withStartupErrorSuppressed", "getHostCapabilities", "getExtensionScriptNonce",
        "fetchPost", "refreshHeadingNumberMeasurements", snippetsSource + "\nreturn {renderSnippet};")(
        startup.withStartupErrorSuppressed, () => ({customAppearance: true}), () => "", async (_url: string, _request: unknown,
            callback: (value: unknown) => void) => callback({data: {snippets: currentSnippets}}), () => {}) as typeof import("../config/util/snippets");
    Object.assign(window, {siyuan: {config: {snippet: {enabledJS: true}}}});
    let currentSnippets: Array<{id: string; type: string; enabled: boolean; content: string}>;
    let reported = 0;
    window.addEventListener("error", event => { reported++; event.preventDefault(); });
    for (const deferred of [false, true]) {
        for (const content of ["const unfinished = '", "throw new Error('snippet runtime');"]) {
            const monitor = startup.installStartupError(window, "test");
            startup.setStartupStage("interface");
            const before = reported;
            currentSnippets = [
                {id: "bad", type: "js", enabled: true, content},
                {id: "good", type: "js", enabled: true, content: "window.snippetRan = true;"},
            ];
            await snippets.renderSnippet(0, () => true, deferred ? async () => {} : undefined);
            check.equal(reported, before + 1, "the browser must still report the snippet error");
            check.equal(document.documentElement.dataset.startupState, "loading");
            check.equal(document.querySelector(".startup-error"), null);
            check.equal(Reflect.get(window, "snippetRan"), true);
            startup.completeStartup();
            check.equal(document.documentElement.dataset.startupState, "ready");
            monitor.dispose();
            document.querySelectorAll('script[id^="snippetJS"]').forEach(element => element.remove());
            Reflect.deleteProperty(window, "snippetRan");
        }
    }
    const monitor = startup.installStartupError(window, "test");
    window.dispatchEvent(new ErrorEvent("error", {error: new Error("real startup failure")}));
    check.equal(document.documentElement.dataset.startupState, "failed");
    check.match(document.querySelector("pre").textContent, /real startup failure/);
    monitor.dispose();
    return "Snippet startup isolation passed";
};

test("real inline snippet syntax and runtime errors preserve mobile startup and later snippets", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(file, "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const code = `(${browserCases.toString()})(${JSON.stringify(compile("src/boot/startupError.ts"))},` +
        `${JSON.stringify(compile("src/config/util/snippets.ts"))},${JSON.stringify(bundledLanguages)})`;
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-startup-snippet-"));
    const file = path.join(directory, "run.cjs");
    writeFileSync(file, `const {app, BrowserWindow} = require("electron");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    await win.loadURL('data:text/html,<html><head></head><body></body></html>');
    console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
    app.exit(0);
}).catch(error => {console.error(error); app.exit(1);});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron"), [file], {env, windowsHide: true, timeout: 35000});
        assert.match(result.stdout, /Snippet startup isolation passed/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
