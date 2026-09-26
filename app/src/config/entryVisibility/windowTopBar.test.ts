import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as catalog from "./catalog";
import * as order from "./order";
import * as profile from "./profile";

const keys = ["windowWorkspace", "pinWindow"];

test("新窗口顶栏目录与按钮一致，旧配置和内置方案默认显示两个按钮", () => {
    const nodes = catalog.getEntryCatalogChildren(catalog.WINDOW_TOP_BAR_ROOT_PATH);
    assert.deepEqual(nodes.map(node => node.key), keys);
    assert.ok(catalog.getEntryOrderParents().includes(catalog.WINDOW_TOP_BAR_ROOT_PATH));
    nodes.forEach(node => {
        assert.equal(node.type, "entry");
        assert.equal(profile.getBuiltinProfileEntryVisibility("simple", node.simple), true);
        assert.equal(profile.getProfileEntryVisibility({entries: {}}, `windowTopBar.${node.key}`), true);
    });
    assert.match(readFileSync("src/window/workspace.ts", "utf8"), /dataset.windowTopbarEntry = "windowWorkspace"/);
    assert.match(readFileSync("src/boot/onGetConfig.ts", "utf8"), /data-window-topbar-entry="pinWindow"/);
    assert.deepEqual(order.resolveEntryOrder(keys, ["pinWindow"], new Set()), ["windowWorkspace", "pinWindow"]);
});

const compiled = transpileModule(readFileSync("src/config/entryVisibility/runtime.ts", "utf8")
    .replace(/\/\/\/ #if MOBILE\r?\n[\s\S]*?\/\/\/ #endif/g, ""), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("新窗口顶栏支持显隐和排序，保持拖动区、插件和系统按钮位置", () => {
    const createItem = (key = "") => {
        const element = {
            dataset: {windowTopbarEntry: key},
            hidden: false,
            classList: {toggle: (name: string, value: boolean) => {
                assert.equal(name, "fn__none");
                element.hidden = value;
            }},
        };
        return element;
    };
    const drag = createItem();
    const plugin = createItem();
    const controls = [createItem(), createItem(), createItem()];
    const elements = keys.map(createItem);
    const children = [drag, elements[0], plugin, elements[1], ...controls];
    const toolbar = {children, append(element: typeof elements[number]) {
        children.splice(children.indexOf(element), 1);
        children.push(element);
    }};
    const custom = {id: "custom", entries: {"windowTopBar.windowWorkspace": false, "windowTopBar.pinWindow": false},
        orders: {windowTopBar: ["pinWindow", "windowWorkspace"]}};
    const config = {active: "custom", profiles: [custom]};
    const api = {} as typeof import("./runtime");
    runInNewContext(compiled, {
        exports: api,
        require: (name: string) => name === "./catalog" ? catalog : name === "./order" ? order :
            name === "./profile" ? profile : name === "./dockOrder" ? {isDockOrderScope: () => false} : {},
        window: {siyuan: {config: {appearance: {entryVisibility: config}}}},
        document: {querySelector: () => toolbar},
    });
    api.applyWindowTopBarEntryVisibility();
    assert.deepEqual(children, [drag, elements[1], plugin, elements[0], ...controls]);
    assert.ok(elements.every(element => element.hidden));
    config.active = "full";
    api.applyWindowTopBarEntryVisibility();
    assert.deepEqual(children, [drag, elements[0], plugin, elements[1], ...controls]);
    assert.ok(elements.every(element => !element.hidden));
    config.active = "simple";
    api.applyWindowTopBarEntryVisibility();
    assert.ok(elements.every(element => !element.hidden));
});
