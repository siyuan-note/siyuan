import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";
import {getListMindmapConnectorMenuItem} from "./connectorMenu";
import {getListMindmapFoldMenuItems} from "./foldMenu";
import {assignListMindmapBranchColors, getListMindmapAppearanceMenu} from "./appearance";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
let callback = "";
let batchCallback = "";
const visit = (node: import("typescript").Node) => {
    if (isPropertyAssignment(node) && node.name.getText(source) === "onSettingsMenu") {
        callback = node.initializer.getText(source);
    }
    if (isPropertyAssignment(node) && node.name.getText(source) === "onNodesStyle") {
        batchCallback = node.initializer.getText(source);
    }
    node.forEachChild(visit);
};
visit(controller);
assert.ok(callback);
assert.ok(batchCallback);
const methods = controller.members.filter(item => item.name && ["metadata", "change"].includes(item.name.getText(source)));
const compiled = transpileModule(`class Controller {
    ${methods.map(item => item.getText(source)).join("\n")}
    onSettingsMenu = ${callback};
    onNodesStyle = ${batchCallback};
}
globalThis.Controller = Controller;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("desktop and mobile settings cancel theme previews and persist one undoable change with existing metadata", async () => {
    for (const mobile of [false, true]) {
        let data = {version: 2, nodes: {child: {lineColor: "red"}}, relations: [] as unknown[], extension: "keep"};
        const original = JSON.stringify(data);
        const list = {isConnected: true, dataset: {nodeId: "map"}, closest: (): null => null,
            get outerHTML() { return JSON.stringify(data); }};
        const transactions: {before: string, after: string}[] = [];
        let editable = true;
        let item: IMenu;
        let appearanceItem: IMenu;
        let defaultItem: IMenu;
        let expandItem: IMenu;
        let panItem: IMenu;
        let entries: IMenu[];
        let closeMenu: () => void;
        const rendered: import("./model").ListMindmapModel[] = [];
        const menuWindow = Object.assign(new EventTarget(), {
            siyuan: {languages: {listMindmapExpandToLevel: "Level ${level}"}},
        });
        const dismiss = () => {
            const close = closeMenu;
            closeMenu = undefined;
            close?.();
        };
        let defaultStyle = "bezier";
        const defaults: string[] = [];
        const placements: unknown[] = [];
        const anchor = {getBoundingClientRect: () => ({left: 20, bottom: 100, height: 24})};
        const context: any = {
            owner: {}, list,
            canEdit: () => editable,
            getListMindmapConnectorMenuItem,
            getListMindmapAppearanceMenu,
            assignListMindmapBranchColors,
            getListMindmapFoldMenuItems,
            getDefaultListMindmapConnectorStyle: () => defaultStyle,
            setDefaultListMindmapConnectorStyle: (style: string) => { defaultStyle = style; defaults.push(style); },
            getListMindmapSiblingIDs: () => new Map(),
            normalizeListMindmapSummaryMetadata: () => {},
            readListMindmap: () => ({root: {id: "root", children: [{id: "child"}]}, metadata: JSON.parse(JSON.stringify(data)),
                nodes: new Map([["root", {children: []}], ["child", {children: []}]])}),
            writeListMindmapMetadata: (_list: unknown, value: typeof data) => data = value,
            cleanListMindmapHTML: (html: string) => html,
            updateTransaction: (_owner: unknown, _list: unknown, before: string) =>
                transactions.push({before, after: list.outerHTML}),
            showMessage: () => assert.fail("valid connector changes must not report an error"),
            isMobile: () => mobile,
            toggleMenu: ({target, build}: {target: unknown, build: (menu: unknown, session: unknown) => void}) => {
                assert.equal(target, anchor);
                dismiss();
                build(undefined, {show: (open: () => void) => open()});
            },
            Menu: class {
                constructor(_id?: string, close?: () => void) { entries = []; closeMenu = close; }
                addItem(value: IMenu) {
                    entries.push(value);
                    if (value.id === "defaultConnectorStyle") { defaultItem = value; }
                    else if (value.id === "expandLevel") { expandItem = value; }
                    else if (value.id === "pan") { panItem = value; }
                    else if (value.id === "appearance") {
                        appearanceItem = value;
                        item = (value.submenu as IMenu[]).find(entry => entry.id === "connectorStyle");
                    }
                }
                open(position: unknown) { placements.push(position); }
                fullscreen(position: unknown) { placements.push(position); }
            },
            window: menuWindow, console,
        };
        runInNewContext(compiled, context);
        const target = new context.Controller();
        Object.assign(target, {list, owner: {}, model: context.readListMindmap(),
            view: {getSelectedId: () => "root", update: (model: import("./model").ListMindmapModel) => rendered.push(model)},
            refresh: () => target.model = context.readListMindmap()});
        const choose = (style: string) => (item.submenu as IMenu[]).find(entry => entry.id === style).click(undefined, undefined);
        target.onSettingsMenu(anchor);
        assert.equal((item.submenu as IMenu[]).find(entry => entry.checked).id, "bezier");
        assert.deepEqual(JSON.parse(JSON.stringify(placements)), [mobile ? "bottom" : {x: 20, y: 100, h: 24}]);
        assert.equal(expandItem, undefined, "wide views keep expansion in the direct toolbar");
        let selectedLevel: unknown;
        target.onSettingsMenu(anchor, (level: unknown) => selectedLevel = level);
        assert.deepEqual((expandItem.submenu as IMenu[]).map(entry => entry.id),
            ["expandAll", "foldAll", "separator_all", "level1", "level2", "level3", "level4", "level5", "level6"]);
        (expandItem.submenu as IMenu[]).find(entry => entry.id === "level3").click(undefined, undefined);
        assert.equal(selectedLevel, 3, "narrow desktop and mobile views retain global expansion in More");
        (defaultItem.submenu as IMenu[]).find(entry => entry.id === "rounded").click(undefined, undefined);
        assert.deepEqual(defaults, ["rounded"]);
        assert.equal(transactions.length, 0, "changing the preference must not enter document undo history");
        assert.equal(JSON.stringify(data), original, "changing the preference must not restyle the current map");
        target.onSettingsMenu(anchor);
        assert.equal((defaultItem.submenu as IMenu[]).find(entry => entry.checked).id, "rounded");
        assert.equal((item.submenu as IMenu[]).find(entry => entry.checked).id, "bezier");
        choose("orthogonal");
        assert.equal(transactions.length, 1);
        assert.equal(transactions[0].before, original);
        assert.deepEqual(JSON.parse(transactions[0].after), {...JSON.parse(original), connectorStyle: "orthogonal"});
        const saved = transactions[0].after;
        data = JSON.parse(transactions[0].before);
        target.onSettingsMenu(anchor);
        assert.equal((item.submenu as IMenu[]).find(entry => entry.checked).id, "bezier", "undo restores the missing default");
        data = JSON.parse(saved);
        target.onSettingsMenu(anchor);
        assert.equal((item.submenu as IMenu[]).find(entry => entry.checked).id, "orthogonal", "redo restores the saved preset");
        choose("orthogonal");
        assert.equal(transactions.length, 1, "choosing the current style is a no-op");
        let finish: (value: boolean) => void;
        target.activeEditor = {finish: () => new Promise<boolean>(resolve => finish = resolve)};
        choose("rounded");
        data.extension = "remote edit";
        finish(true);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(JSON.parse(transactions[1].after).extension, "remote edit", "pending text edits cannot overwrite newer metadata");
        target.activeEditor = undefined;
        choose("bezier");
        assert.equal(Object.hasOwn(data, "connectorStyle"), false, "restoring the default removes the optional field");
        target.onSettingsMenu(anchor);
        const theme = (appearanceItem.submenu as IMenu[]).find(entry => entry.id === "theme");
        const beforeTheme = list.outerHTML;
        const beforeCount = transactions.length;
        const waves = (theme.submenu as IMenu[]).find(entry => entry.id === "waves");
        let applyTheme = waves;
        const swatch = new EventTarget();
        waves.bind?.(swatch as unknown as HTMLElement);
        const enter = (pointerType: string) => swatch.dispatchEvent(Object.assign(new Event("pointerenter"), {pointerType}));
        const beforeRenderCount = rendered.length;
        enter("touch");
        assert.equal(rendered.length, beforeRenderCount, "touch does not preview or select a theme");
        enter("mouse");
        if (mobile) {
            assert.equal(waves.bind, undefined, "mobile themes retain tap-to-apply behavior");
        } else {
            assert.equal(rendered.at(-1).metadata.appearance.rootColor, "#849695", "hover previews the theme immediately");
            assert.notEqual(rendered.at(-1).metadata, target.model.metadata, "preview uses a separate metadata snapshot");
            assert.equal(rendered.at(-1).metadata.nodes.child.lineColor, "red", "preview preserves manual colors");
            assert.equal(target.model.metadata.appearance, undefined, "hover leaves the controller's canonical model unchanged");
            swatch.dispatchEvent(new Event("pointerleave"));
            assert.equal(rendered.at(-1), target.model, "leaving the row restores the saved model");
            enter("mouse");
            menuWindow.dispatchEvent(Object.assign(new Event("keydown"), {key: "Escape"}));
            assert.equal(rendered.at(-1), target.model, "Escape cancels preview even when only a submenu closes");
            enter("mouse");
            dismiss();
            assert.equal(rendered.at(-1), target.model, "dismissing the menu restores the latest saved model");
            const closedRenderCount = rendered.length;
            enter("mouse");
            assert.equal(rendered.length, closedRenderCount, "a closed menu cannot reapply an obsolete preview");
            target.onSettingsMenu(anchor);
            applyTheme = ((appearanceItem.submenu as IMenu[]).find(entry => entry.id === "theme").submenu as IMenu[])
                .find(entry => entry.id === "waves");
            const activeSwatch = new EventTarget();
            applyTheme.bind(activeSwatch as unknown as HTMLElement);
            activeSwatch.dispatchEvent(Object.assign(new Event("pointerenter"), {pointerType: "mouse"}));
        }
        assert.equal(list.outerHTML, beforeTheme, "preview never changes source attributes or content");
        assert.equal(transactions.length, beforeCount, "preview never creates undo entries");
        applyTheme.click(undefined, undefined);
        dismiss();
        if (!mobile) {
            assert.equal(rendered.at(-1), target.model, "closing after applying retains the newly saved model");
        }
        assert.equal(transactions.length, beforeCount + 1, "applying a palette is one document transaction on both platforms");
        assert.equal(transactions.at(-1).before, beforeTheme);
        assert.equal(JSON.parse(list.outerHTML).nodes.child.lineColor, "red", "theme changes retain manual overrides");
        assert.equal(JSON.parse(list.outerHTML).nodes.child.branchColor, 0, "branch slots are saved with the same snapshot");
        assert.equal(JSON.parse(list.outerHTML).appearance.rootColor, "#849695",
            "the root theme color is saved in the same document transaction on desktop and mobile");
        assert.equal(JSON.parse(list.outerHTML).appearance.nodeStyle, "branch",
            "the reference style is saved with the root and branch palette on both platforms");
        const themed = list.outerHTML;
        data = JSON.parse(beforeTheme);
        assert.equal(JSON.parse(list.outerHTML).appearance, undefined, "undo restores the unthemed document");
        data = JSON.parse(themed);
        target.onNodesStyle(["root", "child", "deleted"], {backgroundColor: "#fed7aa", textColor: "#000000"});
        assert.equal(transactions.length, beforeCount + 2, "batch node colors save one snapshot");
        const updated = JSON.parse(list.outerHTML);
        assert.equal(updated.nodes.root.backgroundColor, "#fed7aa");
        assert.equal(updated.nodes.child.backgroundColor, "#fed7aa");
        assert.equal(updated.nodes.child.lineColor, "red");
        assert.equal(updated.nodes.deleted, undefined, "a stale selection cannot create orphan styles");
        const count = transactions.length;
        editable = false;
        choose("spline");
        (theme.submenu as IMenu[]).find(entry => entry.id === "dream").click(undefined, undefined);
        target.onNodesStyle(["root", "child"], {backgroundColor: "#ffffff"});
        (defaultItem.submenu as IMenu[]).find(entry => entry.id === "spline").click(undefined, undefined);
        assert.deepEqual(defaults, ["rounded"], "a stale menu cannot change preferences after editing is disabled");
        assert.equal(transactions.length, count, "an already open menu cannot edit a newly read-only map");
        let panToggles = 0;
        target.onSettingsMenu(anchor, undefined, {active: true, toggle: () => panToggles++});
        assert.deepEqual(entries.map(entry => entry.id), ["pan"], "read-only menus contain no editable global settings");
        assert.equal(panItem.checked, true, "the fallback pan mode remains visible in a read-only map's More menu");
        panItem.click(undefined, undefined);
        assert.equal(panToggles, 1);
        assert.equal(transactions.length, count, "switching pan mode never changes source data");
    }
});
