import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {createSourceFile, isClassDeclaration, isConstructorDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string, constructorSource: string) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const roots = new WeakMap();
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    let resolveLoad: (result: string) => void;
    let requests = 0;
    const errors: Error[] = [];
    const syncHeight = (list: HTMLElement, host: HTMLElement) => {
        host.style.setProperty("--mindmap-view-height", list.style.height);
    };
    // 执行实际构造器的视图准备部分，重布局、事件绑定和节点编辑不参与加载状态测试。
    const Controller = new Function("readListMindmap", "syncListMindmapHeight", constructorSource +
        "; return LoadingController;")(() => ({}), syncHeight);
    const dependencies = {
        console: {error: (error: Error) => errors.push(error)},
        roots,
        Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap", ATTRIBUTE_EDITING: "data-editing"},
        getListMindmapElements: (root: Element) => Array.from(root.querySelectorAll('[data-type="NodeMindmap"]')),
        isFoldedRenderContent: (element: Element) => !!element.closest('[fold="1"]'),
        syncListMindmapHeight: syncHeight,
        canEdit: (owner: {disabled?: boolean}) => !owner.disabled,
        isProtyleListItemFragment: (owner: {fragment?: boolean}) => owner.fragment === true,
        completeList: () => {
            requests++;
            return new Promise<string>(resolve => { resolveLoad = resolve; });
        },
        registerListMindmapRoot: () => () => {},
        requestAnimationFrame: (callback: FrameRequestCallback) => {
            frames.set(++sequence, callback);
            return sequence;
        },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        ListMindmapController: class extends Controller {
            refresh() {}
            async finish() { return true; }
            destroy() {}
        },
    };
    const init = new Function(...Object.keys(dependencies), source + "; return initListMindmaps;")(...Object.values(dependencies));
    const flush = async () => {
        for (let i = 0; i < 8; i++) {
            await Promise.resolve();
        }
    };
    const frame = async () => {
        const callbacks = Array.from(frames.values());
        frames.clear();
        callbacks.forEach(callback => callback(0));
        await flush();
    };
    for (const folded of ["parent", "self"]) {
        const root = document.createElement("div");
        root.className = "protyle-wysiwyg";
        root.innerHTML = '<div data-type="NodeTabs" data-node-id="tabs"><div data-type="NodeMindmap" data-node-id="map">' +
            '<div class="mindmap-item" data-node-id="item">Preserved source</div></div></div>';
        const list = root.querySelector<HTMLElement>('[data-type="NodeMindmap"]');
        const container = folded === "parent" ? root.firstElementChild : list;
        container.setAttribute("fold", "1");
        document.body.appendChild(root);
        const owner = {wysiwyg: {element: root}};
        const before = requests;
        init(owner);
        await frame();
        check.equal(requests, before, "folded mindmaps do not load their full source");
        check.equal(list.querySelector(".mindmap-view"), null);
        check.equal(list.firstElementChild.textContent, "Preserved source");
        container.removeAttribute("fold");
        await flush();
        await frame();
        check.equal(requests, before + 1);
        resolveLoad("complete");
        await flush();
        check.equal(list.querySelector(".mindmap-view").textContent, "Rendered");
        roots.get(owner).destroy();
        root.remove();
    }
    for (const [wrapper, result] of ["NodeBlockquote", "NodeCallout"].flatMap(wrapper =>
        ["complete", "failed", "changed", "destroy"].map(result => [wrapper, result]))) {
        const root = document.createElement("div");
        root.className = "protyle-wysiwyg";
        document.body.appendChild(root);
        const owner = {wysiwyg: {element: root}};
        init(owner);
        root.innerHTML = `<div data-type="${wrapper}"><div data-type="NodeMindmap" data-node-id="map" style="height:320px">` +
            '<div class="mindmap-item" data-type="NodeMindmapItem" data-node-id="item">Source text</div>' +
            '<div class="mindmap-view" aria-busy="true">Cloned loading view</div>' +
            '<div class="mindmap-view">Cloned rendered view</div></div></div>';
        await flush();
        const list = root.querySelector<HTMLElement>('[data-type="NodeMindmap"]');
        const item = list.firstElementChild;
        check.equal(list.querySelectorAll(":scope > .mindmap-view").length, 1, "undo clones must not retain stale views");
        check.equal(getComputedStyle(item).display, "none", "Source must be hidden before the first frame");
        check.equal(list.querySelector(".mindmap-view").getBoundingClientRect().height, 320);
        check.equal(list.querySelectorAll('[aria-busy="true"]').length, 1);
        await frame();
        const previousRequests = requests;
        if (result === "destroy") {
            roots.get(owner).destroy();
        }
        resolveLoad(result === "destroy" ? "complete" : result);
        await flush();
        if (result === "changed") {
            check.equal(list.querySelectorAll('[aria-busy="true"]').length, 1);
            await frame();
            resolveLoad("complete");
            await flush();
        }
        if (result === "failed" || result === "destroy") {
            check.notEqual(getComputedStyle(item).display, "none");
            check.equal(list.querySelector(".mindmap-view"), null);
            await frame();
            check.equal(requests, previousRequests, "Failure must not cause a request loop");
        } else {
            check.ok(list.querySelector(".mindmap-view"), `${result}: ${list.outerHTML}`);
            check.equal(list.querySelectorAll(":scope > .mindmap-view").length, 1);
            check.equal(list.querySelector(".mindmap-view").textContent, "Rendered");
            check.equal(list.querySelector('[aria-busy="true"]'), null);
            check.equal(getComputedStyle(item).display, "none");
        }
        roots.get(owner).destroy();
        root.remove();
    }
    check.deepEqual(errors, []);
    for (const lite of [false, true]) {
        const root = document.createElement("div");
        root.className = "protyle-wysiwyg";
        root.innerHTML = '<div class="protyle-wysiwyg__embed"><div data-type="NodeMindmap" data-node-id="embedded">' +
            "<div>Partial source</div></div></div>";
        document.body.append(root);
        const owner = {lite, fragment: lite, disabled: true, wysiwyg: {element: root}};
        const previousRequests = requests;
        init(owner);
        await frame();
        check.equal(requests, previousRequests, "read-only embeds do not load editable source");
        owner.disabled = false;
        roots.get(owner).refresh();
        await frame();
        check.equal(requests, previousRequests + 1, "permission changes must hydrate before enabling editing");
        resolveLoad("complete");
        await flush();
        await frame();
        check.equal(requests, previousRequests + 1, "completed source is reused by later refreshes");
        roots.get(owner).destroy();
        root.remove();
    }
    const remounted = document.createElement("div");
    remounted.innerHTML = '<div data-node-id="source">Preserved source</div>' +
        '<div class="mindmap-view" aria-busy="true">Stale loading</div><div class="mindmap-view">Stale rendered</div>';
    new Controller({}, remounted);
    check.equal(remounted.querySelectorAll(":scope > .mindmap-view").length, 1);
    check.equal(remounted.querySelector(".mindmap-view").textContent, "Rendered");
    check.equal(remounted.firstElementChild.textContent, "Preserved source");
    for (const fragment of [false, true]) {
        const root = document.createElement("div");
        root.className = "protyle-wysiwyg";
        root.innerHTML = '<div data-type="NodeMindmap" data-node-id="local"><div>Local content</div></div>';
        document.body.append(root);
        const owner = {lite: true, fragment, wysiwyg: {element: root}};
        const previousRequests = requests;
        init(owner);
        await frame();
        check.equal(!!root.querySelector(".mindmap-view"), fragment);
        check.equal(requests, previousRequests, "local fragments must not reload content from the kernel");
        if (fragment) {
            check.equal(await roots.get(owner).finish(), true);
            roots.get(owner).destroy();
        }
        root.remove();
    }
    return "Mindmap loading cases passed";
};

test("mindmap loading hides source before paint and recovers after failure or disposal", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const text = readFileSync(path.join(__dirname, "index.ts"), "utf8");
    const source = transpileModule(text.slice(text.indexOf("export const initListMindmaps ="),
        text.indexOf("export const destroyListMindmaps =")).replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const ast = createSourceFile("index.ts", text, ScriptTarget.Latest, true);
    const controller = ast.statements.find(statement => isClassDeclaration(statement) &&
        statement.name?.text === "ListMindmapController");
    assert.ok(controller && isClassDeclaration(controller));
    const constructor = controller.members.find(isConstructorDeclaration).body.getText(ast);
    const constructorSource = transpileModule("class LoadingController {constructor(owner, list) " +
        constructor.slice(0, constructor.indexOf("const renderGutter =")) +
        'list.appendChild(this.host); this.host.textContent = "Rendered";}}', {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/base.scss"), {
        logger: require("sass").Logger.silent,
    }).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-loading-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)},
${JSON.stringify(constructorSource)})`)}));
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
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 25000, windowsHide: true,
        });
        assert.match(result.stdout, /Mindmap loading cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
