import {test} from "node:test";
import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const requests: {notebook: string, assets: string[]}[] = [];
    let fail = false;
    const api = {} as typeof import("./pasteAssets");
    new Function("exports", "require", source)(api, () => ({fetchSyncPost: async (url: string, request: typeof requests[number]) => {
        check.equal(url, "/api/clipboard/preparePasteAssets");
        requests.push(request);
        return fail ? {code: -1, data: null} : {code: 0, data: Object.fromEntries(request.assets.map(reference =>
            [reference, reference.replace("assets/", "assets/encrypted-") + "?box=target"]))};
    }}));
    const html = '<div data-type="NodeParagraph"><img src="assets/image.png" data-src="assets/image.png">' +
        '<span data-type="a" data-href="assets/file.pdf">File</span>' +
        '<span data-type="file-annotation-ref" data-id="assets/file.pdf/20260928120000-abcdefg">Annotation</span>' +
        '<audio src="assets/audio.mp3"></audio><a href="https://example.com">External</a>' +
        '<code>assets/code.txt</code></div><div data-type="NodeCodeBlock" data-content="assets/code.txt"></div>';
    const result = await api.preparePasteAssets("target", html);
    check.equal(requests.length, 1);
    check.equal(requests[0].notebook, "target");
    check.deepEqual(requests[0].assets, ["assets/image.png", "assets/file.pdf", "assets/file.pdf/20260928120000-abcdefg", "assets/audio.mp3"]);
    const template = document.createElement("template");
    template.innerHTML = result;
    check.equal(template.content.querySelector("img").getAttribute("src"), "assets/encrypted-image.png?box=target");
    check.equal(template.content.querySelector("img").getAttribute("data-src"), "assets/encrypted-image.png?box=target");
    check.equal(template.content.querySelector("[data-type=a]").getAttribute("data-href"), "assets/encrypted-file.pdf?box=target");
    check.equal(template.content.querySelector("code").textContent, "assets/code.txt");
    check.equal(template.content.querySelector("a").getAttribute("href"), "https://example.com");
    fail = true;
    check.equal(await api.preparePasteAssets("target", html), null);
    const noAssets = '<code>assets/code.txt</code><img src="https://example.com/image.png">';
    check.equal(await api.preparePasteAssets("target", noAssets), noAssets);
    check.equal(requests.length, 2);
    return "paste-assets-ok";
};

test("encrypted paste rewrites attachment references atomically in the real DOM", {timeout: 30000}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-paste-assets-"));
    const source = transpileModule(readFileSync("src/protyle/util/pasteAssets.ts", "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
    }).outputText;
    const execute = transpileModule(`const __name = (value) => value; (${browserCases.toString()})(${JSON.stringify(source)})`, {
        compilerOptions: {target: ScriptTarget.ES2022},
    }).outputText;
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    try {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron") as unknown as string, [script, "--no-sandbox"], {env, timeout: 25000});
        assert.match(result.stdout, /paste-assets-ok/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
