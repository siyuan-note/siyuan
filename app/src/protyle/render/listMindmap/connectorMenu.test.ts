import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";
import {getListMindmapConnectorMenuItem} from "./connectorMenu";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
let callback = "";
const visit = (node: import("typescript").Node) => {
    if (isPropertyAssignment(node) && node.name.getText(source) === "onSettingsMenu") {
        callback = node.initializer.getText(source);
    }
    node.forEachChild(visit);
};
visit(controller);
assert.ok(callback);
const methods = controller.members.filter(item => item.name && ["metadata", "change"].includes(item.name.getText(source)));
const compiled = transpileModule(`class Controller {
    ${methods.map(item => item.getText(source)).join("\n")}
    onSettingsMenu = ${callback};
}
globalThis.Controller = Controller;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("desktop and mobile connector menus persist one undoable change and preserve existing metadata", async () => {
    for (const mobile of [false, true]) {
        let data = {version: 2, nodes: {child: {lineColor: "red"}}, relations: [] as unknown[], extension: "keep"};
        const original = JSON.stringify(data);
        const list = {isConnected: true, dataset: {nodeId: "map"}, closest: (): null => null,
            get outerHTML() { return JSON.stringify(data); }};
        const transactions: {before: string, after: string}[] = [];
        let editable = true;
        let item: IMenu;
        let defaultItem: IMenu;
        let defaultStyle = "bezier";
        const defaults: string[] = [];
        const placements: unknown[] = [];
        const anchor = {getBoundingClientRect: () => ({left: 20, bottom: 100, height: 24})};
        const context: any = {
            owner: {}, list,
            canEdit: () => editable,
            getListMindmapConnectorMenuItem,
            getDefaultListMindmapConnectorStyle: () => defaultStyle,
            setDefaultListMindmapConnectorStyle: (style: string) => { defaultStyle = style; defaults.push(style); },
            getListMindmapSiblingIDs: () => new Map(),
            normalizeListMindmapSummaryMetadata: () => {},
            readListMindmap: () => ({root: {id: "root"}, metadata: JSON.parse(JSON.stringify(data)),
                nodes: new Map([["root", {children: []}]])}),
            writeListMindmapMetadata: (_list: unknown, value: typeof data) => data = value,
            cleanListMindmapHTML: (html: string) => html,
            updateTransaction: (_owner: unknown, _list: unknown, before: string) =>
                transactions.push({before, after: list.outerHTML}),
            showMessage: () => assert.fail("valid connector changes must not report an error"),
            isMobile: () => mobile,
            toggleMenu: ({target, build}: {target: unknown, build: (menu: unknown, session: unknown) => void}) => {
                assert.equal(target, anchor);
                build(undefined, {show: (open: () => void) => open()});
            },
            Menu: class {
                addItem(value: IMenu) {
                    if (value.id === "defaultConnectorStyle") { defaultItem = value; }
                    else { item = value; }
                }
                open(position: unknown) { placements.push(position); }
                fullscreen(position: unknown) { placements.push(position); }
            },
            window: {siyuan: {languages: {}}}, console,
        };
        runInNewContext(compiled, context);
        const target = new context.Controller();
        Object.assign(target, {list, owner: {}, view: {getSelectedId: () => "root"}, refresh: () => {}});
        const choose = (style: string) => (item.submenu as IMenu[]).find(entry => entry.id === style).click(undefined, undefined);
        target.onSettingsMenu(anchor);
        assert.equal((item.submenu as IMenu[]).find(entry => entry.checked).id, "bezier");
        assert.deepEqual(JSON.parse(JSON.stringify(placements)), [mobile ? "bottom" : {x: 20, y: 100, h: 24}]);
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
        const count = transactions.length;
        editable = false;
        choose("spline");
        (defaultItem.submenu as IMenu[]).find(entry => entry.id === "spline").click(undefined, undefined);
        assert.deepEqual(defaults, ["rounded"], "a stale menu cannot change preferences after editing is disabled");
        assert.equal(transactions.length, count, "an already open menu cannot edit a newly read-only map");
    }
});
