import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

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
