import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getAVCellShowIcon, updateAVViewShowIcon} from "./entryIcon";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";
import {DOMFixture} from "./testDOM";

test("primary icons and relation or rollup icons use independent per-view settings", () => {
    for (const showIcon of [false, true]) {
        for (const showRelationIcon of [false, true]) {
            const view = {showIcon, showRelationIcon};
            assert.equal(getAVCellShowIcon(view, "block"), showIcon);
            assert.equal(getAVCellShowIcon(view, "relation"), showRelationIcon);
            assert.equal(getAVCellShowIcon(view, "rollup"), showRelationIcon);
        }
        for (const type of ["block", "relation", "rollup"] as const) {
            assert.equal(getAVCellShowIcon({showIcon}, type), showIcon);
            assert.equal(getAVCellShowIcon(undefined, type), true);
        }
    }
});

test("live icon changes update only their scope in every layout and preserve offscreen group state", () => {
    const source = compileModule("src/protyle/render/av/render.ts");
    for (const viewType of ["table", "list", "gallery", "kanban", "calendar"] as const) {
        const fixture = new DOMFixture();
        const root = fixture.createElement("div");
        const block = fixture.createElement("div");
        root.append(block);
        block.setAttribute("data-av-id", "database");
        block.setAttribute("data-view", "view");
        block.classList.add("av");
        block.innerHTML = ["block", "relation", "rollup"].map(type =>
            `<div class="${viewType === "calendar" ? "av__calendar-field" : "av__cell"}" data-dtype="${type}"><span class="b3-menu__avemoji"></span><span class="av__celltext">Value</span></div>`).join("");
        const query = block.querySelectorAll.bind(block);
        block.querySelectorAll = (selector: string) => selector.split(",").flatMap(part => {
            const [parent, child] = part.trim().split(" ");
            return child ? query(parent).flatMap((field: typeof block) => field.querySelectorAll(child)) : query(parent);
        });
        const view: IAVView = {showIcon: true, showRelationIcon: true, groups: [{showIcon: true, showRelationIcon: true, groupFolded: true}]};
        let invalidations = 0;
        const dependencies: Record<string, unknown> = {
            "./entryIcon": {updateAVViewShowIcon},
            "./virtualScroll": {getAVData: () => ({viewType, view}), invalidateAVTableRowHeights: () => invalidations++},
            "./columnWindow": {prepareAVColumnWindow() {}},
            "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "data-view"}},
        };
        const api = evaluateModule<typeof import("./render")>(source, {require: (name: string) => dependencies[name] || {}});
        const protyle = {wysiwyg: {element: root}} as unknown as IProtyle;
        const hidden = (type: string) => block.querySelector(`[data-dtype="${type}"] .b3-menu__avemoji`).classList.contains("fn__none");
        api.refreshAV(protyle, {action: "setAttrViewShowRelationIcon", avID: "database", viewID: "view", data: false});
        assert.equal(hidden("block"), false);
        assert.equal(hidden("relation"), true);
        assert.equal(hidden("rollup"), true);
        api.refreshAV(protyle, {action: "setAttrViewShowIcon", avID: "database", viewID: "view", data: false});
        api.refreshAV(protyle, {action: "setAttrViewShowRelationIcon", avID: "database", viewID: "view", data: true});
        assert.equal(hidden("block"), true);
        assert.equal(hidden("relation"), false);
        assert.equal(hidden("rollup"), false);
        assert.equal(view.groups[0].showIcon, false);
        assert.equal(view.groups[0].showRelationIcon, true);
        assert.equal(invalidations, 3);
    }
});

test("primary toggles preserve legacy relation settings in folded and nested groups", () => {
    for (const previous of [false, true]) {
        const group = {showIcon: previous, groupFolded: true, groups: [{showIcon: previous}]};
        const view = {showIcon: previous, groups: [group]} as IAVView;
        updateAVViewShowIcon(view, !previous);
        for (const item of [view, group, group.groups[0]]) {
            assert.equal(getAVCellShowIcon(item, "block"), !previous);
            assert.equal(getAVCellShowIcon(item, "relation"), previous);
            assert.equal(getAVCellShowIcon(item, "rollup"), previous);
        }
        updateAVViewShowIcon(view, !previous, true);
        updateAVViewShowIcon(view, previous);
        for (const item of [view, group, group.groups[0]]) {
            assert.equal(getAVCellShowIcon(item, "block"), previous);
            assert.equal(getAVCellShowIcon(item, "relation"), !previous);
        }
    }
});
