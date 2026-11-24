import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const operations: IOperation[][][] = [];
    Object.assign(window, {siyuan: {config: {readonly: false}, languages: new Proxy({}, {get: () => "label"})}});
    const api = new Function("Constants", "transaction", "hasClosestByAttribute", "escapeHtml", "isMobile", source +
        "\nreturn {bindAVPanelDrag, bindSwitcherEvent, getSwitcherHTML, getAVVisibleViewIDs};")(
        {CUSTOM_SY_AV_VISIBLE_VIEWS: "custom-sy-av-visible-views", CUSTOM_SY_AV_VIEW: "custom-sy-av-view"},
        (_protyle: IProtyle, forward: IOperation[], undo: IOperation[]) => operations.push([forward, undo]),
        (element: Element, name: string, value: string) => element?.closest(`[${name}="${value}"]`),
        (value: string) => value, () => true) as typeof import("./drag") & typeof import("../view") & typeof import("../viewVisibility");
    const fixture = (visible = ["A", "B"], order = ["A", "B", "C", "D"]) => {
        document.body.innerHTML = "";
        operations.length = 0;
        const panel = document.createElement("div");
        const menu = document.createElement("div");
        const block = document.createElement("div");
        block.setAttribute("custom-sy-av-visible-views", visible.join(","));
        block.setAttribute("custom-sy-av-view", "A");
        panel.append(menu);
        document.body.append(panel, block);
        const data = {views: order.map(id => ({id, name: id, type: "table"})), viewID: "A"} as IAV;
        let renders = 0;
        const render = () => {
            renders++;
            const keyword = menu.querySelector<HTMLInputElement>("input")?.value || "";
            data.viewID = block.getAttribute("custom-sy-av-view");
            menu.innerHTML = api.getSwitcherHTML(data.views, data.viewID, block);
            menu.querySelector<HTMLInputElement>("input").value = keyword;
        };
        render();
        const protyle = {disabled: false} as IProtyle;
        api.bindAVPanelDrag({options: {type: "switcher", protyle, blockElement: block}, avPanelElement: panel,
            menuElement: menu, data, avID: "database", blockID: "block", rerenderSwitcher: render} as unknown as
        Parameters<typeof api.bindAVPanelDrag>[0]);
        const row = (id: string) => menu.querySelector<HTMLElement>(`[draggable="true"][data-id="${id}"]`);
        const section = (value: string) => menu.querySelector<HTMLElement>(`[data-av-view-section="${value}"]`);
        const transfer = new DataTransfer();
        const send = (type: string, target: Element, bottom = false) => {
            const rect = target.getBoundingClientRect();
            target.dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: transfer,
                clientX: rect.left + 1, clientY: rect.top + rect.height * (bottom ? .9 : .1)}));
        };
        const drag = (id: string, target: HTMLElement, bottom = false) => {
            send("dragstart", row(id));
            send("dragover", target, bottom);
            send("drop", target, bottom);
        };
        const apply = (list: IOperation[]) => {
            list.forEach(operation => {
                if (operation.action === "setAttrViewBlockVisibleViews") {
                    block.setAttribute("custom-sy-av-visible-views", operation.viewIDs.join(","));
                } else if (operation.action === "setAttrViewBlockView") {
                    block.setAttribute("custom-sy-av-view", operation.id);
                } else if (operation.action === "sortAttrViewView") {
                    const view = data.views.find(item => item.id === operation.id);
                    data.views = data.views.filter(item => item !== view);
                    data.views.splice(operation.previousID ? data.views.findIndex(item => item.id === operation.previousID) + 1 : 0, 0, view);
                }
            });
            render();
        };
        return {row, section, send, drag, apply, protyle, data, menu, block,
            visible: () => Array.from(api.getAVVisibleViewIDs(block, data.views)), renders: () => renders};
    };
    for (const bottom of [false, true]) {
        const f = fixture();
        f.menu.querySelector<HTMLInputElement>("input").value = "search";
        f.drag("C", f.row("B"), bottom);
        check.deepEqual(f.visible(), bottom ? ["A", "B", "C"] : ["A", "C", "B"]);
        check.equal(operations.length, 1, "order and visibility share one undo step");
        check.equal(f.row("C").dataset.avViewVisibility, "visible");
        check.equal(f.row("C").querySelector('[data-type="av-view-visibility"] use').getAttribute("xlink:href"), "#iconEyeoff");
        check.equal(f.menu.querySelector<HTMLInputElement>("input").value, "search");
        const [forward, undo] = operations[0];
        f.apply(undo);
        check.deepEqual(f.data.views.map(view => view.id), ["A", "B", "C", "D"]);
        check.deepEqual(f.visible(), ["A", "B"]);
        f.apply(forward);
        check.deepEqual(f.visible(), bottom ? ["A", "B", "C"] : ["A", "C", "B"]);
    }
    {
        const f = fixture(["A", "C"], ["A", "B", "C", "D"]);
        f.drag("D", f.row("C"));
        check.equal(operations[0][0][0].previousID, "B", "sorting uses the complete order across visibility groups");
        check.equal(operations[0][1][0].previousID, "C");
        check.deepEqual(f.visible(), ["A", "D", "C"]);
    }
    {
        const f = fixture();
        f.drag("B", f.row("D"));
        check.deepEqual(f.visible(), ["A"]);
        check.equal(f.row("B").dataset.avViewVisibility, "hidden");
        f.apply(operations[0][1]);
        check.deepEqual(f.visible(), ["A", "B"]);
    }
    {
        const f = fixture();
        f.drag("A", f.row("D"));
        check.deepEqual(f.visible(), ["B"]);
        check.equal(f.data.viewID, "B");
        const [forward, undo] = operations[0];
        f.apply(undo);
        check.deepEqual(f.visible(), ["A", "B"]);
        check.equal(f.data.viewID, "A");
        f.apply(forward);
        check.deepEqual(f.visible(), ["B"]);
        check.equal(f.data.viewID, "B");
    }
    for (const section of ["visible", "hidden"]) {
        const f = fixture();
        f.drag(section === "visible" ? "D" : "B", f.section(section));
        check.deepEqual(f.visible(), section === "visible" ? ["D", "A", "B"] : ["A"]);
    }
    {
        const f = fixture(["A"]);
        f.drag("A", f.row("C"));
        check.deepEqual(f.visible(), ["A"], "the last visible view cannot be hidden");
        check.equal(operations.length, 0);
    }
    {
        const f = fixture();
        f.drag("B", f.row("A"));
        check.deepEqual(f.visible(), ["B", "A"]);
        check.equal(operations[0][0].length, 1, "same-section reorder does not change visibility");
    }
    {
        const f = fixture();
        f.drag("D", f.row("C"));
        check.deepEqual(f.data.views.map(view => view.id), ["A", "B", "D", "C"]);
        check.deepEqual(f.visible(), ["A", "B"]);
        check.equal(operations[0][0].length, 1);
        f.apply(operations[0][1]);
        check.deepEqual(f.data.views.map(view => view.id), ["A", "B", "C", "D"]);
    }
    {
        const f = fixture();
        f.drag("C", f.row("B"), true);
        check.equal(operations[0][0].length, 1, "visibility changes even when the full order is already correct");
        check.equal(operations[0][0][0].action, "setAttrViewBlockVisibleViews");
        check.deepEqual(f.visible(), ["A", "B", "C"]);
    }
    for (const cancelled of ["dragend", "self", "readonly"]) {
        const f = fixture();
        f.send("dragstart", f.row("C"));
        f.send("dragover", f.row("A"));
        if (cancelled === "readonly") f.protyle.disabled = true;
        if (cancelled === "self") f.send("dragover", f.row("C"));
        f.send(cancelled === "dragend" ? "dragend" : "drop", f.row("C"));
        check.equal(operations.length, 0, cancelled);
        check.deepEqual(f.visible(), ["A", "B"]);
        check.equal(window.siyuan.dragElement, undefined);
    }
    {
        const f = fixture();
        f.protyle.disabled = true;
        f.menu.innerHTML = api.getSwitcherHTML(f.data.views, "B", f.block, true);
        const views = Array.from(f.menu.querySelectorAll<HTMLElement>("button[data-id]"));
        check.deepEqual(views.map(view => view.dataset.id), ["A", "B", "C", "D"]);
        check.equal(f.menu.querySelector(".b3-menu__item--current").getAttribute("data-id"), "B");
        check.equal(f.menu.querySelector('[draggable="true"], [data-type="av-add"], [data-type="av-view-edit"], ' +
            '[data-type="av-view-visibility"], [data-type="av-view-hide-all"], [data-type="av-view-show-all"]'), null);
        api.bindSwitcherEvent({protyle: f.protyle, menuElement: f.menu, blockElement: f.block});
        const input = f.menu.querySelector<HTMLInputElement>("input");
        input.value = "C";
        input.dispatchEvent(new Event("input"));
        check.deepEqual(views.filter(view => !view.classList.contains("fn__none")).map(view => view.dataset.id), ["C"]);
        let selected: string;
        f.menu.addEventListener("click", event => {
            selected = (event.target as HTMLElement).closest<HTMLElement>('button[data-type="av-view-switch"]').dataset.id;
        });
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter"}));
        check.equal(selected, "C");
        check.equal(operations.length, 0);
    }
    return "View drag cases passed";
};

test("the view switcher supports drag editing and search with readonly selection", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const files = ["drag.ts", "../viewVisibility.ts", "../view.ts", "../../../../util/upDownHint.ts"];
    const source = files.map(file => transpileModule(readFileSync(path.join(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2022}}).outputText).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-view-drag-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
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
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /View drag cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-view-drag-test-")) {
            rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    }
});
