const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

test("starting a tab drag dismisses its menu and preserves the document transfer", () => {
    const source = readFileSync(path.join(__dirname, "../src/layout/Tab.ts"), "utf8");
    const start = source.indexOf('            this.headElement.addEventListener("dragstart"');
    const end = source.indexOf('            this.headElement.addEventListener("dragend"', start);
    assert.ok(start >= 0 && end > start);
    let handler;
    let menuOpen = true;
    let tooltipVisible = true;
    const header = {
        outerHTML: "<li>Document</li>", dataset: {}, style: {},
        classList: {contains: name => name === "item--focus"},
        addEventListener: (type, callback) => {
            assert.equal(type, "dragstart");
            handler = callback;
        },
    };
    const tab = {id: "tab", title: "Document", headElement: header};
    const constants = {
        SIYUAN_DROP_TAB: "tab", SIYUAN_DROP_DOCUMENT_TAB: "document",
        SIYUAN_SEND_WINDOWS: "windows",
    };
    const state = {menus: {menu: {remove: () => { menuOpen = false; }}}};
    const ipc = [];
    const code = ts.transpileModule(source.slice(start, end), {
        compilerOptions: {target: ts.ScriptTarget.ES2020},
    }).outputText;
    new Function("window", "hideTooltip", "hasClosestByTag", "layoutToJSON", "Constants", "ipcRenderer", code)
        .call(tab, {siyuan: state, getSelection: () => ({removeAllRanges() {}})},
            () => { tooltipVisible = false; }, () => header,
            (_tab, json) => { json.children = {instance: "Editor", rootId: "document-id"}; },
            constants, {send: (...args) => ipc.push(args)});
    const transfer = new Map();
    const dataTransfer = {setData: (type, value) => transfer.set(type, value)};
    handler({target: header, dataTransfer});
    assert.equal(menuOpen, false);
    assert.equal(tooltipVisible, false);
    assert.equal(dataTransfer.dropEffect, "move");
    assert.equal(header.style.opacity, "0.38");
    assert.equal(state.dragElement, header);
    assert.deepEqual(JSON.parse(transfer.get("document")), {
        rootId: "document-id", tabId: "tab", title: "Document",
    });
    assert.equal(JSON.parse(transfer.get("tab")).children.rootId, "document-id");
    assert.ok(ipc.some(([, message]) => message.cmd === "setTabDragData"));
});
