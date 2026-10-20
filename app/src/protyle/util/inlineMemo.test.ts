import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const load = (source: string, modules: Record<string, object> = {}) => {
        const exports = {};
        new Function("exports", "require", source)(exports, (name: string) => modules[name] || {});
        return exports;
    };
    const escape = load(sources.escape) as typeof import("../../util/escape");
    const memoAPI = load(sources.memo, {"../../util/escape": escape}) as typeof import("./inlineMemo");
    const av = load(sources.av) as typeof import("../render/av/richTextValue");
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetHTMLTag2TextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetSpin(true);
    lute.SetProtyleWYSIWYG(true);
    const tooltip = document.createElement("div");
    for (const text of ["<", "<a", "before<a after", "a<b", "vector<T>", "map<K, V>", "<T><Value>",
        "2 < 3", "&lt;a", "&amp;lt;a", "&#60;a", 'A & B "quote"', "first\nsecond", "memo <!--", "<?xml",
        '<a title="<b>"', '<a title="<b>', "<!-- <b> -->", "<!-- <b>"]) {
        let saved = memoAPI.encodeInlineMemoContent(text);
        for (let round = 0; round < 3; round++) {
            const block = document.createElement("div");
            block.innerHTML = '<div data-node-id="20261018120000-abcdefg" data-type="NodeParagraph"><div contenteditable="true"><span data-type="inline-memo">note</span></div></div>';
            block.querySelector("span").setAttribute("data-inline-memo-content", saved);
            block.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(lute.SpinBlockDOM(block.innerHTML)));
            saved = memoAPI.sanitizeInlineMemoContent(block.querySelector("span").getAttribute("data-inline-memo-content"));
            tooltip.innerHTML = window.DOMPurify.sanitize(saved);
            check.equal(tooltip.textContent, text, `reload ${round}: ${text}`);
            check.equal(Lute.UnEscapeHTMLStr(saved), text, `reopen ${round}: ${text}`);
            const exported = document.createElement("div");
            exported.innerHTML = lute.BlockDOM2HTML(block.innerHTML);
            check.equal(exported.querySelector("sup").textContent, `(${text.replace(/\n/g, " ")})`, text);
            check.equal(av.sanitizeAVRichTextInlineMemoContent(saved), saved, text);
            saved = memoAPI.encodeInlineMemoContent(Lute.UnEscapeHTMLStr(saved));
        }
    }
    for (const html of ['<b>bold</b><br><a href="https://example.com/?a=1&amp;b=2">link</a>',
        '<span title="a > b">text</span>', "<b>&lt;em&gt; &amp;lt; &quot;quote&quot;</b>",
        "<table><tbody><tr><td>cell</td></tr></tbody></table>",
        '<svg><circle cx="2" cy="2" r="1"></circle></svg>', "<math><mi>x</mi></math>"]) {
        const canonical = window.DOMPurify.sanitize(html);
        check.equal(memoAPI.sanitizeInlineMemoContent(html), canonical, html);
        check.equal(memoAPI.encodeInlineMemoContent(memoAPI.decodeInlineMemoContent(canonical)), canonical, html);
    }
    for (const unsafe of ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>",
        '<a href="javascript:alert(1)">link</a>', "<svg><g onload=alert(1)></g></svg>",
        '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">']) {
        for (const content of [memoAPI.encodeInlineMemoContent(unsafe), memoAPI.sanitizeInlineMemoContent(unsafe)]) {
            tooltip.innerHTML = content;
            check.equal(tooltip.querySelector("script, [onerror], [onload], [href^='javascript:']"), null, unsafe);
            check.equal(window.DOMPurify.sanitize(content), content, unsafe);
        }
    }
    tooltip.innerHTML = memoAPI.sanitizeInlineMemoContent("legacy<a");
    check.equal(tooltip.textContent, "legacy<a");
    const malformed = "<".repeat(10000);
    check.equal(memoAPI.decodeInlineMemoContent(memoAPI.encodeInlineMemoContent(malformed)), malformed);

    let mobile = false;
    let updates: string[] = [];
    const toolbarAPI = load(sources.toolbar, {
        "../util/inlineMemo": memoAPI,
        "../../util/escape": escape,
        "../util/hasClosest": {
            hasClosestBlock: (element: Element) => element.closest("[data-node-id]"),
            hasClosestByClassName: (element: Element, name: string) => element.closest("." + name),
        },
        "../../constants": {Constants: {ATTRIBUTE_EDITING: "data-editing"}},
        "../../util/functions": {isMobile: () => mobile},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({documentImportExport: false})},
        "../../util/setPosition": {setPosition: (): void => undefined},
        "../util/processCode": {processRender: (): void => undefined},
        "../ui/hideElements": {hideElements: (): void => undefined},
        "../runtimeCapabilities": {areProtylePluginExtensionsEnabled: () => false},
        "../util/selection": {focusByRange: (): void => undefined, focusByWbr: (): void => undefined},
        "../util/selectionOffsets": {focusByRange: (): void => undefined},
        "../wysiwyg/transaction": {
            updateTransaction: (_protyle: IProtyle, block: HTMLElement) => updates.push(block.outerHTML),
            transaction: (_protyle: IProtyle, operations: IOperation[]) => operations.forEach(item => {
                check.equal(typeof item.data, "string");
                updates.push(String(item.data));
            }),
        },
        "dayjs": () => ({format: () => "20261018120000"}),
    }) as typeof import("../toolbar");
    window.siyuan = {languages: {memo: "Memo"}, config: {editor: {}}, menus: {menu: {remove: (): void => undefined}}, zIndex: 1} as unknown as typeof window.siyuan;
    for (mobile of [false, true]) {
        for (const refresh of [false, true]) {
            for (const batch of [false, true]) {
                document.body.innerHTML = '<div id="editor"><div data-node-id="20261018120000-abcdefg" data-type="NodeParagraph"><div contenteditable="true"><span data-type="inline-memo">note</span></div></div></div>';
                const editor = document.getElementById("editor");
                const span = editor.querySelector("span");
                const toolbar = Object.create(toolbarAPI.Toolbar.prototype) as import("../toolbar").Toolbar;
                toolbar.subElement = document.createElement("div");
                toolbar.element = document.createElement("div");
                toolbar.range = document.createRange();
                toolbar.range.selectNodeContents(span);
                getSelection().removeAllRanges();
                getSelection().addRange(toolbar.range);
                Object.assign(toolbar, {clearSubElement: (): void => undefined});
                document.body.append(toolbar.subElement, toolbar.element);
                const protyle = {wysiwyg: {element: editor}, lute} as IProtyle;
                const oldHTML = editor.firstElementChild.outerHTML;
                toolbar.showRender(protyle, span, batch ? [span] : undefined,
                    batch ? new Map([["20261018120000-abcdefg", oldHTML]]) : oldHTML);
                const input = toolbar.subElement.querySelector("textarea");
                if (!refresh) {
                    toolbar.subElement.querySelector('[data-type="refresh"]').classList.remove("block__icon--active");
                }
                input.value = "before<a &lt;";
                input.dispatchEvent(new Event("input", {bubbles: true}));
                if (refresh) {
                    check.equal(Lute.UnEscapeHTMLStr(span.getAttribute("data-inline-memo-content")), input.value);
                }
                updates = [];
                toolbar.subElementCloseCB();
                check.equal(updates.length, 1, JSON.stringify({mobile, refresh, batch}));
                editor.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(updates[0]));
                const reopened = editor.querySelector("span");
                reopened.setAttribute("data-inline-memo-content", memoAPI.sanitizeInlineMemoContent(reopened.getAttribute("data-inline-memo-content")));
                toolbar.showRender(protyle, reopened);
                check.equal(toolbar.subElement.querySelector("textarea").value, "before<a &lt;");
            }
        }
    }
    return "Inline memo browser cases passed";
};

test("inline memo input, reload and export preserve text, legacy HTML and sanitization", {
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(Object.entries({
        escape: "../../util/escape.ts", memo: "inlineMemo.ts", av: "../render/av/richTextValue.ts", toolbar: "../toolbar/index.ts",
    }).map(([name, file]) => [name, transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText]));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-inline-memo-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    const htmlPath = path.resolve(__dirname, "../../../stage/protyle/js/protyle-html.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        await win.webContents.executeJavaScript("{const module=undefined,exports=undefined;" + require("node:fs").readFileSync(${JSON.stringify(htmlPath)}, "utf8") + "}");
        const result = await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(sources) + ")")});
        console.log(result);
        win.destroy();app.exit(0);
    } catch(error) {console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Inline memo browser cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-inline-memo-test-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
});
