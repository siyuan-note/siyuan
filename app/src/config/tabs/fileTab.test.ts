import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {controlBoolean, controlSelect} from "../setting/control";
import * as fragments from "../render/fragments";
import {isSettingControl} from "../render/parts";
import {buildItemSearchIndex} from "../search/normalize";
import type {RegisterSettingItem} from "../setting/item";
import type {SettingTabBuilder, SettingTabSearchResult} from "../setting/builder";

const compile = (file: string, extra = "") => ts.transpileModule(
    readFileSync(join(__dirname, file), "utf8") + extra,
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}},
).outputText;

const loadBehaviorSettings = (config: {docIconClickMode?: number, parentDocTitleClickMode?: number} = {}) => {
    const fileTree = {docIconClickMode: 0, parentDocTitleClickMode: 0, ...config};
    const languages = {
        docIconClickAction: "Clicking a document icon",
        docIconClickActionTip: "Action performed by clicking a document icon; without child documents an openable document opens, otherwise the icon is changed",
        parentDocTitleClickAction: "Clicking a parent document title",
        parentDocTitleClickActionTip: "Choose the action; the double-click option opens the parent but a single click waits about 300 ms",
        changeIcon: "Change icon",
        openDocument: "Open document",
        docTreeClickExpandChildren: "Expand or collapse child documents",
        docTreeClickExpandChildrenDblclick: "Expand or collapse child documents (double-click opens the parent)",
    };
    const saved: unknown[][] = [];
    const updates: string[] = [];
    const registered: RegisterSettingItem[] = [];
    const windowContext = {siyuan: {config: {fileTree, system: {container: ""}}, languages}};
    const builderExports: {SettingTabBuilder?: typeof SettingTabBuilder} = {};
    runInNewContext(compile("../setting/builder.ts"), {
        exports: builderExports, window: windowContext,
        require: (name: string) => {
            if (name === "./control") return {
                // 未显式传入 readConfig 的开关与下拉按控件 id 末段从测试配置读取，避免依赖运行环境
                controlSelect: (id: string, options: {options: {value: number | string, label?: string}[],
                    readConfig?: () => number | string}) => controlSelect(id, {
                    options: options.options,
                    readConfig: options.readConfig ?? (() => fileTree[id.split(".")[1] as keyof typeof fileTree]),
                }),
                controlBoolean: (id: string, options?: {readConfig?: () => boolean}) => controlBoolean(id, {
                    readConfig: options?.readConfig ??
                        (() => Boolean(fileTree[id.split(".")[1] as keyof typeof fileTree])),
                }),
            };
            if (name === "./group") return {registerSettingGroup() {}};
            if (name === "./item") return {registerSettingItem: (item: RegisterSettingItem) => registered.push(item)};
            return {};
        },
    });
    const exports: {registerFileTreeBehaviorGroup?: (tab: SettingTabBuilder) => void} = {};
    runInNewContext(compile("fileTab.ts", "\nexport {registerFileTreeBehaviorGroup};"), {
        exports, CSS: {escape: (text: string) => text}, window: windowContext,
        require: (name: string) => {
            if (name.endsWith("/fileRuntime")) {
                return {fileConfigApi: {patch: (...args: unknown[]) => {
                    saved.push(args);
                    // 保存成功后的刷新回调
                    if (typeof args[2] === "function") { (args[2] as () => void)(); }
                    return Promise.resolve();
                }}};
            }
            if (name.endsWith("/getAll")) {
                return {getAllModels: () => ({files: [{updateDocActions: () => updates.push("docActions")}]})};
            }
            return {};
        },
    });
    exports.registerFileTreeBehaviorGroup(new builderExports.SettingTabBuilder({
        id: "file", icon: "iconFile", title: () => "Documents",
    }));
    const icon = registered.find(item => item.id === "fileTree.docIconClickMode");
    const title = registered.find(item => item.id === "fileTree.parentDocTitleClickMode");
    assert.ok(icon?.kind === "full" && title?.kind === "full");
    const entries = () => [{group: {id: "behavior", title: "Behavior", searchTitle: "behavior"},
        items: registered.filter(item => item.kind === "full").map(item => ({...item, searchIndex: buildItemSearchIndex(item)}))}];
    const renderExports: {buildGroupedItemsView?: (id: string) => {html: string}} = {};
    runInNewContext(compile("../render/render.ts"), {
        exports: renderExports, window: windowContext,
        require: (name: string) => {
            if (name.endsWith("/item")) return {getTabGroupEntries: entries};
            if (name === "./parts") return {isSettingControl};
            if (name === "./fragments") return fragments;
            if (name.endsWith("/escape")) return {escapeAttr: (text: string) => text};
            return {};
        },
    });
    const scanExports: {scanSettingTabSearch?: (id: string, title: string, query: string) => SettingTabSearchResult} = {};
    runInNewContext(compile("../search/scan.ts"), {exports: scanExports,
        require: () => ({getTabGroupEntries: entries})});
    return {icon, title, saved, updates, fileTree,
        iconControl: icon?.rowParts.find(isSettingControl), titleControl: title?.rowParts.find(isSettingControl),
        html: () => renderExports.buildGroupedItemsView("file").html,
        search: (query: string) => scanExports.scanSettingTabSearch("file", "documents", query)};
};

test("both click settings are standard select rows that replace the removed switches", () => {
    const h = loadBehaviorSettings();
    assert.ok(h.iconControl?.kind === "select" && h.titleControl?.kind === "select");
    // 选项数组由被测代码所在上下文创建，用字符串比对避免跨上下文原型差异
    assert.equal(h.iconControl.options.map(option => option.value).join(","), "0,1");
    assert.equal(h.titleControl.options.map(option => option.value).join(","), "0,1,2");
    const html = h.html();
    assert.match(html, /data-config-item-id="fileTree.docIconClickMode"/);
    assert.match(html, /data-config-item-id="fileTree.parentDocTitleClickMode"/);
    assert.equal(html.includes("fileTree.docIconClickExpand"), false);
    assert.equal(html.includes("fileTree.parentDocClickExpand"), false);
    assert.equal(html.includes("fileTree.parentDocDoubleClickOpen"), false);
    assert.equal(h.saved.length, 0);
});

test("the stored mode selects its own option and defaults to the conventional behaviour", () => {
    const defaults = loadBehaviorSettings();
    assert.equal(defaults.iconControl?.readConfig(), 0);
    assert.equal(defaults.titleControl?.readConfig(), 0);
    // 默认「修改图标」与「打开文档」选中，即单击不需等待双击判定
    assert.equal((defaults.html().match(/value="0" selected>/g) || []).length, 2);

    const expand = loadBehaviorSettings({docIconClickMode: 1, parentDocTitleClickMode: 2});
    assert.equal(expand.iconControl?.readConfig(), 1);
    assert.equal(expand.titleControl?.readConfig(), 2);
    const html = expand.html();
    assert.equal((html.match(/value="1" selected>/g) || []).length, 1);
    assert.equal((html.match(/value="2" selected>/g) || []).length, 1);
    assert.equal(html.includes("value=\"0\" selected>"), false);
});

test("shared action keywords reveal both rows while a specific wrong row stays hidden", () => {
    const h = loadBehaviorSettings();
    for (const query of ["expand or collapse child documents", "double-click opens the parent"]) {
        const result = h.search(query);
        assert.equal(result.matches, true);
        assert.equal(result.visibleItemIds.has("fileTree.docIconClickMode"), true);
        assert.equal(result.visibleItemIds.has("fileTree.parentDocTitleClickMode"), true);
    }
    const iconOnly = h.search("change icon");
    assert.equal(iconOnly.visibleItemIds.has("fileTree.docIconClickMode"), true);
    assert.equal(iconOnly.visibleItemIds.has("fileTree.parentDocTitleClickMode"), false);
});

test("saving patches only its own mode field and refreshes the document tree", async () => {
    const h = loadBehaviorSettings();
    await h.icon.save(1);
    assert.deepEqual(h.saved.at(-1)?.slice(0, 2), ["docIconClickMode", 1]);
    assert.equal(typeof h.saved.at(-1)?.[1], "number");
    assert.equal(h.updates.length, 1);
    await h.title.save(2);
    assert.deepEqual(h.saved.at(-1)?.slice(0, 2), ["parentDocTitleClickMode", 2]);
    assert.equal(h.saved.length, 2);
    assert.equal(h.updates.length, 2);
});
