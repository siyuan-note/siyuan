import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("sidebar opening restores the active dock, falls back to visible docks and ignores empty sides", () => {
    const tab = (type: string, active: boolean, hidden = false) => ({
        dataset: {type: `sidebar-${type}-tab`},
        classList: {contains: (name: string) => name === "fn__none" ? hidden : active},
    });
    let tabs = [tab("file", false), tab("bookmark", true)];
    const rendered: string[] = [];
    const toolbar = {querySelectorAll: () => tabs, dispatchEvent: (event: {detail: string}) => rendered.push(event.detail)};
    const style = () => ({transform: "", zIndex: "", removeProperty() { this.transform = ""; }});
    const left = {style: style(), querySelector: () => toolbar};
    const right = {style: style()};
    const mask = {style: {zIndex: "", opacity: ""}};
    let closed = 0;
    let blurred = 0;
    let cellEditorsClosed = 0;
    const moduleExports: {
        openSidebar?: (side: string) => void;
        popSidebar?: (side: string) => void;
    } = {};
    const source = readFileSync(resolve(process.cwd(), "src/mobile/util/sidebar.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    runInNewContext(code, {
        exports: moduleExports,
        document: {getElementById: (id: string) => id === "sidebar" ? left : right},
        window: {siyuan: {zIndex: 10}},
        CustomEvent: class {
            detail: string;
            constructor(_type: string, options: {detail: string}) { this.detail = options.detail; }
        },
        require: (name: string) => {
            if (name === "./keyboardToolbar") {
                return {activeBlur: () => blurred++};
            }
            if (name === "../../protyle/render/av/cellEditor") {
                return {closeAVCellEditor: () => cellEditorsClosed++};
            }
            return {closePanel: () => closed++, showPanelMask: () => mask};
        },
    });
    right.style.transform = "translateX(0px)";
    moduleExports.openSidebar("left");
    assert.deepEqual(rendered, ["bookmark"]);
    assert.equal(left.style.transform, "translateX(0px)");
    assert.equal(right.style.transform, "");
    assert.ok(Number(left.style.zIndex) > Number(mask.style.zIndex));
    assert.equal(mask.style.opacity, "1");
    tabs = [tab("file", false), tab("bookmark", true, true)];
    moduleExports.openSidebar("left");
    assert.deepEqual(rendered, ["bookmark", "file"]);
    tabs = [tab("file", true, true)];
    moduleExports.openSidebar("left");
    assert.equal(closed, 2);
    assert.equal(blurred, 2);
    assert.equal(cellEditorsClosed, 2);
    assert.equal(rendered.length, 2);

    tabs = [tab("tag", false, true), tab("bookmark", false), tab("file", true)];
    moduleExports.popSidebar("left");
    assert.equal(rendered.at(-1), "file");
    const plugin = tab("plugin-custom", true);
    Object.assign(plugin.dataset, {mobilePluginDockTab: "custom-plugin-tab"});
    tabs = [tab("file", false), plugin];
    moduleExports.popSidebar("left");
    assert.equal(rendered.at(-1), "custom-plugin-tab");
    tabs = [tab("file", false), tab("bookmark", false)];
    moduleExports.popSidebar("left");
    assert.equal(rendered.at(-1), "file");
    tabs = [];
    moduleExports.popSidebar("left");
    assert.equal(rendered.length, 5);
    assert.equal(left.style.transform, "");
});
