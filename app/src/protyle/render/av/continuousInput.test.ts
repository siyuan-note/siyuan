import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../../testSupport/loadModule";
import {DOMFixture} from "./testDOM";

const fixture = () => {
    const dom = new DOMFixture();
    dom.body.innerHTML = `<div class="protyle"><div class="av" data-av-id="database" data-av-type="table">
<div class="av__body" data-group-id="group"><div class="av__row" data-id="first"><div class="av__cell" data-col-id="column" data-dtype="text"></div></div>
<div class="av__row" data-id="second"><div class="av__cell" data-col-id="column" data-dtype="text"></div></div></div></div></div>`;
    const owner = dom.body.firstElementChild;
    const block = owner.firstElementChild;
    const group = block.firstElementChild;
    const first = group.firstElementChild.firstElementChild;
    const second = group.lastElementChild.firstElementChild;
    const opened: unknown[] = [];
    const selected: unknown[] = [];
    const config = {readonly: false};
    const protyle = {element: owner, wysiwyg: {element: owner}, disabled: false, options: {}};
    const data = {viewID: "view"};
    const column = {hidden: false, type: "text"};
    let removed = false;
    let next = group.lastElementChild;
    const document = {body: dom.body, activeElement: dom.body, querySelector: (): unknown => null};
    const methods = loadModule<typeof import("./continuousInput")>("src/protyle/render/av/continuousInput.ts", {
        window: {siyuan: {config}}, document,
        require: (name: string) => ({
            "./viewType": {isTableLikeView: (type: string) => type === "table" || type === "list"},
            "./virtualScroll": {getAVData: () => data, ensureAVTableAdjacentRow: () => next, ensureAVTableRow() {}},
            "./columnWindow": {ensureAVColumnWindow() {}},
            "./selectionState": {resolveAVSelectedCell: (_data: unknown, point: {rowID: string}) =>
                !removed && point.rowID === "second" ? {column} : undefined},
            "./rangeSelect": {setAVCellAnchor: (_block: unknown, cell: unknown) => {selected.push(cell); return true;}},
        })[name],
    });
    const prepare = (cells = [first]) => methods.prepareAVContinuousInput(protyle as unknown as IProtyle,
        block as unknown as HTMLElement, cells as unknown as HTMLElement[], cell => opened.push(cell));
    return {dom, block, group, first, second, opened, selected, config, protyle, data, column, document, methods, prepare,
        removeTarget: () => {removed = true;}, end: () => {next = null;}};
};

test("continuous input follows the captured row and column after redraw rather than a changed neighbor", () => {
    for (const type of ["table", "list"]) {
        const f = fixture();
        f.block.dataset.avType = type;
        const proceed = f.prepare();
        f.group.innerHTML = `<div class="av__row" data-id="another"><div class="av__cell" data-col-id="column"></div></div>
<div class="av__row" data-id="second"><div class="av__cell" data-col-id="column"></div></div>`;
        proceed();
        assert.equal(f.opened[0], f.group.lastElementChild.firstElementChild);
        assert.deepEqual(f.selected, f.opened);
    }
});

test("continuous input excludes batch, details, readonly, bound primary fields and non-table views", () => {
    for (const state of ["batch", "readonly", "disabled", "gallery", "details", "boundPrimary"]) {
        const f = fixture();
        if (state === "readonly") f.config.readonly = true;
        if (state === "disabled") f.protyle.disabled = true;
        if (state === "gallery") f.block.dataset.avType = "gallery";
        if (state === "details") f.block.classList.add("custom-attr");
        if (state === "boundPrimary") f.first.dataset.dtype = "block";
        assert.equal(f.prepare(state === "batch" ? [f.first, f.second] : [f.first]), undefined, state);
    }
});

test("last-row confirmation stops without creating a row or moving to another group", () => {
    const f = fixture();
    f.end();
    const proceed = f.prepare();
    assert.equal(typeof proceed, "function");
    proceed();
    assert.deepEqual(f.opened, []);
});

test("delayed confirmation cannot move into a deleted, hidden, changed or disconnected target", () => {
    for (const state of ["removed", "hidden", "type", "view", "locked", "closed", "otherFocus", "otherEditor"]) {
        const f = fixture();
        const proceed = f.prepare();
        if (state === "removed") f.removeTarget();
        if (state === "hidden") f.column.hidden = true;
        if (state === "type") f.column.type = "number";
        if (state === "view") f.data.viewID = "another-view";
        if (state === "locked") f.config.readonly = true;
        if (state === "closed") f.block.remove();
        if (state === "otherFocus") f.document.activeElement = f.dom.createElement("input");
        if (state === "otherEditor") f.document.querySelector = () => ({});
        proceed();
        assert.deepEqual(f.opened, [], state);
    }
});

test("continuous confirmation leaves composition, modified Enter and held keys to their existing handlers", () => {
    const {methods} = fixture();
    const event = {key: "Enter", isComposing: false, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false};
    assert.equal(methods.isAVContinuousInputKey(event as KeyboardEvent), true);
    for (const key of ["isComposing", "repeat", "shiftKey", "ctrlKey", "metaKey", "altKey"]) {
        assert.equal(methods.isAVContinuousInputKey({...event, [key]: true} as KeyboardEvent), false, key);
    }
});
