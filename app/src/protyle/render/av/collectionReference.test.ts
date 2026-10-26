import * as assert from "node:assert/strict";
import {readFileSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {execFile} from "node:child_process";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import type {AVAutomationBlockSourceInput} from "../../../types/api";
import type {openInputDialog} from "../../../dialog/inputDialog";

const compiled = transpileModule(readFileSync("src/protyle/render/av/collectionReference.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("reference targets accept block IDs and block links without matching arbitrary text", () => {
    const api = {} as typeof import("./collectionReference");
    runInNewContext(compiled, {exports: api, require: () => ({})});
    const id = "20261026000000-target1";
    for (const value of [id, ` ${id} `, `siyuan://blocks/${id}`, `siyuan://blocks/${id}?focus=1`]) {
        assert.equal(api.parseCollectionReference(value), id);
    }
    for (const value of ["", "not-a-block", `https://example.com/${id}`, `text ${id}`, `siyuan://blocks/${id}/other`, `${id}extra`]) {
        assert.equal(api.parseCollectionReference(value), undefined);
    }
});

const browserCases = async (sourceCode: string, languages: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const api = {} as typeof import("./collectionReference");
    let inputOptions: Parameters<typeof openInputDialog>[0];
    const target = "20261026000000-target1";
    const rootID = "20261026000000-source1";
    const pendingNames: Array<(value: unknown) => void> = [];
    let pendingSelection: (value: unknown) => void;
    Object.assign(window, {siyuan: {languages, blockPanels: []}});
    new Function("exports", "require", sourceCode)(api, (name: string) => ({
        "../../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../../dialog/inputDialog": {openInputDialog: (options: typeof inputOptions) => { inputOptions = options; }},
        "../../../util/fetch": {fetchSyncPost: async (url: string, body: {id: string}) => {
            if (url === "/api/block/getBlockInfo") {
                if (body.id === "20261026000000-pending") { return new Promise(resolve => { pendingSelection = resolve; }); }
                return {code: body.id === "20261026000000-missing" ? -1 : 0};
            }
            return new Promise(resolve => pendingNames.push(resolve));
        }},
        "../../../block/Panel": {BlockPanel: class {}},
    })[name] || {});
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    for (const attachBeforeResponse of [false, true]) {
        const reopened = document.createElement("div");
        const saved: AVAutomationBlockSourceInput = {referenceID: target};
        let resizes = 0;
        api.mountCollectionReference(reopened, saved, {block: {rootID}} as IProtyle,
            () => check.fail("loading the saved reference changed the configuration"), () => { resizes++; });
        if (attachBeforeResponse) { document.body.append(reopened); }
        const beforeResponse = resizes;
        pendingNames.shift()({code: 0, data: "Saved document name"});
        await tick();
        check.equal(reopened.querySelector("[data-preview-reference]").textContent, "Saved document name");
        check.equal(resizes, beforeResponse + (attachBeforeResponse ? 1 : 0));
        if (!attachBeforeResponse) { document.body.append(reopened); }
        check.equal(reopened.querySelector("[data-preview-reference]").textContent, "Saved document name");
        check.equal(saved.referenceID, target);
        reopened.remove();
    }
    for (const [width, key] of [[1000, ""], [320, "Enter"], [320, " "]] as const) {
        const host = document.createElement("div");
        host.style.width = `${width}px`;
        document.body.append(host);
        const source: AVAutomationBlockSourceInput = {};
        const saves: AVAutomationBlockSourceInput[] = [];
        api.mountCollectionReference(host, source, {block: {rootID}} as IProtyle,
            () => saves.push(JSON.parse(JSON.stringify(source))), () => {});
        host.querySelector<HTMLButtonElement>("[data-reference]").click();
        const input = document.createElement("input");
        let destroyed = false;
        const dialog = {element: {querySelector: () => input}, destroy() { destroyed = true; }} as unknown as Parameters<typeof inputOptions.onConfirm>[1];
        await inputOptions.onConfirm("invalid", dialog);
        check.equal(input.validationMessage, languages.invalid);
        check.equal(saves.length, 0);
        await inputOptions.onConfirm(`siyuan://blocks/${target}?focus=1`, dialog);
        check.equal(source.referenceID, target);
        check.equal(saves.at(-1).referenceID, target);
        check.equal(destroyed, true);
        host.querySelector<HTMLButtonElement>("[data-preview-reference]").click();
        check.equal(window.siyuan.blockPanels.length, 1);
        window.siyuan.blockPanels.length = 0;
        host.querySelector<HTMLButtonElement>("[data-reference-document]").click();
        await tick();
        check.equal(source.referenceID, rootID);
        check.equal(saves.at(-1).referenceID, rootID);
        const stale = pendingNames.splice(0);
        stale[stale.length - 1]({code: 0, data: "<Current document>"});
        stale[0]({code: 0, data: "Outdated target"});
        await tick();
        check.equal(host.querySelector("[data-preview-reference]").textContent, "<Current document>");
        check.equal(host.querySelector("[data-preview-reference]").children.length, 0);
        host.querySelector<HTMLButtonElement>("[data-reference]").click();
        const pending = inputOptions.onConfirm("20261026000000-pending", dialog);
        const clear = host.querySelector<SVGSVGElement>("[data-clear-reference]");
        clear.dispatchEvent(key ? new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}) :
            new MouseEvent("click", {bubbles: true}));
        pendingSelection({code: 0});
        await pending;
        check.equal(source.referenceID, undefined);
        check.equal(host.querySelector("[data-preview-reference]"), null);
        check.equal(saves.at(-1).referenceID, undefined);
        check.ok(host.scrollWidth <= width);
        host.remove();
    }
    return "Reference collection DOM cases passed";
};

test("reference reopening, selection, mouse and keyboard clearing, and stale labels work on desktop and narrow layouts", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-collection-reference-"));
    const script = path.join(temporary, "run.cjs");
    const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name = value => value; (${browserCases.toString()})(${JSON.stringify(compiled)}, ${JSON.stringify(languages)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(stdout, /Reference collection DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-collection-reference-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
