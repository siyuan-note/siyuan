import * as assert from "node:assert/strict";
import {join} from "node:path";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";
import * as cellValue from "./cellValue";
import {DOMFixture} from "./testDOM";

test("panel binding searches the primary text and anchors to the original field", () => {
    const requests: unknown[][] = [];
    let selected: HTMLElement;
    const range = {selectNodeContents: (element: HTMLElement) => { selected = element; }};
    const protyle = {options: {}, toolbar: {}} as IProtyle;
    const dom = new DOMFixture();
    const value = encodeURIComponent(JSON.stringify({type: "block", block: {content: "  Current title  "}}));
    dom.body.innerHTML = `<div data-row-id="item" data-cell-value="${value}">
        <div class="av__celltext"><strong>Rendered preview</strong></div>
    </div>`;
    const field = dom.body.firstElementChild as unknown as HTMLElement;
    const exports = loadModule<typeof import("./bindBlock")>(join(__dirname, "bindBlock.ts"), {
        require: (id: string) => id === "./cellValue" ? cellValue : {hintRef: (...args: unknown[]) => requests.push(args)},
        document: {createRange: () => range},
        window: {siyuan: {menus: {menu: {remove() {}}}}},
    }, ScriptTarget.ES2020);
    exports.openAVBindBlock(protyle, field);
    assert.equal(selected, field);
    assert.equal(protyle.toolbar.range, range);
    assert.deepEqual(requests, [["Current title", protyle, "av"]]);
    exports.openAVBindBlock(protyle, field, "Hidden primary");
    assert.deepEqual(requests[1], ["Hidden primary", protyle, "av"]);
    field.dataset.cellValue = encodeURIComponent(JSON.stringify({type: "block", block: {content: ""}}));
    exports.openAVBindBlock(protyle, field);
    assert.deepEqual(requests[2], ["", protyle, "av"]);
    protyle.disabled = true;
    exports.openAVBindBlock(protyle, field);
    protyle.disabled = false;
    protyle.options.history = {snapshot: "snapshot"} as IProtyle["options"]["history"];
    exports.openAVBindBlock(protyle, field);
    assert.equal(requests.length, 3);
});
