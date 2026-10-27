import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (renderSource: string, onGetSource: string, reloadSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const calls: {kind: string, root: Element}[] = [];
    let releaseDatabase: (() => void) | undefined;
    let holdDatabase = false;
    const noop = (): undefined => undefined;
    const renderers = {
        processRender: (root: Element) => calls.push({kind: "process", root}),
        highlightRender: (root: Element) => calls.push({kind: "highlight", root}),
        avRender: async (root: Element) => {
            calls.push({kind: "database", root});
            if (holdDatabase) {
                holdDatabase = false;
                await new Promise<void>(resolve => { releaseDatabase = resolve; });
            }
        },
        blockRender: (_protyle: IProtyle, root: Element) => calls.push({kind: "embed", root}),
        beginPerformance: noop,
    };
    const {getInsertedRenderRoots, renderContent} = new Function(...Object.keys(renderers), renderSource +
        "\nreturn {getInsertedRenderRoots, renderContent};")(...Object.values(renderers)) as {
        getInsertedRenderRoots: (container: Element, boundary: Element | null, before: boolean) => Element[],
        renderContent: (protyle: IProtyle, roots: Element[], before?: () => void, valid?: () => boolean) => Promise<boolean>,
    };
    const Constants = {CB_GET_APPEND: "append", CB_GET_BEFORE: "before", CB_GET_HISTORY: "history",
        CB_GET_BACKLINK: "backlink", SIYUAN_VERSION: "test", ATTRIBUTE_V_SCROLL: "data-v-scroll"};
    const preserveReloadScroll = new Function("Constants", reloadSource + "\nreturn preserveReloadScroll;")(Constants) as
        typeof import("./reloadScroll").preserveReloadScroll;
    let disposed: Element[] = [];
    const dependencies = {Constants, getInsertedRenderRoots, renderContent,
        migrateLegacyMindmapsBeforeRender: () => false, setCustomBlockRootReady: noop,
        sanitizeInlineMemoContent: (value: string) => value, normalizeHTMLAssetIFrameSources: noop,
        updateWidgetCacheVersion: noop, containsCurrentSelection: () => false,
        invalidateTrackedRangesInElement: noop, disposeCustomBlocksInElement: (root: Element) => disposed.push(root),
        hideElements: noop, invalidateTrackedRanges: noop, applyPublishFoldStates: noop,
        updateDocumentBottomEof: noop, activeBlur: noop, getContenteditableElement: (): HTMLElement | null => null,
        foldPassiveType: noop, renderHeadingNumbers: noop, queueHeadingNumberRefresh: noop, beginPerformance: noop};
    const setHTML = new Function(...Object.keys(dependencies), onGetSource + "\nreturn setHTML;")(
        ...Object.values(dependencies)) as (options: Record<string, unknown>, protyle: IProtyle) => void;
    const content = document.createElement("div");
    const container = document.createElement("div");
    content.style.cssText = "height: 200px; width: 300px; overflow: auto; overflow-anchor: none";
    container.className = "protyle-wysiwyg";
    content.append(container);
    document.body.append(content);
    const protyle = {contentElement: content, wysiwyg: {element: container, prepareBlockVirtualization: noop},
        block: {rootID: "root", showAll: true}, scroll: {shouldKeepLoadedContent: () => true}} as unknown as IProtyle;
    const load = (action: string[], html: string, callbacks: Record<string, unknown> = {}) => setHTML({
        action: [...action, "history"], content: html, eof: true, isSyncing: false, expand: false, ...callbacks}, protyle);
    const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); } };
    const oldHTML = Array.from({length: 100}, (_v, index) =>
        `<div data-node-id="old-${index}" style="height: 20px"><span contenteditable="true">Old ${index}</span></div>`).join("");
    container.innerHTML = oldHTML;
    const oldFirst = container.firstElementChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(oldFirst.firstElementChild);
    selection.removeAllRanges();
    selection.addRange(range);
    load(["append"], '<div data-node-id="new-math" data-type="NodeMathBlock"></div>' +
        '<div data-node-id="new-av" data-type="NodeAttributeView"></div>' +
        '<div data-node-id="new-embed" data-type="NodeBlockQueryEmbed"></div>');
    await settle();
    check.deepEqual(calls.slice(0, 6).map(call => call.kind),
        ["process", "process", "process", "highlight", "highlight", "highlight"], "render phases keep their order");
    for (const kind of ["process", "highlight", "database", "embed"]) {
        check.deepEqual(calls.filter(call => call.kind === kind).map(call => call.root.getAttribute("data-node-id")),
            ["new-math", "new-av", "new-embed"], `${kind} visits inserted roots including the root itself`);
    }
    check.equal(container.firstElementChild, oldFirst);
    check.equal(selection.anchorNode, oldFirst.firstElementChild, "appending keeps the existing selection node");
    check.equal(disposed.length, 0, "retained components are not disposed");
    calls.length = 0;
    content.scrollTop = 500;
    const beforeTop = oldFirst.getBoundingClientRect().top;
    load(["before"], '<div data-node-id="new-list" style="height: 60px"><div data-type="NodeMathBlock"></div></div>');
    await settle();
    check.equal(oldFirst.getBoundingClientRect().top, beforeTop, "prepending keeps the existing scroll anchor");
    check.deepEqual(calls.filter(call => call.kind === "process").map(call => call.root.getAttribute("data-node-id")), ["new-list"]);
    check.equal(container.firstElementChild.getAttribute("data-eof"), "1");
    calls.length = 0;
    load(["append"], "");
    await settle();
    check.equal(calls.length, 0, "an empty append does not rescan old content");
    load([], '<div data-node-id="replacement"></div>');
    await settle();
    check.equal(calls.find(call => call.kind === "process").root, container, "full replacements retain whole-root rendering");
    check.equal(disposed.at(-1), container, "full replacements retain disposal");

    // 设置刷新会替换首个节点，渲染检查必须使用这次替换后的基准。
    container.innerHTML = '<div data-type="NodeBlockQueryEmbed" style="height: 800px">Old embed</div>' +
        '<div class="av" data-render="true" data-node-id="av" data-av-id="data" data-av-type="table">' +
        '<div class="av__container"><div class="av__body" data-page-size="100">Saved database</div></div></div>';
    content.scrollTop = 120;
    const reload = preserveReloadScroll(protyle, content.scrollTop);
    const reloadFirst = container.firstElementChild;
    calls.length = 0;
    let reloadCompleted = 0;
    load([], '<div data-type="NodeBlockQueryEmbed" style="height: 800px"></div>' +
        '<div class="av" data-node-id="av" data-av-id="data" data-av-type="table"><div></div></div>', {
        isValid: reload.isValid, beforeAVRender: reload.beforeAVRender,
        afterAVRender: async () => { await reload.afterAVRender(); reloadCompleted++; },
        onAVRenderError: () => check.fail("a valid document replacement must render"),
    });
    await settle();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    check.notEqual(container.firstElementChild, reloadFirst);
    check.deepEqual(calls.map(call => call.kind), ["process", "highlight", "database", "embed"],
        "a settings reload must initialize content, highlighting, databases and embedded queries");
    check.equal(container.querySelector(".av__body").getAttribute("data-page-size"), "100");
    check.equal(content.scrollTop, 120);
    check.equal(protyle.scroll.lastScrollTop, 120);
    check.equal(reloadCompleted, 1);

    // 新请求、导航和关闭仍拒绝旧响应，用户输入只取消位置恢复。
    calls.length = 0;
    const staleReload = preserveReloadScroll(protyle, 120);
    const currentReload = preserveReloadScroll(protyle, 120);
    let reloadFailures = 0;
    const rejectReload = (state: typeof staleReload) => load([], "<div>Stale content</div>", {
        isValid: state.isValid, beforeAVRender: state.beforeAVRender,
        onAVRenderError: () => reloadFailures++,
    });
    rejectReload(staleReload);
    check.equal(reloadFailures, 1);
    protyle.block.rootID = "other-root";
    rejectReload(currentReload);
    check.equal(reloadFailures, 2);
    protyle.block.rootID = "root";
    const closedReload = preserveReloadScroll(protyle, 120);
    content.remove();
    rejectReload(closedReload);
    check.equal(reloadFailures, 3);
    check.equal(calls.length, 0, "invalid reloads do not initialize components");
    document.body.append(content);
    const inputReload = preserveReloadScroll(protyle, 120);
    content.dispatchEvent(new Event("pointerdown", {bubbles: true}));
    load([], '<div data-type="NodeBlockQueryEmbed" style="height: 800px"></div>', {
        isValid: inputReload.isValid, beforeAVRender: inputReload.beforeAVRender,
    });
    content.scrollTop = 80;
    await inputReload.afterAVRender();
    check.deepEqual(calls.map(call => call.kind), ["process", "highlight", "database", "embed"]);
    check.equal(content.scrollTop, 80, "user input cancels scrolling without suppressing the reload");

    // 裁剪可能移除已收集的新节点，异步数据库工作必须再次检查实际归属。
    container.innerHTML = '<div id="a"></div><div id="b"></div><div id="c"></div>';
    const [a, b, c] = Array.from(container.children);
    calls.length = 0;
    holdDatabase = true;
    let valid = true;
    const pending = renderContent(protyle, [a, b, c], undefined, () => valid);
    b.remove();
    valid = false;
    releaseDatabase();
    check.equal(await pending, false, "invalidated content must not trigger completion callbacks");
    check.deepEqual(calls.filter(call => call.kind === "database").map(call => call.root.id), ["a"],
        "an invalidated document does not start later database renders");
    calls.length = 0;
    valid = true;
    await renderContent(protyle, [b, c]);
    check.equal(calls.some(call => call.root === b), false, "removed nodes do not render");
    check.equal(calls.some(call => call.root === c), true);

    // 完成与失效通知必须覆盖真实数据库渲染的等待区间。
    let completed = 0;
    let failures = 0;
    holdDatabase = true;
    load([], '<div data-node-id="pending-av"></div>', {
        afterAVRender: () => completed++, onAVRenderError: () => failures++,
    });
    await settle();
    check.equal(completed, 0);
    releaseDatabase();
    await settle();
    check.equal(completed, 1);
    check.equal(failures, 0);
    holdDatabase = true;
    valid = true;
    load([], '<div data-node-id="invalidated-av"></div>', {
        isValid: () => valid, afterAVRender: () => completed++, onAVRenderError: () => failures++,
    });
    valid = false;
    releaseDatabase();
    await settle();
    check.equal(completed, 1);
    check.equal(failures, 1, "an invalidated render settles its reload as a failure");
    load([], "", {isValid: () => false, onAVRenderError: () => failures++});
    check.equal(failures, 2, "a render invalidated before insertion also settles");

    // 大文档追加的扫描规模由新块数决定；这里只比较遍历工作量，不代表整页耗时。
    container.innerHTML = Array.from({length: 20000}, () => '<div><span class="target"></span></div>').join("");
    const boundary = container.lastElementChild;
    container.insertAdjacentHTML("beforeend", '<div><span class="target"></span></div>'.repeat(20));
    const roots = getInsertedRenderRoots(container, boundary, false);
    check.equal(container.querySelectorAll(".target").length, 20020);
    check.equal(roots.reduce((count, root) => count + root.querySelectorAll(".target").length, 0), 20);
    check.equal(roots.length, 20);
    container.innerHTML = "";
    check.deepEqual(getInsertedRenderRoots(container, null, false), []);
    container.innerHTML = '<div id="only"></div>';
    check.deepEqual(getInsertedRenderRoots(container, null, true), [container.firstElementChild]);
    disposed = [];
    content.remove();
    return "Content rendering cases passed; scanned targets 20020 -> 20";
};

test("dynamic content renders inserted roots and preserves replacement, selection and scroll behavior", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const compile = (source: string) => transpileModule(source, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const renderSource = readFileSync(path.join(__dirname, "renderContent.ts"), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replaceAll("export const", "const");
    const reloadSource = readFileSync(path.join(__dirname, "reloadScroll.ts"), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replaceAll("export const", "const");
    const onGetSource = readFileSync(path.join(__dirname, "onGet.ts"), "utf8");
    const start = onGetSource.indexOf("const setHTML = ");
    const end = onGetSource.indexOf("export const disabledForeverProtyle", start);
    assert.ok(start > 0 && end > start);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-render-content-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" +
        JSON.stringify(compile(renderSource)) + "," + JSON.stringify(compile(onGetSource.slice(start, end))) + "," +
        JSON.stringify(compile(reloadSource)) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
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
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Content rendering cases passed; scanned targets 20020 -> 20/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-render-content-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
