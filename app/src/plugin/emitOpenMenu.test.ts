import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("menu event detail factories run only for subscribed plugins and preserve the supplied snapshot", () => {
    const exports = {} as typeof import("./EventBus");
    let subscribed = false;
    let factoryCalls = 0;
    const received: unknown[] = [];
    const elements = {};
    runInNewContext(transpileModule(readFileSync("src/plugin/EventBus.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: (name: string) => name === "./EventBusCore" ? {
        hasPluginSubscriber: () => subscribed,
        emitToPlugins: (_type: string, detail: unknown) => received.push(detail),
    } : {subMenu: class {menus: unknown[] = [];}}});
    const detail = () => { factoryCalls++; return {elements}; };
    exports.emitOpenMenu({type: "open-menu-doctree", detail});
    assert.equal(factoryCalls, 0);
    assert.equal(received.length, 0);
    subscribed = true;
    exports.emitOpenMenu({type: "open-menu-doctree", detail});
    assert.equal(factoryCalls, 1);
    assert.equal((received[0] as {elements: unknown}).elements, elements);
    const eager = {elements};
    exports.emitOpenMenu({type: "open-menu-doctree", detail: eager});
    assert.equal(received[1], eager);
});

test("a menu replaced by its plugin event does not receive stale plugin entries", () => {
    const exports = {} as typeof import("./EventBus");
    let current = true;
    const appended: unknown[] = [];
    runInNewContext(transpileModule(readFileSync("src/plugin/EventBus.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, window: {siyuan: {languages: {}, menus: {menu: {append: (item: unknown) => appended.push(item)}}}},
        require: (name: string) => name === "./EventBusCore" ? {
            hasPluginSubscriber: () => true,
            emitToPlugins: (_type: string, detail: {menu: {menus: unknown[]}}) => {
                detail.menu.menus.push({id: "plugin-action"});
                current = false;
            },
        } : {subMenu: class {menus: unknown[] = [];}, MenuItem: class {element = {};}}
    });
    const result = exports.emitOpenMenu({type: "open-menu-doctree", detail: {}, isCurrent: () => current});
    assert.equal(result.length, 1);
    assert.equal(appended.length, 0);
});
