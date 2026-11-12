import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getEmojiPanelResizeAction} from "./panel";

const text = readFileSync("src/emoji/index.ts", "utf8");
const source = transpileModule(text.slice(text.indexOf("export class EmojiPanelController"),
    text.indexOf("export const moveEmojiSelection")), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    let callback: (entries: {target: unknown}[]) => void;
    let probes = 0;
    let removals = 0;
    let offsets = 0;
    let visible = 0;
    let selections = 0;
    let renders = 0;
    const item = {offsetWidth: 32, offsetHeight: 32};
    const panel = {clientWidth: 340, addEventListener() {}, append() { probes++; }};
    const content = {firstElementChild: item, get clientWidth() { return panel.clientWidth; }};
    const api: any = {};
    runInNewContext(source, {
        exports: api, getEmojiPanelResizeAction, genEmojiButton: () => "",
        ResizeObserver: class {
            constructor(next: typeof callback) { callback = next; }
            observe() {}
        },
        document: {createElement: () => ({style: {}, querySelector: () => content, remove() { removals++; }})},
        getComputedStyle: () => ({marginLeft: "1", marginRight: "1", marginTop: "1", marginBottom: "1",
            columnGap: "0", rowGap: "0", paddingLeft: "0", paddingRight: "0"}),
    });
    const controller = new api.EmojiPanelController(panel, {}, {});
    controller.pageMode = "common";
    controller.columnCount = controller.getColumnCount();
    controller.measuredItem = item;
    controller.updateCategoryOffsets = () => { offsets++; };
    controller.updateBuiltInChunkOffsets = () => { offsets++; };
    controller.renderVisibleBuiltInChunks = () => { visible++; };
    controller.ensureCurrentSelection = () => { selections++; };
    controller.renderCommonPage = () => { renders++; };
    controller.renderCustomPage = () => { renders++; };
    return {panel, item, controller, resize: (target: unknown = panel) => callback([{target}]),
        counts: () => ({probes, removals, offsets, visible, selections, renders})};
};

test("height-only emoji resize refreshes visibility without measurement nodes or offset scans", () => {
    const s = setup();
    for (let i = 0; i < 100; i++) s.resize();
    assert.deepEqual(s.counts(), {probes: 1, removals: 1, offsets: 0, visible: 100, selections: 100, renders: 0});
});

test("width changes still measure columns and rebuild emoji rows", () => {
    const s = setup();
    s.panel.clientWidth = 272;
    s.resize();
    assert.equal(s.counts().probes, 2);
    assert.equal(s.counts().renders, 1);
});

test("measured emoji size changes still measure and rebuild at the same panel width", () => {
    const s = setup();
    s.item.offsetHeight = 40;
    s.resize(s.item);
    assert.equal(s.counts().probes, 2);
    assert.equal(s.counts().renders, 1);
});

test("same-column width changes refresh offsets but later height changes do not", () => {
    const s = setup();
    s.panel.clientWidth = 343;
    s.resize();
    assert.equal(s.counts().offsets, 2);
    s.resize();
    assert.equal(s.counts().probes, 2);
    assert.equal(s.counts().offsets, 2);
});

test("hidden, inactive and search panels keep their existing no-work resize behavior", () => {
    const s = setup();
    s.panel.clientWidth = 0;
    s.resize();
    s.panel.clientWidth = 340;
    s.controller.active = false;
    s.resize();
    s.controller.active = true;
    s.controller.pageMode = "search";
    s.resize();
    assert.equal(s.counts().probes, 1);
    assert.equal(s.counts().visible, 0);
});

test("hidden panel becoming visible refreshes its geometry at the original width", () => {
    const s = setup();
    s.panel.clientWidth = 0;
    s.resize();
    s.panel.clientWidth = 340;
    s.resize();
    assert.equal(s.counts().probes, 2);
    assert.equal(s.counts().offsets, 2);
});

test("initial measured-item notification is not mistaken for height-only resize", () => {
    const s = setup();
    s.resize(s.item);
    assert.equal(s.counts().probes, 2);
    assert.equal(s.counts().offsets, 2);
    s.resize();
    assert.equal(s.counts().probes, 2);
});
