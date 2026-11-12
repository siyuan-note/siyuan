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
    const api = new Function("transaction", "hasClosestByAttribute", "escapeHtml", "getColIconByType", "setPosition", source +
        "\nreturn {bindAVPanelDrag, getPropertiesHTML};")(
        (_protyle: IProtyle, forward: IOperation[], undo: IOperation[]) => operations.push([forward, undo]),
        (element: Element, name: string, value: string) => element?.closest(`[${name}="${value}"]`),
        (value: string) => value, () => "icon", () => {}) as typeof import("./drag") & typeof import("./properties");
    const fixture = (hidden = ["C", "D"], order = ["A", "B", "C", "D"], viewType: TAVView = "table") => {
        document.body.innerHTML = "";
        operations.length = 0;
        const panel = document.createElement("div");
        const menu = document.createElement("div");
        panel.append(menu);
        document.body.append(panel);
        const fields = order.map(id => ({id, name: id, type: id === "A" ? "block" : "text", hidden: hidden.includes(id)})) as IAVColumn[];
        const render = () => { menu.innerHTML = api.getPropertiesHTML(fields, viewType); };
        render();
        const protyle = {disabled: false} as IProtyle;
        api.bindAVPanelDrag({options: {type: "properties", protyle}, avPanelElement: panel, menuElement: menu,
            fields, data: {viewID: "view", viewType}, avID: "database", blockID: "block",
            tabRect: {right: 300, bottom: 40, height: 20}} as unknown as Parameters<typeof api.bindAVPanelDrag>[0]);
        const row = (id: string) => menu.querySelector<HTMLElement>(`[data-type="editCol"][data-id="${id}"]`);
        const section = (name: string) => menu.querySelector<HTMLElement>(`[data-av-field-section="${name}"]`);
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
                check.equal(operation.viewID, "view");
                const field = fields.find(item => item.id === operation.id);
                if (operation.action === "setAttrViewColHidden") {
                    field.hidden = operation.data;
                } else if (operation.action === "sortAttrViewCol") {
                    fields.splice(fields.indexOf(field), 1);
                    fields.splice(operation.previousID ? fields.findIndex(item => item.id === operation.previousID) + 1 : 0, 0, field);
                }
            });
            render();
        };
        return {row, section, send, drag, apply, protyle, fields, panel,
            visible: () => fields.filter(field => !field.hidden).map(field => field.id),
            order: () => fields.map(field => field.id)};
    };
    for (const bottom of [false, true]) {
        const f = fixture();
        f.drag("D", f.row("B"), bottom);
        check.deepEqual(f.visible(), bottom ? ["A", "B", "D"] : ["A", "D", "B"]);
        check.ok(f.row("D").querySelector('[data-type="hideCol"]'));
        check.equal(operations.length, 1);
        const [forward, undo] = operations[0];
        check.equal(forward.length, 2, "order and visibility share one undo step");
        f.apply(undo);
        check.deepEqual(f.order(), ["A", "B", "C", "D"]);
        check.deepEqual(f.visible(), ["A", "B"]);
        f.apply(forward);
        check.deepEqual(f.visible(), bottom ? ["A", "B", "D"] : ["A", "D", "B"]);
    }
    {
        const f = fixture(["C", "D"], ["A", "C", "B", "D"]);
        f.drag("D", f.row("B"));
        check.equal(operations[0][0][0].previousID, "C", "use full order across visibility sections");
        check.equal(operations[0][1][0].previousID, "B");
        check.deepEqual(f.order(), ["A", "C", "D", "B"]);
        f.apply(operations[0][1]);
        check.deepEqual(f.order(), ["A", "C", "B", "D"]);
    }
    {
        const f = fixture();
        f.drag("C", f.row("B"), true);
        check.equal(operations[0][0].length, 1, "visibility changes when order stays the same");
        check.equal(operations[0][0][0].action, "setAttrViewColHidden");
        check.deepEqual(f.visible(), ["A", "B", "C"]);
    }
    {
        const f = fixture();
        f.drag("B", f.row("D"), true);
        check.deepEqual(f.visible(), ["A"]);
        check.ok(f.row("B").querySelector('[data-type="showCol"]'));
        f.apply(operations[0][1]);
        check.deepEqual(f.order(), ["A", "B", "C", "D"]);
        check.deepEqual(f.visible(), ["A", "B"]);
    }
    for (const section of ["visible", "hidden"]) {
        const f = fixture(section === "visible" ? ["A", "B"] : [], ["A", "B"], "gallery");
        check.ok(f.section(section), "empty sections remain drop targets");
        f.drag("B", f.section(section));
        check.deepEqual(f.visible(), section === "visible" ? ["B"] : ["A"]);
    }
    for (const view of ["table", "list", "calendar", "gallery", "kanban"] as TAVView[]) {
        const f = fixture(undefined, undefined, view);
        f.drag("A", f.section("hidden"));
        check.equal(f.fields.find(field => field.id === "A").hidden, view === "gallery" || view === "kanban");
        if (view !== "gallery" && view !== "kanban") check.equal(operations.length, 0);
    }
    for (const [id, target, expected] of [["B", "A", ["B", "A", "C", "D"]], ["D", "C", ["A", "B", "D", "C"]]] as const) {
        const f = fixture();
        f.drag(id, f.row(target));
        check.deepEqual(f.order(), expected);
        check.equal(operations[0][0].length, 1, "same-section reorder preserves visibility");
        f.apply(operations[0][1]);
        check.deepEqual(f.order(), ["A", "B", "C", "D"]);
    }
    for (const cancelled of ["dragend", "self", "readonly", "foreign"]) {
        const f = fixture();
        let source = f.row("C");
        if (cancelled === "foreign") {
            source = source.cloneNode(true) as HTMLElement;
            f.panel.append(source);
        }
        f.send("dragstart", source);
        f.send("dragover", f.row("A"));
        if (cancelled === "readonly") f.protyle.disabled = true;
        if (cancelled === "self") f.send("dragover", source);
        f.send(cancelled === "dragend" ? "dragend" : "drop", source);
        check.equal(operations.length, 0, cancelled);
        check.deepEqual(f.visible(), ["A", "B"]);
        check.equal(window.siyuan.dragElement, undefined);
    }
    return "Field drag cases passed";
};

test("field menu drag updates visibility and order with undo, empty sections and primary-field guards", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = ["drag.ts", "properties.ts", "../viewType.ts"].map(file =>
        transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2022}}).outputText).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-field-drag-test-"));
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
        assert.match(result.stdout, /Field drag cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-field-drag-test-")) {
            rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    }
});
