const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

const setup = (closeTabOnDoubleClick = true) => {
    const source = readFileSync(path.join(__dirname, "../src/layout/Wnd.ts"), "utf8");
    const start = source.indexOf("        let lastClickedTab:");
    const end = source.indexOf("        const tabHeadersElement =", start);
    assert.ok(start >= 0 && end > start);
    const handlers = {};
    const tabs = new Set();
    const removed = [];
    const wnd = {
        headersElement: {
            contains: tab => tabs.has(tab),
            parentElement: {addEventListener: (type, handler) => { handlers[type] = handler; }},
        },
        removeTab: id => {
            removed.push(id);
            tabs.forEach(tab => { if (tab.getAttribute("data-id") === id) { tabs.delete(tab); } });
        },
        switchTab: () => {},
        showHeading: () => {},
    };
    const code = ts.transpileModule(source.slice(start, end), {
        compilerOptions: {target: ts.ScriptTarget.ES2020},
    }).outputText;
    new Function("window", "pdfIsLoading", code).call(wnd, {
        siyuan: {config: {fileTree: {closeTabOnDoubleClick, openFilesUseCurrentTab: true}}},
    }, () => false);
    const tab = id => {
        const item = {
            tagName: "LI", closest: () => item, isEqualNode: other => item === other,
            getAttribute: () => id,
            classList: {contains: () => false, remove: () => { item.pinned = true; }},
        };
        tabs.add(item);
        return item;
    };
    const click = (target, detail) => handlers.click({target, detail, button: 0});
    return {tab, click, handlers, removed};
};

test("continuous clicks close successive tabs in pairs", () => {
    const {tab, click, handlers, removed} = setup();
    const first = tab("first");
    const second = tab("second");
    const third = tab("third");
    click(first, 1);
    click(first, 2);
    handlers.dblclick({target: first});
    click(second, 3);
    assert.deepEqual(removed, ["first"]);
    click(second, 4);
    click(third, 5);
    click(third, 6);
    assert.deepEqual(removed, ["first", "second", "third"]);
});

test("clicks on different tabs and separate single clicks do not close tabs", () => {
    const {tab, click, removed} = setup();
    const first = tab("first");
    const second = tab("second");
    click(first, 1);
    click(second, 2);
    click(second, 1);
    assert.deepEqual(removed, []);
    click(second, 2);
    assert.deepEqual(removed, ["second"]);
});

test("double click still pins preview tabs when closing is disabled", () => {
    const {tab, click, handlers, removed} = setup(false);
    const first = tab("first");
    click(first, 1);
    click(first, 2);
    handlers.dblclick({target: first});
    assert.deepEqual(removed, []);
    assert.equal(first.pinned, true);
});
