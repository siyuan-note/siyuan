import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source.replace(/export /g, ""), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const sliceSource = (file: string, start: string, end?: string) => {
    const source = readFileSync(path.join(__dirname, file), "utf8");
    const startIndex = source.indexOf(start);
    const endIndex = end ? source.indexOf(end, startIndex) : source.length;
    assert.ok(startIndex >= 0 && endIndex > startIndex);
    return source.slice(startIndex, endIndex);
};

const sources = {
    layout: compile(readFileSync(path.join(__dirname, "../../mobile/util/mobileTopBar.ts"), "utf8")),
    editor: compile(sliceSource("../../mobile/util/setEmpty.ts", "export const setEditor = ")),
    render: compile(sliceSource("onGet.ts", "export const onGet = ", "export const disabledForeverProtyle = ")),
    loading: compile(sliceSource("../ui/initUI.ts", "export const addLoading = ", "export const setPadding = ")),
    completion: compile(sliceSource("../../mobile/editor.ts", "    let completed = false;", "    if (!isValid()) {")),
};

const browserCases = (code: typeof sources) => {
    const check: typeof assert = require("node:assert/strict");
    const noop = () => {};
    const controlIDs = ["toolbarSidebarLeft", "toolbarName", "toolbarNameReadonly", "toolbarSync", "toolbarSidebarRight"];
    for (const mode of ["portrait", "landscape", "desktop"]) {
        document.body.innerHTML = `<div id="mobileTopBar"><button id="toolbarSidebarLeft"></button>
<input id="toolbarName" value="Previous"><span id="toolbarNameReadonly"></span>
<button id="toolbarSync"></button><button id="toolbarSidebarRight"></button></div>
<div id="editor"><div class="protyle-breadcrumb"><button></button>
<span class="protyle-breadcrumb__space"></span></div><div class="protyle-content"><div class="protyle-wysiwyg"></div></div></div>
<div id="empty" class="fn__none"></div>`;
        const controls = controlIDs.map(id => document.getElementById(id));
        const editorElement = document.getElementById("editor");
        const contentElement = editorElement.querySelector<HTMLElement>(".protyle-content");
        const wysiwygElement = contentElement.querySelector<HTMLElement>(".protyle-wysiwyg");
        const breadcrumbElement = editorElement.querySelector<HTMLElement>(".protyle-breadcrumb");
        const scrollElement = document.createElement("div");
        scrollElement.className = "fn__none";
        let opened = 0;
        let failed = 0;
        const timers: (() => void)[] = [];
        const Constants: Record<string, string | number> = Object.fromEntries(
            [...code.render.matchAll(/Constants\.(\w+)/g)].map(match => [match[1], match[1]]));
        Constants.TIMEOUT_LOAD = 300;
        const protyle = {
            element: editorElement,
            contentElement,
            options: {render: {title: true, breadcrumb: true}, defIds: [] as string[]},
            block: {rootID: "previous"},
            title: {element: document.createElement("div"), render: () => {
                (document.getElementById("toolbarName") as HTMLInputElement).value = "Next";
            }},
            wysiwyg: {element: wysiwygElement, prepareBlockVirtualization: noop},
            breadcrumb: {element: breadcrumbElement.firstElementChild, toggleExit: noop, render: noop},
            scroll: {element: scrollElement, invalidateDynamicLoad: noop},
        };
        const dependencies: Record<string, unknown> = {
            document, DOMParser, Constants,
            window: {matchMedia: () => ({matches: mode === "landscape"}),
                siyuan: {config: {editor: {}, fileTree: {}}, mobile: {editor: {protyle}}}},
            setTimeout: (callback: () => void) => {timers.push(callback);},
            isMobile: () => mode !== "desktop",
            getEmbeddedDocInfoResponse: () => ({data: {ial: {title: "Next"}}}),
            migrateLegacyMindmapsBeforeRender: () => false,
            areProtylePluginExtensionsEnabled: () => false,
            setTitle: noop, finishMobileStartup: noop, bindMobileBarsScroll: noop,
            isValid: () => true, action: [], afterOpen: () => {opened++;}, onFailure: () => {failed++;},
            sanitizeKernelHTML: (html: string) => html,
        };
        for (const name of ["invalidateTrackedRanges", "hideElements", "invalidateHeadingNumberRefresh",
            "normalizeHTMLAssetIFrameSources", "updateWidgetCacheVersion", "disposeCustomBlocksInElement",
            "applyPublishFoldStates", "updateDocumentBottomEof", "processRender", "highlightRender", "avRender",
            "blockRender", "renderHeadingNumbers", "setReadonlyByConfig", "setCustomBlockRootReady", "focusElementById"]) {
            dependencies[name] = noop;
        }
        const runtime = new Function(...Object.keys(dependencies), code.layout + code.editor + code.loading +
            code.render + code.completion + "\nreturn {onGet, addLoading, complete, fail, updateMobileTopBarLayout};")(
            ...Object.values(dependencies));
        if (mode !== "desktop") {
            runtime.updateMobileTopBarLayout();
        }
        const messageElement = breadcrumbElement.firstElementChild.nextElementSibling;
        if (mode === "desktop") {
            messageElement.textContent = "Synchronizing";
        }
        runtime.addLoading(protyle);
        let renderError: unknown;
        try {
            runtime.onGet({protyle, action: [Constants.CB_GET_SCROLL], afterCB: mode === "desktop" ? () => {opened++;} : () => runtime.complete(protyle),
                data: {code: 0, data: {id: "next", rootID: "next", box: "notebook", path: "/next.sy", mode: 0,
                    content: '<div data-node-id="next-block" data-type="NodeParagraph">Next document</div>', isSyncing: false}}});
        } catch (error) {
            renderError = error;
            runtime.fail();
        }
        timers.forEach(callback => callback());
        check.equal(renderError, undefined, `${mode}: document rendering completes without a title lookup error`);
        check.equal(opened, 1, `${mode}: navigation settles successfully`);
        check.equal(failed, 0);
        check.equal(wysiwygElement.textContent, "Next document");
        check.equal(editorElement.getAttribute("data-loading"), "finished");
        check.equal(editorElement.querySelector(".wysiwygLoading"), null, `${mode}: loading overlay is removed`);
        controlIDs.forEach((id, index) => check.equal(document.getElementById(id), controls[index], `${mode}: ${id} remains connected`));
        if (mode === "landscape") {
            controls.forEach(control => check.equal(control.parentElement, messageElement));
        } else if (mode === "desktop") {
            check.equal(messageElement.textContent, "", "desktop synchronization messages are cleared");
        }
    }
    return "Mobile top bar loading cases passed";
};

test("document rendering preserves landscape title controls and finishes loading", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mobile-topbar-loading-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(sources) + ")")}));
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
        assert.match(result.stdout, /Mobile top bar loading cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
