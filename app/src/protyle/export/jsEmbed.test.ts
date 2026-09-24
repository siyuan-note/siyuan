import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const cases = async (source: string) => {
    const check = require("node:assert/strict");
    const render = new Function(source + "; return renderExportJSEmbeds;")();
    const root = document.createElement("div");
    document.body.append(root);
    const options = {disabled: false, disabledTip: "Scripts disabled", rootID: "root", headingMode: 2};
    const embed = (script: string) => {
        const item = document.createElement("div");
        item.dataset.type = "NodeBlockQueryEmbed";
        item.dataset.nodeId = "embed";
        item.dataset.notebook = "notebook";
        item.dataset.content = script;
        root.replaceChildren(item);
        return item;
    };
    const unexpectedRequest = () => check.fail("Unexpected request");
    const custom = embed("//!js\nawait Promise.resolve(); item.innerHTML = '<b>custom</b>'; ");
    await render(root, options, unexpectedRequest);
    check.equal(custom.innerHTML, "<b>custom</b>");

    const ids = embed("//!js\nreturn ['second', 'first'];");
    ids.dataset.queryNotebook = "notebook";
    ids.setAttribute("custom-heading-mode", "1");
    let requests = 0;
    let release: () => void;
    const pending = render(root, options, async (url: string, data: Record<string, unknown>) => {
        requests++;
        check.equal(url, "/api/search/getEmbedBlock");
        check.deepEqual(data.includeIDs, ["second", "first"]);
        check.equal(data.notebook, "notebook");
        check.equal(data.headingMode, 1);
        await new Promise<void>(resolve => release = resolve);
        return {code: 0, data: {blocks: [{block: {content: '<div contenteditable="true">second</div>'}},
            {block: {content: '<div>first</div><div class="protyle-attr">control</div>'}}]}};
    });
    await Promise.resolve();
    check.equal(requests, 1);
    check.equal(ids.textContent, "");
    release();
    await pending;
    check.equal(ids.textContent, "secondfirst");
    check.equal(ids.querySelector("[contenteditable]").getAttribute("contenteditable"), "false");

    const nested = embed("//!js\nreturn ['nested'];");
    await render(root, options, async (_url: string, data: {notebook: string}) => {
        check.equal(data.notebook, "");
        return {code: 0, data: {blocks: [{block: {
        content: '<div data-type="NodeBlockQueryEmbed" data-content="//!js&#10;item.textContent = protyle.notebookId;"></div>',
        }}]}};
    });
    check.equal(nested.textContent, "notebook");

    const safe = embed("//!js\nthrow new Error('executed');");
    await render(root, {...options, disabled: true}, unexpectedRequest);
    check.equal(safe.textContent, "Scripts disabled");

    const error = embed("//!js\nthrow new Error('<img src=x>');");
    await render(root, options, unexpectedRequest);
    check.equal(error.textContent, "Error: <img src=x>");
    check.equal(error.querySelector("img"), null);

    const empty = embed("//!js\nreturn [];");
    await render(root, options, async () => ({code: 0, data: {blocks: new Array<{block: {content: string}}>()}}));
    check.equal(empty.textContent, "");
    root.remove();
    return "Export embeds passed";
};

test("export embeds await asynchronous results and preserve safety and notebook context", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "jsEmbed.ts"), "utf8")
        .replace(/^import type .*;$/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-export-embed-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript("window.Lute = {UnEscapeHTMLStr: value => value}; void 0;");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${cases.toString()})(${JSON.stringify(source)})`)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Export embeds passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
