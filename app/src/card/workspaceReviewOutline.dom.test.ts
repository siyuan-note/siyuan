import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (name: string) => transpileModule(readFileSync(`src/card/${name}.ts`, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const browserCases = async (workspaceModule: string, outlineModule: string, css: string) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const waitFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const {siyuan} = window;
    const dockSelector = "[data-workspace-review-outline]";
    const listSelector = "[data-workspace-review-outline-content]";
    const requests: Array<{data: {id: string}, callback: (response: unknown) => void}> = [];
    const load = (source: string, resolve: (name: string) => unknown) => {
        const exports = {};
        new Function("exports", "require", source)(exports, resolve);
        return exports;
    };
    const outline = load(outlineModule, () => ({
        fetchPost: (_url: string, data: {id: string}, callback: (response: unknown) => void) => requests.push({data, callback}),
    }));
    const toggleDesktop = (show = false, close = false) => {
        const button = document.querySelector(".dock__item");
        button.classList.toggle("dock__item--active", !close && (show || !button.classList.contains("dock__item--active")));
        document.querySelector(dockSelector).classList.toggle("fn__none", !button.classList.contains("dock__item--active"));
    };
    const {bindWorkspaceReviewOutline} = load(workspaceModule, name => {
        if (name === "./flashcardOutline") {
            return outline;
        }
        if (name === "../layout/tabUtil") {
            return {getDockByType: () => {
                const layout = document.querySelector<HTMLElement>(".layout__dockl");
                return layout ? {layout: {element: layout}, toggleModel: (_name: string, show: boolean, close: boolean) =>
                    toggleDesktop(show, close)} : undefined;
            }};
        }
        if (name === "../mobile/dock/util") {
            return {openDock: () => { document.querySelector<HTMLElement>(".side-panel").style.transform = "translateX(0px)"; }};
        }
        return {closePanel: () => { document.querySelector<HTMLElement>(".side-panel").style.transform = ""; }};
    }) as typeof import("./workspaceReviewOutline");
    siyuan.languages.outline = "Outline";
    siyuan.languages.emptyContent = "Empty";
    siyuan.dialogs = [];
    siyuan.zIndex = 9;
    document.body.innerHTML = '<button class="dock__item" data-type="outline"></button><aside class="layout__dockl"><div ' +
        'class="fn__none" data-workspace-review-outline><header class="block__icons"><span class="block__logo">Outline</span>' +
        '<input type="search" /></header><div data-ordinary>Original tree</div></div></aside>' +
        '<div class="layout__center"><div data-type="wnd" class="layout__wnd--active"><div data-review><div class="card__block">' +
        '<div data-type="NodeHeading" data-node-id="one"><span data-type="mark">Masked heading</span></div></div></div></div></div>';
    const surface = document.querySelector<HTMLElement>("[data-review]");
    const host = document.querySelector<HTMLElement>(dockSelector);
    const ordinary = host.querySelector("[data-ordinary]");
    const opened: string[] = [];
    let controller = bindWorkspaceReviewOutline({} as never, surface, false, id => opened.push(id));
    controller.update("card1");
    check.equal(requests.length, 0);
    toggleDesktop();
    await waitFrame();
    check.equal(host.querySelectorAll(listSelector).length, 1);
    check.equal(surface.querySelector(listSelector), null);
    check.equal(getComputedStyle(ordinary).display, "none");
    check.equal(getComputedStyle(host.querySelector("input")).display, "none");
    check.equal(requests[0].data.id, "card1");
    controller.update("card2");
    requests[0].callback({data: {rootID: "stale"}});
    check.equal(requests.length, 2);
    requests[1].callback({data: {rootID: "document2"}});
    requests[2].callback({data: [{id: "one", name: "Masked heading"}, {id: "other", name: "Hidden heading"}]});
    const liveList = host.querySelector(listSelector);
    check.equal(liveList.textContent, "Outline 1Outline 2");
    controller.reveal(true);
    check.equal(liveList.textContent, "Masked headingOutline 2");
    liveList.querySelector<HTMLButtonElement>('[data-heading-id="other"]').click();
    check.deepEqual(opened, ["other"]);
    controller.destroy();
    check.equal(host.querySelector(listSelector), null);
    check.notEqual(getComputedStyle(ordinary).display, "none");
    check.notEqual(getComputedStyle(host.querySelector("input")).display, "none");

    surface.innerHTML = '<div class="b3-dialog"><div class="card__block"></div></div>';
    siyuan.dialogs = [{element: surface}] as typeof siyuan.dialogs;
    const layout = document.querySelector<HTMLElement>(".layout__dockl");
    controller = bindWorkspaceReviewOutline({} as never, surface, false, id => opened.push(id));
    controller.update("modal");
    await waitFrame();
    check.equal(host.querySelector(listSelector), null);
    check.ok(controller.toggle());
    check.equal(layout.style.zIndex, "10");
    check.equal(document.activeElement, host.querySelector(listSelector));
    check.ok(controller.toggle());
    check.equal(layout.style.zIndex, "");
    check.equal(host.querySelector(listSelector), null);
    controller.destroy();

    document.body.innerHTML = '<div class="side-panel" style="z-index:7"><svg data-type="sidebar-outline-tab"></svg>' +
        '<section data-type="sidebar-outline" data-workspace-review-outline><p data-ordinary>Original tree</p></section></div>' +
        '<div data-review><div class="b3-dialog"><div class="card__block"></div></div></div>';
    const modal = document.querySelector<HTMLElement>("[data-review]");
    const sidebar = document.querySelector<HTMLElement>(".side-panel");
    siyuan.dialogs = [{element: modal}] as typeof siyuan.dialogs;
    controller = bindWorkspaceReviewOutline({} as never, modal, true, id => opened.push(id));
    check.ok(controller.toggle());
    check.equal(sidebar.style.transform, "translateX(0px)");
    check.equal(sidebar.style.zIndex, "11");
    check.equal(sidebar.querySelectorAll(listSelector).length, 1);
    controller.destroy();
    check.equal(sidebar.style.transform, "");
    check.equal(sidebar.style.zIndex, "7");
    check.equal(sidebar.querySelector(listSelector), null);

    document.body.innerHTML = '<div data-review><div class="card__block"></div></div>';
    const detached = document.querySelector<HTMLElement>("[data-review]");
    controller = bindWorkspaceReviewOutline({} as never, detached, false, id => opened.push(id));
    check.equal(controller.toggle(), false);
    check.equal(document.querySelector(listSelector), null);
    controller.destroy();
    return "Workspace review outline verified";
};

test("review uses only the workspace outline, masks answers and restores desktop and mobile docks", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 25000,
}, async () => {
    const sass = require("sass");
    const css = sass.compile("src/assets/scss/business/_card.scss", {logger: sass.Logger.silent}).css +
        "\n.fn__none {display:none}";
    const temp = mkdtempSync(join(tmpdir(), "siyuan-workspace-review-outline-"));
    const script = join(temp, "run.cjs");
    const evaluate = `const __name = value => value; window.siyuan = {languages:{}}; (${browserCases.toString()})(${[
        compile("workspaceReviewOutline"), compile("flashcardOutline"), css,
    ].map(value => JSON.stringify(value)).join(",")})`;
    writeFileSync(script, `const {app,BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(join(temp, "profile"))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    try {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(evaluate)}));
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, timeout: 20000, windowsHide: true});
        assert.match(result.stdout, /Workspace review outline verified/);
    } finally {
        rmSync(temp, {recursive: true, force: true});
    }
});
