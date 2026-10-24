import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {BacklinkDatabase} from "../../types/api";

const browserCases = async (sources: string[], css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const load = (source: string, dependencies: object) => {
        const exports: Record<string, any> = {};
        new Function("exports", "require", source)(exports, () => dependencies);
        return exports;
    };
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const toolbar = document.createElement("div");
    toolbar.innerHTML = '<button style="position:fixed;left:1420px;top:430px;width:24px;height:24px">Filter</button>';
    document.body.append(toolbar);
    const target = toolbar.firstElementChild as HTMLElement;
    // 保留右侧空间，避免运行器屏幕限制原生窗口后把锚点放在视口外。
    target.style.left = `${window.innerWidth - 380}px`;
    const originalRect = target.getBoundingClientRect();
    type Selection = {avID: string, filters: IAVFilter[]};
    let finishFields: () => void;
    let context: {menuElement: HTMLElement};
    const fieldsReady = new Promise<void>(resolve => { finishFields = resolve; });
    window.siyuan = {zIndex: 0, config: {editor: {backlinkContainChildren: true}},
        notebooks: [], languages: {reset: "Reset", backlinkDatabaseFields: "Database fields"},
        menus: {menu: {remove() {}, append() {}, popup() {}}}} as unknown as typeof window.siyuan;
    const position = load(sources[0], {getTopBarHeight: () => 42});
    const panel = load(sources[1], new Proxy({
        ...position, getPageSize: () => ({}), isMobile: () => false,
        getFieldsByData: (data: IAV) => { check.ok("columns" in data.view); return data.view.columns; },
        escapeAttr: (value: string) => value,
        prepareFilterColumns: () => fieldsReady,
        getAVPanelDescriptor: () => ({render: (value: typeof context & {html: string}) => {
            context = value;
            value.html = '<div style="height:80px">Filter conditions</div>';
            return true;
        }}),
    }, {get: (object, key) => key in object ? Reflect.get(object, key) : () => {}}));
    const databases: BacklinkDatabase[] = [{id: "tasks", name: "Tasks", keys: []}];
    const databaseFilter = load(sources[2], {
        ...panel, escapeHtml: (value: string) => value,
        fetchSyncPost: async () => ({code: 0, data: databases}),
    });
    const menuItems: IMenu[] = [];
    const backlinkModule = load(sources[3], new Proxy({
        Model: class {}, BACKLINK_BLOCK_TYPES: [],
        normalizeBacklinkFoldTypes: (): string[] => [], getBacklinkSourceFilterParam: (): undefined => undefined,
        isEncryptedBox: () => false, ...databaseFilter,
        toggleMenu: (options: {build: (menu: object, session: {show: (render: () => void) => void}) => void}) => {
            options.build({}, {show: render => render()});
        },
        MenuItem: class {
            element = document.createElement("button");
            constructor(options: IMenu) { menuItems.push(options); options.bind?.(this.element); }
        },
    }, {get: (object, key) => key in object ? Reflect.get(object, key) : () => {}}));
    const backlink = Object.create(backlinkModule.BacklinkContent.prototype);
    Object.assign(backlink, {
        sourceFilter: {dailyNote: "all", excludeSelf: false, excludedRefDefIDs: [], excludedNotebookIDs: []},
        blockId: "topic", inputsElement: [{value: ""}], editors: [],
        applySourceFilter: (filter: {database: Selection}) => {
            backlink.sourceFilter = filter;
            target.replaceWith(target.cloneNode(true));
        },
    });
    backlink.showSourceFilterMenu(target);
    // 移入子菜单后，原工具栏按钮不再处于悬停显示状态。
    target.style.display = "none";
    check.equal(target.getBoundingClientRect().width, 0);
    const items: IMenu[] = await menuItems.find(item => item.label === "Database fields").loadSubmenu();
    items[2].click(null, null);
    check.equal(target.isConnected, false);
    finishFields();
    await new Promise(requestAnimationFrame);
    const menu = document.querySelector<HTMLElement>(".av__panel > .b3-menu");
    check.ok(menu);
    let rect = menu.getBoundingClientRect();
    check.ok(Math.abs(rect.right - originalRect.right) <= 1, "the filter panel stays beside the clicked backlink toolbar");
    check.equal(rect.top, originalRect.bottom);
    window.dispatchEvent(new Event("resize"));
    check.equal(menu.getBoundingClientRect().top, originalRect.bottom, "a detached button cannot reset the anchor to the origin");
    toolbar.replaceChildren(target);
    target.style.display = "";
    target.style.left = "760px";
    target.style.top = "300px";
    window.dispatchEvent(new Event("resize"));
    rect = menu.getBoundingClientRect();
    check.equal(rect.right, target.getBoundingClientRect().right);
    check.equal(rect.top, target.getBoundingClientRect().bottom);
    context.menuElement.style.height = "600px";
    window.dispatchEvent(new Event("resize"));
    rect = menu.getBoundingClientRect();
    check.ok(rect.top >= 42 && rect.bottom <= window.innerHeight, "growing conditions remain inside the viewport");
    document.querySelector(".av__panel").remove();
    toolbar.remove();
    style.remove();
    return "Backlink database filter positioning passed";
};

test("backlink database filters stay anchored during source refresh, field loading and window resizing", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = ["../../util/setPosition.ts", "../../protyle/render/av/openMenuPanel.ts", "backlinkDatabaseFilter.ts", "BacklinkContent.ts"].map(file =>
        transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    const css = compileString('@use "component/menu"; @use "business/av";', {
        loadPaths: [path.join(__dirname, "../../assets/scss")], logger: {warn: () => {}},
    }).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-backlink-filter-position-"));
    const script = path.join(temporary, "run.cjs");
    const expression = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1800, height: 760,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));
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
        assert.match(result.stdout, /Backlink database filter positioning passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-backlink-filter-position-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
