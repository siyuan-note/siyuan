import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const requests: Array<{data: {id: string, notebook: string}, reply: (value: unknown) => void}> = [];
    let renders = 0;
    const exports: {renderOutlineDocumentTitle?: (element: HTMLElement, id: string, notebook: string,
        isCurrent: () => boolean) => void} = {};
    new Function("exports", "require", source)(exports, (name: string) => {
        if (name === "../../util/fetch") return {fetchPost: (_url: string, data: {id: string, notebook: string},
            reply: (value: unknown) => void) => requests.push({data, reply})};
        if (name === "../../util/hostCapabilities") return {sanitizeKernelHTML: (html: string) => html};
        if (name === "../render/mathRender") return {mathRender: () => { renders++; }};
        if (name === "../../util/pathName") return {getDocDisplayName: (text: string, empty: boolean) => empty ? "Untitled" : text};
        throw new Error(name);
    });
    const render = exports.renderOutlineDocumentTitle;
    const target = document.createElement("span");
    document.body.append(target);
    const result = (content: string, overrides = {}) => ({code: 0, data: {
        id: "document", notebook: "encrypted-box", format: "inline-ast", text: "Summary", empty: false,
        blockDOM: `<div data-type="NodeParagraph"><div contenteditable="true">${content}</div></div>`, ...overrides,
    }});
    const request = (isCurrent = () => true) => {
        render(target, "document", "encrypted-box", isCurrent);
        const pending = requests.shift();
        check.deepEqual(pending.data, {id: "document", notebook: "encrypted-box"});
        return pending;
    };
    const content = '<span data-type="strong em u s mark sup sub kbd code" style="color:red">Styles</span>' +
        '<span data-type="a" data-href="https://example.com">Link</span><span data-type="tag">Tag</span>' +
        '<span data-type="block-ref" data-id="target" data-subtype="d">Reference</span>' +
        '<span data-type="inline-memo" data-inline-memo-content="Memo">Note</span>' +
        '<span data-type="file-annotation-ref" data-id="assets/a.pdf/annotation">Annotation</span>' +
        '<span data-type="inline-math" data-subtype="math" data-content="x^2" contenteditable="false"></span>' +
        '<span class="img" contenteditable="false"><img src="assets/p.png" alt="Picture" title="Image title"></span>';
    request().reply(result(content));
    check.equal(target.querySelector('[data-type~="strong"]').getAttribute("style"), "color:red");
    check.equal(target.querySelector('[data-type="block-ref"]').getAttribute("data-id"), "target");
    check.equal(target.querySelector('[data-type="inline-memo"]').getAttribute("data-inline-memo-content"), "Memo");
    check.equal(target.querySelector('[data-type="file-annotation-ref"]').getAttribute("data-id"), "assets/a.pdf/annotation");
    check.equal(target.querySelector('[data-type="inline-math"]').getAttribute("data-content"), "x^2");
    check.equal(target.querySelector("img").getAttribute("src"), "assets/p.png");
    check.equal(target.querySelectorAll("[contenteditable], [spellcheck]").length, 0);
    check.equal(target.dataset.protyleLiteRender, "safe");
    check.equal(target.dataset.documentTitleId, "document");
    check.equal(renders, 1);
    const previous = target.innerHTML;
    const pending = request();
    check.equal(target.innerHTML, previous, "refreshing does not flash the rich label back to plain text");
    pending.reply(result("Changed"));
    check.equal(target.textContent, "Changed");
    request().reply(result("Wrong document", {id: "other"}));
    request().reply(result("Wrong notebook", {notebook: "other-box"}));
    request(() => false).reply(result("Switched"));
    check.equal(target.textContent, "Changed");
    const detached = request();
    target.remove();
    detached.reply(result("Locked secret"));
    check.equal(target.textContent, "Changed", "late responses cannot restore detached or locked title content");
    document.body.append(target);
    request().reply({code: -1, data: null});
    check.equal(target.textContent, "Changed", "a failed read retains the existing display");
    request().reply(result("", {format: "plain", text: "**literal** <tag> & slash/title"}));
    check.equal(target.textContent, "**literal** <tag> & slash/title");
    check.equal(target.querySelector("tag"), null);
    request().reply(result('<span class="img"><img src="assets/only.png" alt=""></span>', {text: "", empty: true}));
    check.equal(target.querySelector("img").getAttribute("src"), "assets/only.png", "empty summaries do not hide image-only titles");
    request().reply(result("", {text: "", empty: true}));
    check.equal(target.textContent, "Untitled");
    return "Outline document title cases passed";
};

test("outline document titles preserve native inline content, literal names and notebook-bound request lifetimes", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "outlineDocumentTitle.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-outline-title-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Outline document title cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-outline-title-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
