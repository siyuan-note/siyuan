import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadTab = () => {
    const labels = new WeakMap<object, {textContent: string, classList: {remove: () => void}, dataset: Record<string, string>}>();
    const createElement = () => {
        const classes = new Set<string>();
        const element = {
            innerHTML: "",
            classList: {add: (...values: string[]) => values.forEach(value => classes.add(value)),
                contains: (value: string) => classes.has(value)},
            setAttribute() {},
            addEventListener() {},
            querySelector: (selector: string) => selector === ".item__text" ? labels.get(element) : null,
        };
        labels.set(element, {textContent: "", classList: {remove: () => {}}, dataset: {}});
        return element;
    };
    const exports = {} as {Tab: new (options: {title?: string; icon?: string; panel?: string}) => {
        title: string; headElement?: ReturnType<typeof createElement>; panelElement: ReturnType<typeof createElement>;
        updateTitle: (title: string) => void;
    }};
    let sequence = 0;
    const modules: Record<string, unknown> = {
        "../util/genID": {genUUID: () => `tab-${++sequence}`},
        "../util/escape": {escapeHtml: (text: string) => text, escapeAttr: (text: string) => text},
        "../window/setHeader": {setTitle() {}},
    };
    runInNewContext(transpileModule(readFileSync(join(__dirname, "Tab.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, document: {createElement, querySelector: (): null => null},
        require: (name: string) => modules[name] || {}});
    return {Tab: exports.Tab, labels};
};

test("an explicitly empty title creates a header that can receive later title updates", () => {
    const {Tab, labels} = loadTab();
    const tab = new Tab({title: ""});
    assert.ok(tab.headElement, "image-only document summaries can be empty without omitting the tab header");
    assert.equal(tab.title, "");
    assert.match(tab.headElement.innerHTML, /class="item__text"/);
    tab.updateTitle("Changed");
    assert.equal(labels.get(tab.headElement)?.textContent, "Changed");
    tab.updateTitle("");
    assert.equal(labels.get(tab.headElement)?.textContent, "");
});

test("omitting both title and icon preserves a headerless panel", () => {
    const {Tab} = loadTab();
    const tab = new Tab({panel: "Panel content"});
    assert.equal(tab.headElement, undefined);
    assert.equal(tab.panelElement.innerHTML, "Panel content");
});

test("named tabs and icon-only tabs continue to create headers", () => {
    const {Tab} = loadTab();
    for (const options of [{title: "Named"}, {icon: "iconFile"}]) {
        assert.ok(new Tab(options).headElement);
    }
});
