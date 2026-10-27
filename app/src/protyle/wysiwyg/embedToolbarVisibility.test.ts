import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, css: string, luteSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    const style = document.createElement("style");
    style.textContent = css + ".protyle-wysiwyg {width: 600px; font-size: 16px;}";
    document.head.appendChild(style);
    const noop = () => {};
    let visible = true;
    const deps: Record<string, unknown> = {
        isEntryVisible: (key: string) => { check.equal(key, "editor.blockEmbed.toolbar"); return visible; },
        Constants: {ZWSP: "\u200b"},
        isInEmbedBlock: (element: Element) => element.parentElement.closest('[data-type="NodeBlockQueryEmbed"]'),
        getHostCapabilities: () => ({}), isFoldedRenderContent: () => false,
        isEncryptedBox: () => false, normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        resolveEmbedBreadcrumbPreference: () => false, isDirectHeadingEmbed: () => false,
        improveBreadcrumbAppearance: noop, processRender: noop, highlightRender: noop, avRender: noop,
        hasClosestByAttribute: () => false,
        fetchPost: (_url: string, _data: unknown, callback: (data: unknown) => void) => callback({data: {blocks: [
            {block: {id: "20261026000000-aaaaaaa", content: '<div data-node-id="20261026000000-aaaaaaa" data-type="NodeParagraph"><div contenteditable="true">Editable first result</div></div>'}, blockPaths: []},
            {block: {id: "20261026000000-bbbbbbb", content: '<div data-node-id="20261026000000-bbbbbbb" data-type="NodeParagraph"><div contenteditable="true">Second result</div></div>'}, blockPaths: []},
        ]}}),
    };
    const load = (name: string) => {
        const exports = {};
        new Function("exports", "require", sources[name])(exports, () => deps);
        Object.assign(deps, exports);
        return exports;
    };
    const api = load("visibility") as typeof import("./embedToolbarVisibility");
    load("frame");
    const render = load("render") as typeof import("../render/blockRender");
    window.siyuan = {languages: {}, config: {editor: {}, system: {safeMode: false}}} as unknown as typeof window.siyuan;
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.contentEditable = "true";
    document.body.appendChild(root);
    const create = () => {
        const embed = document.createElement("div");
        embed.className = "render-node";
        embed.dataset.nodeId = "20261026000000-ccccccc";
        embed.dataset.type = "NodeBlockQueryEmbed";
        embed.dataset.content = "select * from blocks";
        root.appendChild(embed);
        return embed;
    };
    const embed = create();
    const protyle = {block: {rootID: "host"}} as IProtyle;
    const dispose = api.bindEmbedToolbarVisibility(root);
    render.blockRender(protyle, embed);
    const icons = () => Array.from(embed.querySelectorAll<HTMLElement>(":scope > .protyle-icons, :scope > .protyle-wysiwyg__embed > .protyle-icons"));
    check.equal(icons().length, 2);
    check.ok(icons().every(icon => getComputedStyle(icon).display !== "none"));
    const before = lute.BlockDOM2Md(embed.outerHTML);
    visible = false;
    window.dispatchEvent(new CustomEvent("siyuan-entry-visibility"));
    check.ok(icons().every(icon => getComputedStyle(icon).display === "none"));
    check.equal(lute.BlockDOM2Md(embed.outerHTML), before, "visibility settings do not change persisted block content");
    const text = embed.querySelector<HTMLElement>('[contenteditable="true"]');
    const rect = text.getBoundingClientRect();
    check.ok(text.contains(document.elementFromPoint(rect.right - 8, rect.top + 8)), "hidden controls leave text clickable");
    // A query refresh and both SQL/JS async result paths must honor the current profile.
    for (const content of ["select * from blocks", "//!js\nreturn ['result'];"]) {
        embed.dataset.content = content;
        embed.removeAttribute("data-render");
        render.blockRender(protyle, embed);
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(icons().length, 2);
        check.ok(icons().every(icon => getComputedStyle(icon).display === "none"));
    }
    const other = document.createElement("div");
    other.innerHTML = '<div class="protyle-icons">Image or code controls</div>';
    root.appendChild(other);
    const nested = create();
    embed.querySelector(".protyle-wysiwyg__embed").appendChild(nested);
    api.genEmbedRenderFrame(nested);
    visible = true;
    window.dispatchEvent(new CustomEvent("siyuan-entry-visibility"));
    check.ok(icons().every(icon => getComputedStyle(icon).display !== "none"));
    check.equal(getComputedStyle(nested.querySelector(".protyle-icons")).display, "none", "nested query controls retain their original hidden state");
    check.equal(other.firstElementChild.hasAttribute("data-entry-hidden"), false);
    const newEmbed = create();
    visible = false;
    api.genEmbedRenderFrame(newEmbed);
    check.equal(getComputedStyle(newEmbed.querySelector(".protyle-icons")).display, "none", "new embeds start hidden without another settings event");
    visible = true;
    window.dispatchEvent(new CustomEvent("siyuan-entry-visibility"));
    // Preserve the existing caret proximity behavior independently of the profile toggle.
    const toolbar = embed.querySelector<HTMLElement>(":scope > .protyle-icons");
    const editable = embed.querySelector<HTMLElement>('[contenteditable="true"]');
    editable.textContent = "Edit here";
    const toolbarRect = toolbar.getBoundingClientRect();
    editable.style.position = "relative";
    editable.style.left = (toolbarRect.left - editable.getBoundingClientRect().left) + "px";
    root.focus();
    check.ok(root.contains(document.activeElement), "the editor owns focus for caret proximity checks");
    const range = document.createRange();
    range.setStart(editable.firstChild, 0);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    check.equal(toolbar.classList.contains("protyle-icons--editing-obscured"), true,
        `caret ${JSON.stringify(range.getBoundingClientRect())} must hide toolbar ${JSON.stringify(toolbar.getBoundingClientRect())}`);
    check.equal(getComputedStyle(toolbar).pointerEvents, "none");
    dispose();
    check.equal(toolbar.classList.contains("protyle-icons--editing-obscured"), false);
    visible = false;
    window.dispatchEvent(new CustomEvent("siyuan-entry-visibility"));
    check.equal(toolbar.hasAttribute("data-entry-hidden"), false, "destroyed editors release the profile listener");
    root.remove();
    return "Embed toolbar cases passed";
};

test("embed toolbar profiles update existing, refreshed, and new controls without changing content", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = Object.fromEntries(Object.entries({visibility: "wysiwyg/embedToolbarVisibility", frame: "render/util", render: "render/blockRender"})
        .map(([key, file]) => [key, transpileModule(readFileSync(`src/protyle/${file}.ts`, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText]));
    const css = compileString('@use "protyle/protyle"; @use "component/typography"; .fn__none {display: none !important;}',
        {loadPaths: ["src/assets/scss"], logger: {warn() {}, debug() {}}}).css;
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + [sources, css,
        readFileSync("stage/protyle/js/lute/lute.min.js", "utf8")].map(value => JSON.stringify(value)).join(",") + ")";
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-embed-toolbar-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) {console.error(error); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Embed toolbar cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-embed-toolbar-")) {
            rmSync(temporary, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
        }
    }
});
