import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = new Function("Constants", "isInEmbedBlock", "restoreTableVirtualizationDOM", source +
        "\nreturn {highlightMobileSearchResult, clearMobileSearchHighlight, getSearchMarkRanges, searchMarkRender};")(
        {TIMEOUT_COUNT: 1000, TIMEOUT_TRANSITION: 20},
        (element: HTMLElement) => !!element.closest('[data-type="NodeBlockQueryEmbed"]'), () => {}) as
        typeof import("./searchHighlight") & typeof import("../../protyle/render/searchMarkRender");
    const pause = () => new Promise(resolve => setTimeout(resolve, 80));
    const cssHighlights = CSS.highlights;
    const setCSSSupport = (supported: boolean) => Object.defineProperty(CSS, "highlights", {
        value: supported ? cssHighlights : undefined, configurable: true,
    });
    const content = document.createElement("div");
    content.className = "protyle-content";
    content.style.cssText = "height:300px;width:320px;overflow:auto;line-height:24px;font-size:16px";
    document.body.append(content);
    const title = document.createElement("div");
    title.textContent = "Title needle";
    const wysiwyg = document.createElement("div");
    content.append(title, wysiwyg);
    const protyle = {
        element: content, contentElement: content, wysiwyg: {element: wysiwyg},
        block: {rootID: "doc"}, title: {editElement: title, element: title},
        highlight: {mark: new Highlight(), markHL: new Highlight(), ranges: [], rangeIndex: 0,
            styleElement: document.createElement("style")},
    } as unknown as IProtyle;
    protyle.highlight.styleElement.dataset.uuid = "mobile-test";
    Object.assign(window, {siyuan: {mobile: {editor: {protyle}}}});
    const setup = (html: string) => {
        api.clearMobileSearchHighlight();
        setCSSSupport(true);
        getSelection().removeAllRanges();
        wysiwyg.innerHTML = html + '<div style="height:400px"></div>';
        content.scrollTop = 0;
        protyle.block.rootID = "doc";
        window.siyuan.mobile.editor.protyle = protyle;
    };
    const inView = (range: Range, container: HTMLElement = content) => {
        const rect = range.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        check.ok(rect.top >= viewport.top && rect.bottom <= viewport.bottom,
            `match ${rect.top}-${rect.bottom} outside viewport ${viewport.top}-${viewport.bottom}`);
    };
    const highlighted = () => protyle.highlight.ranges[protyle.highlight.rangeIndex];
    const longText = "line<br>".repeat(80);

    // 共用的桌面端高亮仍按块选择当前命中，并排除工具栏文字和跨越排除节点的匹配。
    setup('<div data-node-id="other">needle</div><div data-node-id="hit">nee<strong>dle</strong>' +
        '<span class="excluded">needle</span>end</div>');
    await new Promise<void>(resolve => api.searchMarkRender(protyle, ["needle", "needleend"], "hit", resolve,
        {rootElement: wysiwyg, excludeSelector: ".excluded"}));
    check.equal(protyle.highlight.ranges.length, 2);
    check.equal(highlighted().toString(), "needle");
    check.ok(wysiwyg.querySelector('[data-node-id="hit"]').contains(highlighted().startContainer));
    protyle.highlight.mark.clear();
    protyle.highlight.markHL.clear();
    protyle.highlight.ranges = [];

    // 长段落中跨文本节点的命中按阅读顺序定位，列表外相同词和隐藏文字不参与。
    setup('<div data-node-id="other">needle</div><div data-node-id="hit">' +
        '<span style="display:none">needle</span>' + longText + "nee<strong>dle</strong> second</div>");
    const before = wysiwyg.innerHTML;
    api.highlightMobileSearchResult(protyle, "hit", ["second", "needle"]);
    await pause();
    check.equal(highlighted().toString(), "needle");
    check.equal(protyle.highlight.markHL.size, 1);
    check.equal(protyle.highlight.mark.size, 1);
    inView(highlighted());
    check.equal(wysiwyg.innerHTML, before);
    check.equal(getSelection().toString(), "");

    // 同一编辑器再次打开其他命中块时清理旧标记，并保留没有正文命中的块级位置。
    api.highlightMobileSearchResult(protyle, "other", ["needle"]);
    await pause();
    check.equal(protyle.highlight.ranges.length, 1);
    check.equal(highlighted().startContainer.parentElement.dataset.nodeId, "other");
    content.scrollTop = 120;
    api.highlightMobileSearchResult(protyle, "hit", ["attribute-only"]);
    await pause();
    check.equal(protyle.highlight.ranges.length, 0);
    check.equal(content.scrollTop, 120);
    api.highlightMobileSearchResult(protyle, "hit", []);
    check.equal(protyle.highlight.mark.size, 0);

    // 聚焦后的折叠块与普通命中块使用同一高亮流程；嵌入的同 ID 内容不得抢走定位。
    setup('<div data-type="NodeBlockQueryEmbed"><div data-node-id="hit">needle</div></div>' +
        '<div data-node-id="hit">' + longText + "needle</div>");
    api.highlightMobileSearchResult(protyle, "hit", ["needle"]);
    await pause();
    check.equal(highlighted().startContainer.parentElement.closest('[data-type="NodeBlockQueryEmbed"]'), null);
    inView(highlighted());

    // 标题命中只定位标题，不能把正文的相同词当成当前结果。
    api.highlightMobileSearchResult(protyle, "doc", ["needle"]);
    await pause();
    check.ok(title.contains(highlighted().startContainer));
    inView(highlighted());

    // 代码渲染替换节点后重新计算命中范围，并处理代码容器的横向和纵向滚动。
    setup('<div data-node-id="code" class="code-block"><div class="protyle-action">needle</div>' +
        '<div class="hljs" style="overflow:auto;max-height:140px"><div contenteditable="false">needle</div>' +
        '<div contenteditable="true" style="white-space:pre">' + "line\n".repeat(60) +
        "x".repeat(150) + "needle</div></div></div>");
    api.highlightMobileSearchResult(protyle, "code", ["needle"]);
    await pause();
    const code = wysiwyg.querySelector<HTMLElement>('[contenteditable="true"]');
    code.innerHTML = code.textContent.replace("needle", '<span class="hljs-string">nee</span>dle');
    await pause();
    check.equal(highlighted().toString(), "needle");
    check.equal(protyle.highlight.ranges.length, 1);
    inView(highlighted(), code.parentElement);
    const rect = highlighted().getBoundingClientRect();
    const viewport = code.parentElement.getBoundingClientRect();
    check.ok(rect.left >= viewport.left && rect.right <= viewport.right);

    // 旧 WebView 使用真实原生选区，正文内容和节点结构不变。
    setup('<div data-node-id="hit">' + longText + "nee<strong>dle</strong></div>");
    setCSSSupport(false);
    const legacyHTML = wysiwyg.innerHTML;
    api.highlightMobileSearchResult(protyle, "hit", ["needle"]);
    await pause();
    check.equal(getSelection().toString(), "needle");
    inView(getSelection().getRangeAt(0));
    check.equal(wysiwyg.innerHTML, legacyHTML);
    api.clearMobileSearchHighlight();
    check.equal(getSelection().toString(), "");

    // 快速切换和已失效的文档渲染不能再滚动或添加高亮。
    for (const invalidate of [() => api.clearMobileSearchHighlight(), () => { protyle.block.rootID = "new-doc"; },
        () => { window.siyuan.mobile.editor.protyle = {} as IProtyle; }]) {
        setup('<div data-node-id="hit">' + longText + "needle</div>");
        api.highlightMobileSearchResult(protyle, "hit", ["needle"]);
        invalidate();
        await pause();
        check.equal(protyle.highlight.markHL.size, 0);
        check.equal(content.scrollTop, 0);
    }
    setup('<div data-node-id="hit">' + longText + "needle</div>");
    api.highlightMobileSearchResult(protyle, "hit", ["needle"]);
    await pause();
    content.dispatchEvent(new Event("beforeinput", {bubbles: true}));
    check.equal(protyle.highlight.markHL.size, 0);
    const scrollTop = content.scrollTop;
    wysiwyg.querySelector('[data-node-id="hit"]').prepend(document.createTextNode("needle"));
    await pause();
    check.equal(content.scrollTop, scrollTop);
    check.equal(protyle.highlight.markHL.size, 0);

    api.clearMobileSearchHighlight();
    setCSSSupport(true);
    content.remove();
    return "Mobile search highlighting cases passed";
};

test("mobile search highlights and scrolls real text ranges without changing document content", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const source = compile(readFileSync(path.join(__dirname, "../../protyle/render/searchMarkRender.ts"), "utf8")) +
        "\n" + compile(readFileSync(path.join(__dirname, "searchHighlight.ts"), "utf8"));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mobile-search-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`)}));
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
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Mobile search highlighting cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-mobile-search-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
