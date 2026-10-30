import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: string[], css: string) => {
    const check: typeof assert = require("node:assert/strict");
    let sequence = 0;
    let componentDestroyed = 0;
    let message = "";
    let menuClosed = 0;
    let move: () => void;
    const components: {editors: {resize: () => void, flushPendingTransactions: () => Promise<void>,
        protyle: {notebookId: string, block: {rootID: string}}}[], blockId: string, rootId: string,
        notebookId: string, surface: string, onlyBacklinks: boolean}[] = [];
    const position = {} as typeof import("./panelPosition");
    new Function("exports", "require", sources[1])(position, () => ({
        getTopBarHeight: () => 32,
        setPosition: (element: HTMLElement, x: number, y: number) => {
            element.style.left = Math.min(x, innerWidth - element.offsetWidth - 8) + "px";
            element.style.top = y + "px";
        },
    }));
    const removal = {} as typeof import("./panelRemoval");
    new Function("exports", sources[2])(removal);
    const exports = {} as typeof import("./Panel");
    new Function("exports", "require", sources[0])(exports, () => ({
        ...position, ...removal,
        hasClosestByClassName: (element: Element, name: string) => element?.closest("." + name),
        genUUID: () => String(++sequence), registerBlockPanelOwner() {}, updateHotkeyAfterTip: () => "",
        moveResize: (_element: HTMLElement, callback: () => void) => { move = callback; },
        showMessage: (value: string) => { message = value; },
        BacklinkContent: class {
            editors: typeof components[number]["editors"] = [];
            constructor(options: {element: HTMLElement}) {
                Object.assign(this, options);
                options.element.classList.add("fn__flex-column");
                options.element.innerHTML = '<div class="block__icons backlinkList__header">' +
                    '<button class="block__icon" data-type="search">Search</button></div>' +
                    '<div class="backlinkList fn__flex-1"><div style="height:2000px">Source context</div></div>' +
                    '<div class="backlinkMList__header">Mentions</div><div class="backlinkMList"></div>';
                components.push(this as unknown as typeof components[number]);
            }
            destroy() { componentDestroyed++; this.editors = []; }
        },
    }));
    window.siyuan = {blockPanels: [], zIndex: 0, languages: {},
        config: {keymap: {general: {closeTab: {custom: ""}}}},
        menus: {menu: {element: document.createElement("div"), remove: () => { menuClosed++; }}},
    } as unknown as typeof window.siyuan;
    const style = document.createElement("style");
    style.textContent = css + `
body {margin:0} .fn__flex-column {display:flex;flex-direction:column} .fn__flex-1 {flex:1;min-height:0}
.backlinkList {overflow:auto} .block__popover {transition:none} .block__icon {opacity:1}
`;
    document.head.append(style);
    const anchor = document.createElement("span");
    anchor.style.cssText = "position:absolute;top:40px;right:8px";
    document.body.append(anchor);
    const create = () => {
        const panel = new exports.BlockPanel({app: {} as never, targetElement: anchor,
            refDefs: [{refID: "heading"}], isBacklink: true,
            backlink: {blockId: "heading", rootId: "document", notebookId: "encrypted"}});
        window.siyuan.blockPanels.push(panel);
        return panel;
    };
    let panel = create();
    check.equal(panel.backlink.blockId, "heading");
    check.equal(panel.backlink.rootId, "document");
    check.equal(panel.backlink.notebookId, "encrypted");
    check.equal(components[0].surface, "popover");
    check.equal(components[0].onlyBacklinks, true);
    const content = panel.element.querySelector(".block__content");
    const list = panel.element.querySelector<HTMLElement>(".backlinkList");
    const rect = panel.element.getBoundingClientRect();
    check.ok(rect.left >= 0 && rect.right <= innerWidth, "the popover fits beside a right-hand document");
    check.ok(rect.bottom <= innerHeight, "the popover fits below a reference count");
    check.equal(getComputedStyle(content).overflow, "hidden");
    check.equal(getComputedStyle(panel.element.querySelector(".backlinkMList__header")).display, "none");
    check.ok(list.scrollHeight > list.clientHeight, "long contexts share the list viewport");
    list.scrollTop = 300;
    check.equal(list.scrollTop, 300);
    const click = new MouseEvent("click", {bubbles: true, cancelable: true});
    panel.element.querySelector('[data-type="search"]').dispatchEvent(click);
    check.equal(click.defaultPrevented, false, "the outer shell does not consume component toolbar actions");
    panel.element.querySelector(".backlinkList__header").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(panel.element.dataset.pin, "false", "inner toolbars do not toggle the outer pin");
    move();
    check.equal(panel.element.dataset.pin, "true", "moving or resizing pins the outer shell");

    let finish: () => void;
    components[0].editors = [{resize() {}, flushPendingTransactions: () => new Promise(resolve => { finish = resolve; }),
        protyle: {notebookId: "encrypted", block: {rootID: "source"}}}];
    check.equal(panel.editors, components[0].editors, "editor discovery follows component array replacements");
    panel.destroy();
    check.equal(panel.element.hasAttribute("inert"), true);
    check.equal(componentDestroyed, 0, "pending input is flushed before component teardown");
    window.siyuan.menus.menu.element.dataset.from = "1popover";
    window.siyuan.menus.menu.element.style.zIndex = "100";
    finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    check.equal(componentDestroyed, 1);
    check.equal(window.siyuan.blockPanels.length, 0);
    check.equal(menuClosed, 0, "a menu opened while saving belongs to the new interaction");
    delete window.siyuan.menus.menu.element.dataset.from;

    panel = create();
    components[1].editors = [{resize() {}, flushPendingTransactions: async () => { throw new Error("Save failed"); },
        protyle: {notebookId: "encrypted", block: {rootID: "source"}}}];
    panel.destroy();
    await new Promise(resolve => setTimeout(resolve, 0));
    check.equal(message, "Save failed");
    check.equal(panel.element.hasAttribute("inert"), false, "a failed save keeps the content available");
    panel.removeEditors({notebookId: "encrypted", rootIDs: new Set()});
    check.equal(panel.element, undefined, "locking the target notebook closes the popover immediately");

    panel = create();
    panel.removeEditors({rootIDs: new Set(["document"])});
    check.equal(panel.element, undefined, "removing the target document closes the popover before context loads");
    panel = create();
    const source = document.createElement("div");
    source.dataset.notebookId = "source-notebook";
    panel.element.append(source);
    panel.removeEditors({notebookId: "unrelated", rootIDs: new Set()});
    check.ok(panel.element);
    panel.removeEditors({notebookId: "source-notebook", rootIDs: new Set()});
    check.equal(panel.element, undefined, "locking a loaded source notebook clears its content");
    return "Backlink popover lifecycle cases passed";
};

test("backlink popovers reuse the panel in a bounded shell and preserve pending edits and notebook isolation", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const parse = require("ifdef-loader/preprocessor").parse;
    const sources = ["src/block/Panel.ts", "src/block/panelPosition.ts", "src/block/panelRemoval.ts"].map(file =>
        transpileModule(parse(readFileSync(file, "utf8"), {MOBILE: false, BROWSER: true}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    const css = compileString(readFileSync("src/assets/scss/business/_block.scss", "utf8")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-backlink-popover-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:800, height:600,
        webPreferences:{nodeIntegration:true, contextIsolation:false, offscreen:true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
            browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + ")")}));
        win.destroy(); app.exit(0);
    } catch (error) {
        console.error(error); win.destroy(); app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Backlink popover lifecycle cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-backlink-popover-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
