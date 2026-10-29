import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IAVPanelAction, IAVPanelContext} from "./types";

const setup = (current = false) => {
    const locateRequests = new WeakMap();
    const attributes = new Map<string, string>();
    const block = {setAttribute: (name: string, value: string) => attributes.set(name, value)} as unknown as HTMLElement;
    const selected = new Set(current ? ["b3-menu__item--current"] : []);
    const oldClasses = new Set(["b3-menu__item--current"]);
    const operations: IOperation[][] = [];
    let menuRemoved = 0;
    let opened = 0;
    let prevented = 0;
    let stopped = 0;
    const exports = {} as typeof import("./switcher");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/panels/switcher.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports,
        require: (id: string) => ({
            "../locateState": {locateRequests},
            "../../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "view"}},
            "../../../util/clear": {clearSelect() {}},
            "../view": {openViewMenu: () => { opened++; }},
            "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, forward: IOperation[], backward: IOperation[]) => {
                assert.equal(locateRequests.has(block), false, "Cancel before the view transaction can continue the pending locate");
                operations.push(forward, backward);
            }},
        }[id] || {}),
        window: {siyuan: {menus: {menu: {remove: () => { menuRemoved++; }}}}},
    });
    const context = {options: {blockElement: block, protyle: {}}, data: {viewID: "first"}, blockID: "carrier", avID: "db",
        avPanelElement: {querySelector: () => ({classList: {remove: (name: string) => oldClasses.delete(name)}}),
            remove: () => assert.fail("The switcher panel must keep its existing lifetime")}} as unknown as IAVPanelContext;
    const action = {target: {parentElement: {dataset: {id: "second"}, classList: {
        contains: (name: string) => selected.has(name), add: (name: string) => selected.add(name),
    }}}, event: {preventDefault: () => { prevented++; }, stopPropagation: () => { stopped++; }}} as unknown as IAVPanelAction;
    locateRequests.set(block, {itemID: "deep-child", viewID: "second", previousViewID: "first"});
    return {panel: exports.switcherPanel, context, action, locateRequests, block, attributes, operations, selected, oldClasses,
        effects: () => ({menuRemoved, opened, prevented, stopped})};
};

for (const type of ["av-view-switch", "av-view-edit"]) {
    test(`${type} mouse switching cancels a matching pending locate and preserves panel behavior`, () => {
        const h = setup();
        assert.equal(h.panel.actions[type](h.context, {...h.action, type}), "handled");
        assert.equal(h.locateRequests.has(h.block), false);
        assert.equal(h.context.data.viewID, "second");
        assert.equal(h.attributes.get("view"), "second");
        assert.equal(h.operations[0][0].id, "second");
        assert.equal(h.operations[1][0].id, "first");
        assert.equal(h.selected.has("b3-menu__item--current"), true);
        assert.equal(h.oldClasses.has("b3-menu__item--current"), false);
        assert.deepEqual(h.effects(), {menuRemoved: type === "av-view-edit" ? 1 : 0,
            opened: type === "av-view-edit" ? 1 : 0, prevented: 1, stopped: 1});
    });
}

test("editing the already selected view keeps its pending locate and opens only the view menu", () => {
    const h = setup(true);
    h.panel.actions["av-view-edit"](h.context, {...h.action, type: "av-view-edit"});
    assert.equal(h.locateRequests.has(h.block), true);
    assert.equal(h.operations.length, 0);
    assert.deepEqual(h.effects(), {menuRemoved: 0, opened: 1, prevented: 1, stopped: 1});
});
