import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {controlBoolean} from "../setting/control";
import * as fragments from "../render/fragments";
import {isSettingControl} from "../render/parts";
import {buildItemSearchIndex} from "../search/normalize";
import type {RegisterSettingItem} from "../setting/item";
import type {SettingTabBuilder, SettingTabSearchResult} from "../setting/builder";

const compile = (file: string, extra = "") => ts.transpileModule(
    readFileSync(join(__dirname, file), "utf8") + extra,
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}},
).outputText;

const loadBehaviorSettings = (parentEnabled: boolean, childEnabled?: boolean) => {
    const fileTree = {parentDocClickExpand: parentEnabled, parentDocDoubleClickOpen: childEnabled};
    const languages = {parentDocClickExpand: "Expand parent title", parentDocClickExpandTip: "Toggle child documents",
        parentDocDoubleClickOpen: "Double-click to open", parentDocDoubleClickOpenTip: "Wait about 300 ms"};
    const saved: unknown[][] = [];
    const registered: RegisterSettingItem[] = [];
    const windowContext = {siyuan: {config: {fileTree}, languages}};
    const builderExports: {SettingTabBuilder?: typeof SettingTabBuilder} = {};
    runInNewContext(compile("../setting/builder.ts"), {
        exports: builderExports, window: windowContext,
        require: (name: string) => {
            if (name === "./control") return {controlBoolean: (id: string, options?: {readConfig?: () => boolean}) =>
                controlBoolean(id, {readConfig: options?.readConfig ??
                    (() => Boolean(fileTree[id.split(".")[1] as keyof typeof fileTree]))})};
            if (name === "./group") return {registerSettingGroup() {}};
            if (name === "./item") return {registerSettingItem: (item: RegisterSettingItem) => registered.push(item)};
            return {};
        },
    });
    const exports: {registerFileTreeBehaviorGroup?: (tab: SettingTabBuilder) => void} = {};
    runInNewContext(compile("fileTab.ts", "\nexport {registerFileTreeBehaviorGroup};"), {
        exports, CSS: {escape: (text: string) => text}, window: windowContext,
        require: (name: string) => name.endsWith("/fileRuntime")
            ? {fileConfigApi: {patch: (...args: unknown[]) => saved.push(args)}} : {},
    });
    exports.registerFileTreeBehaviorGroup(new builderExports.SettingTabBuilder({
        id: "file", icon: "iconFile", title: () => "Documents",
    }));
    const parent = registered.find(item => item.id === "fileTree.parentDocClickExpand");
    const child = registered.find(item => item.id === "fileTree.parentDocDoubleClickOpen");
    assert.ok(parent?.kind === "full" && child?.kind === "full");
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
    return {parent, child, saved, fileTree,
        html: () => renderExports.buildGroupedItemsView("file").html,
        search: (query: string) => scanExports.scanSettingTabSearch("file", "documents", query)};
};

test("parent and child use separate standard setting rows and inherit the enabled default", () => {
    const h = loadBehaviorSettings(false);
    const control = h.child.rowParts.find(isSettingControl);
    assert.equal(control.id, "fileTree.parentDocDoubleClickOpen");
    assert.equal(control.readConfig(), true);
    const html = h.html();
    assert.equal(html.includes("b3-label--inner"), false);
    assert.match(html, /<label class="fn__flex b3-label config-item" data-config-item-id="fileTree.parentDocClickExpand">/);
    assert.match(html, /<label class="fn__flex b3-label config-item" data-config-item-id="fileTree.parentDocDoubleClickOpen">/);
});

test("searching either setting retains parent and child context", () => {
    const h = loadBehaviorSettings(false);
    for (const query of ["double-click", "expand parent title", "300 ms"]) {
        const result = h.search(query);
        assert.equal(result.matches, true);
        assert.equal(result.visibleItemIds.has(h.parent.id), true);
        assert.equal(result.visibleItemIds.has(h.child.id), true);
    }
});

test("parent toggling hides its child without changing or saving the child's preference", async () => {
    for (const checked of [false, true]) {
        const h = loadBehaviorSettings(false, checked);
        let change: () => void;
        const parent = {checked: false, addEventListener: (_name: string, listener: () => void) => { change = listener; }};
        const classes = new Set<string>();
        const childRow = {classList: {
            add: (name: string) => classes.add(name),
            toggle: (name: string, enabled: boolean) => {
                if (enabled) { classes.add(name); } else { classes.delete(name); }
            },
        }};
        const child = {closest: () => childRow};
        const root = {querySelector: (selector: string) => selector.includes("parentDocClickExpand") ? parent : child};
        await h.parent.afterMount(root as unknown as HTMLElement);
        assert.equal(classes.has("fn__none"), true);
        assert.equal(classes.has("config-filetree-click__child"), true);
        parent.checked = true;
        change();
        assert.equal(classes.has("fn__none"), false);
        parent.checked = false;
        change();
        assert.equal(classes.has("fn__none"), true);
        assert.equal(h.fileTree.parentDocDoubleClickOpen, checked);
        assert.equal(h.saved.length, 0);
        h.parent.save(true);
        assert.equal(h.saved[0][0], "parentDocClickExpand");
        assert.equal(h.saved[0][1], true);
    }
});
