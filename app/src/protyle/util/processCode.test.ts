import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (sources: Record<string, string>) => {
    const check = require("node:assert/strict");
    const load = (source: string, mocks: Record<string, unknown>) => {
        const api = {};
        new Function("exports", "require", source)(api, (id: string) => mocks[id] || {});
        return api;
    };
    const escape = load(sources.escape, {});
    const marker = load(sources.marker, {});
    const api = load(sources.processCode, {"../../util/escape": escape, "./inlineElementMarker": marker}) as
        typeof import("./processCode");
    const lute = Lute.New();
    const protyle = {lute} as IProtyle;
    const convert = (html: string, text: string) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return api.processPasteCode(Lute.Sanitize(doc.body.innerHTML), text, html, protyle);
    };
    for (const language of ["", ' class="language-js"']) {
        for (const font of ["'Microsoft YaHei UI','Microsoft YaHei',sans-serif", "Consolas,monospace"]) {
            const html = "<HTML>\n<BODY>\n<!--StartFragment-->\n" +
                `<div style="font-family:${font};font-size:14px;line-height:1.5;">` +
                '<p style="margin:0 0 8px 0;">abc</p>' +
                '<pre style="margin:0 0 8px 0;padding:8px 10px;background:#F2F2F2;border-radius:4px;' +
                "font-family:Consolas,'Courier New',monospace;font-size:13px;white-space:pre-wrap;\">" +
                `<code${language}>efg</code></pre><p style="margin:0 0 8px 0;">hijk</p>` +
                "</div><!--EndFragment-->\n</BODY>\n</HTML>";
            check.equal(convert(html, "abc\nefg\nhijk"), false, "mixed rich text must use HTML conversion");
            const result = document.createElement("div");
            result.innerHTML = lute.HTML2BlockDOM(html);
            check.deepEqual(Array.from(result.children, element => element.getAttribute("data-type")),
                ["NodeParagraph", "NodeCodeBlock", "NodeParagraph"]);
            check.equal(result.children[0].querySelector('[contenteditable="true"]').textContent, "abc");
            check.equal(result.children[2].querySelector('[contenteditable="true"]').textContent, "hijk");
            check.equal(result.querySelector('.code-block [contenteditable="true"]').textContent.trim(), "efg");
            if (language) check.equal(result.querySelector(".protyle-action__language").textContent, "js");
        }
    }
    for (const html of [
        "<div>before<pre><code>code</code></pre>after</div>",
        "<div><h2>heading</h2><section><pre><code>code</code></pre></section></div>",
        '<div><img src="https://example.com/image.png"><pre><code>code</code></pre></div>',
        "<div><pre><code>first</code></pre><pre><code>second</code></pre></div>",
        "<pre><code>code</code></pre>outside",
    ]) {
        check.equal(convert(html, "code"), false, `content outside pre must survive: ${html}`);
    }
    for (const html of [
        "<pre><code>code</code></pre>",
        "<div><pre><code>code</code></pre></div>",
        "<div> \n<!--StartFragment--><section>\n<pre><code>code</code></pre>\n</section><!--EndFragment-->\n</div>",
        '<div style="font-family:monospace"><span>code</span></div>',
        '<table><tr><td class="line-number">1</td><td class="line-content">code</td></tr></table>',
    ]) {
        const inline = convert(html, "x < y && y > 0");
        check.equal(typeof inline, "string", "standalone IDE and browser source copies remain code");
        const element = document.createElement("div");
        element.innerHTML = inline as string;
        check.equal(element.querySelector('[data-type="code"]').textContent.replace(/\u2060/g, ""), "x < y && y > 0");
        check.match(convert(html, "**markdown**\nnext") as string, /data-type="strong"/,
            "multiline IDE copies retain existing Markdown parsing");
    }
    check.equal(convert("<p>ordinary text</p>", "ordinary text"), false);
    return "process-code-paste-ok";
};

test("code paste detection preserves mixed HTML and standalone IDE clipboard behavior", {timeout: 45000}, async () => {
    const sources = Object.fromEntries([
        ["processCode", "src/protyle/util/processCode.ts"],
        ["escape", "src/util/escape.ts"],
        ["marker", "src/protyle/util/inlineElementMarker.ts"],
    ].map(([key, filename]) => [key, transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
    }).outputText]));
    const execute = `(() => { const __name = value => value; try {
        return (${browserCases.toString()})(${JSON.stringify(sources)});
    } catch (error) { return error.stack; } })()`;
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-process-code-"));
    const script = path.join(directory, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(execute)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /process-code-paste-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-process-code-"));
        rmSync(directory, {recursive: true, force: true});
    }
});
