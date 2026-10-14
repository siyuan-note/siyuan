const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "../src/asset/pdf/text_layer_builder.js"), "utf8");
const parsed = ts.createSourceFile("text_layer_builder.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const builder = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "TextLayerBuilder");
assert.ok(builder);
const listener = builder.members.find(node => node.name?.getText(parsed) === "#enableGlobalSelectionListener");
assert.ok(listener);

// 驱动真实监听器的 DOM 协议，不把模拟范围当作浏览器原生划选结果。
const fixture = ({version = 154, firefox = false, brands = false} = {}) => {
    const events = new Map();
    const classes = new Set();
    const insertions = [];
    const end = {style: {}, childNodes: []};
    const layer = {
        style: {width: "666px", height: "833px"},
        classList: {add: name => classes.add(name), remove: name => classes.delete(name)},
        closest: selector => selector === ".textLayer" ? layer : null,
        append: node => insertions.push({node, before: null}),
        insertBefore: (node, before) => insertions.push({node, before}),
    };
    const next = {};
    const span = {parentElement: layer, parentNode: layer, nextSibling: next,
        classList: {contains: () => false}, childNodes: [{}]};
    const text = {nodeType: 3, parentNode: span};
    let backward = false;
    let rangeCount = 1;
    const range = {startContainer: text, endContainer: text, startOffset: 0, endOffset: 8,
        intersectsNode: node => node === layer,
        compareBoundaryPoints: () => backward ? 0 : 1,
        cloneRange: () => ({})};
    const document = {
        addEventListener: (name, callback) => events.set(name, callback),
        getSelection: () => ({rangeCount, getRangeAt: () => range}),
    };
    const Harness = new Function("document", "window", "getComputedStyle", "Node", "Range", "navigator", `
        return class {
            static #textLayers = new Map();
            static #selectionChangeAC = null;
            ${listener.getText(parsed)}
            static start(layer, end) {
                this.#textLayers.set(layer, end);
                this.#enableGlobalSelectionListener();
            }
        };
    `)(document, {addEventListener: (name, callback) => events.set(name, callback)},
        () => ({getPropertyValue: () => firefox ? "none" : ""}), {TEXT_NODE: 3},
        {END_TO_END: 2, START_TO_END: 1},
        {userAgent: `Mozilla/5.0 Chrome/${version}.0.0.0`,
            userAgentData: brands ? {brands: [{brand: "Chromium", version: String(version)}]} : undefined});
    Harness.start(layer, end);
    return {end, span, next, classes, insertions,
        fire: name => events.get(name)(),
        backward: () => { backward = true; },
        clear: () => { rangeCount = 0; }};
};

for (const version of [147, 148, 154]) {
    for (const brands of [false, true]) {
        test(`Chromium ${version}, brands=${brands}: empty-space selection remains selectable beside the active span`, () => {
            const item = fixture({version, brands});
            item.fire("pointerdown");
            item.fire("selectionchange");
            assert.equal(item.end.style.userSelect, "text");
            assert.equal(item.end.style.width, "666px");
            assert.equal(item.end.style.height, "833px");
            assert.equal(item.insertions.at(-1).before, item.next);
            assert.ok(item.classes.has("selecting"));
            item.fire("pointerup");
            assert.equal(item.end.style.width, "");
            assert.equal(item.end.style.height, "");
            assert.equal(item.insertions.at(-1).before, null);
            assert.ok(!item.classes.has("selecting"));
        });
    }
}

test("reverse PDF selection positions the empty-space sentinel before the active span", () => {
    const item = fixture();
    item.fire("selectionchange");
    item.backward();
    item.fire("selectionchange");
    assert.equal(item.insertions.at(-1)?.before, item.span);
});

test("clearing PDF selection resets the sentinel and selecting class", () => {
    const item = fixture();
    item.fire("selectionchange");
    item.clear();
    item.fire("selectionchange");
    assert.equal(item.insertions.at(-1).before, null);
    assert.ok(!item.classes.has("selecting"));
});

test("Firefox retains its native empty-space selection handling", () => {
    const item = fixture({firefox: true});
    item.fire("selectionchange");
    assert.equal(item.insertions.length, 0);
    assert.equal(item.end.style.userSelect, undefined);
});
