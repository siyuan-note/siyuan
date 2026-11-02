import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("mobile tab overview renders current document titles and rejects reused or removed entries", () => {
    const reads: Array<{label: object, id: string, notebook: string, current: () => boolean}> = [];
    const label = {};
    const rows = ["rich", "plain", "blank", "notebook"].map(id => ({dataset: {tabId: id}, querySelector: () => label}));
    const modules: Record<string, unknown> = {
        "../../constants": {Constants: {}},
        "../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../emoji/fileTreeIcon": {getDocumentIconHTML: () => ""},
        "./mobileTabsState": {orderTabsForOverview: (tabs: unknown[]) => tabs, canCloseTab: () => true},
        "../menu/model": {openModel: (options: {bindEvent: (element: unknown) => void}) => options.bindEvent({
            firstElementChild: {}, querySelectorAll: () => rows,
        })},
        "../../protyle/header/documentTitlePreview": {renderDocumentTitlePreview: (element: object, id: string,
            notebook: string, current: () => boolean) => reads.push({label: element, id, notebook, current})},
    };
    const exports: any = {};
    runInNewContext(transpileModule(readFileSync(join(__dirname, "MobileTabs.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: (name: string) => modules[name] || {}, window: {siyuan: {languages: {}}}});
    const rich = {id: "rich", current: {rootID: "document", notebookID: "box", title: "Rich"}};
    const plain = {id: "plain", current: {rootID: "plain-document", notebookID: "box", title: "Plain"}};
    const state = {tabs: [rich, plain, {id: "blank"}, {id: "notebook", current: {rootID: "box", notebookID: "box"}}]};
    const tabs = Object.assign(Object.create(exports.MobileTabs.prototype), {state, canGoBack: () => false,
        canGoForward: () => false, bindOverviewEvents: () => {}});
    tabs.renderOverview();
    assert.deepEqual(reads.map(read => read.id), ["document", "plain-document"]);
    assert.ok(reads.every(read => read.notebook === "box" && read.label === label && read.current()));
    rich.current = {...rich.current, rootID: "another-document"};
    assert.equal(reads[0].current(), false);
    state.tabs.splice(state.tabs.indexOf(plain), 1);
    assert.equal(reads[1].current(), false);
});

test("tab overview actions do not handle back buttons in a subsequent settings page", () => {
    const source = transpileModule(readFileSync(join(__dirname, "MobileTabs.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    const handlers = new Map<string, (event: unknown) => void>();
    const pageHandlers = new Map<string, (event: unknown) => void>();
    const shell = {
        firstElementChild: {addEventListener: (name: string, handler: (event: unknown) => void) => pageHandlers.set(name, handler)},
        addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    };
    const modules: Record<string, unknown> = {
        "../../constants": {Constants: {}},
        "../../util/escape": {escapeAttr: (value: string) => value},
        "./mobileTabsState": {orderTabsForOverview: (tabs: unknown[]) => tabs},
        "../menu/model": {openModel: (options: {bindEvent: (element: unknown) => void}) => options.bindEvent(shell)},
        "../util/closePanel": {closeModel: () => {}},
    };
    const api = {} as typeof import("./MobileTabs");
    runInNewContext(source, {
        exports: api, require: (name: string) => modules[name] || {},
        window: {siyuan: {languages: {}}},
    });
    let navigated = 0;
    const tabs = Object.assign(Object.create(api.MobileTabs.prototype), {
        state: {tabs: []}, canGoBack: () => true, canGoForward: () => false,
        goBack: () => { navigated++; return Promise.resolve(true); },
    });
    tabs.renderOverview();
    const event = {target: {closest: () => ({dataset: {action: "back"}, closest: (): undefined => undefined})},
        stopPropagation: () => {}};
    pageHandlers.get("click")(event);
    assert.equal(navigated, 1);
    handlers.get("click")?.(event);
    assert.equal(navigated, 1);
    assert.equal(handlers.size, 0);
});
