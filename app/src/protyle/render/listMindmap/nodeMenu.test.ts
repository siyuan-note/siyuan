import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";
import {getListMindmapNodeStyleMenuItems} from "./nodeStyleMenu";

test("desktop and mobile node menus keep clipboard and task actions and expose editable node styles", () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
        ScriptTarget.ES2021, true);
    let callback = "";
    const visit = (node: import("typescript").Node) => {
        if (isPropertyAssignment(node) && node.name.getText(source) === "onNodeMenu") {
            callback = node.initializer.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(callback);
    const compiled = transpileModule(`class Controller {openMore = ${callback};} globalThis.Controller = Controller;`,
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    for (const mobile of [false, true]) {
        for (const ids of [["child"], ["root"], ["realRoot"], ["child", "second"], ["root", "child"]]) {
            for (const editable of [true, false]) {
                const entries: IMenu[] = [];
                const actions: unknown[] = [];
                const placements: unknown[] = [];
                const anchor = {getBoundingClientRect: () => ({left: 20, bottom: 100, height: 26})};
                const model = {nodes: new Map([["root", {virtual: true}], ["realRoot", {virtual: false}],
                    ["child", {taskMarker: " ", parentId: "root"}], ["second", {parentId: "root"}]]),
                    metadata: {nodes: {child: {connectorStyle: "rounded", shape: "capsule"}}}};
                const context: any = {
                    owner: {}, list: {}, canEdit: () => editable, readListMindmap: () => model,
                    getListMindmapNodeStyleMenuItems,
                    canCutMindmapBranches: (_model: unknown, selected: string[]) => !selected.some(id => id === "root" || id === "realRoot"),
                    window: {siyuan: {languages: new Proxy({}, {get: (_target, key) => String(key)})}},
                    isMobile: () => mobile,
                    getTaskStatusItems: (marker: string, set: (marker: string) => void) => {
                        assert.equal(marker, " ");
                        return [{label: "Done", click: () => set("X")}];
                    },
                    toggleMenu: ({target, build}: {target: unknown, build: (menu: unknown, session: unknown) => void}) => {
                        assert.equal(target, anchor);
                        build(undefined, {show: (open: () => void) => open()});
                    },
                    Menu: class {
                        addItem(item: IMenu) { entries.push(item); }
                        open(position: unknown) { placements.push(position); }
                        fullscreen(position: unknown) { placements.push(position); }
                    },
                };
                runInNewContext(compiled, context);
                const target = new context.Controller();
                Object.assign(target, {model,
                    copyNodes: (...args: unknown[]) => actions.push(args),
                    pasteNodes: (...args: unknown[]) => actions.push(args),
                    setTask: (id: string, next: () => string) => actions.push([id, next()]),
                    setNodeStyles: (...args: unknown[]) => actions.push(args),
                });
                target.openMore(anchor, ids);
                assert.deepEqual(JSON.parse(JSON.stringify(placements)), [mobile ? "bottom" : {x: 20, y: 100, h: 26}]);
                const isRoot = ids.some(id => id === "root" || id === "realRoot");
                const connectorIds = ids.filter(id => model.nodes.get(id).parentId);
                const expected = [...(editable && !isRoot ? ["cut"] : []), "copy",
                    ...(editable && ids.length === 1 ? ["mindmapPasteChild", ...(isRoot ? [] : ["mindmapPasteSibling"])] : []),
                    ...(editable && ids.length === 1 && ids[0] === "child" ? ["checkToggle"] : []),
                    ...(editable && connectorIds.length ? ["listMindmapConnectorStyle"] : []),
                    ...(editable ? ["listMindmapNodeShape"] : [])];
                assert.deepEqual(entries.map(item => item.label), expected);
                assert.equal(actions.length, 0, "opening More does not modify document content");
                entries.find(item => item.label === "cut")?.click(undefined, undefined);
                if (expected.includes("cut")) {
                    assert.equal(JSON.stringify(actions.shift()), JSON.stringify([ids, true]));
                }
                const task = entries.find(item => item.label === "checkToggle");
                if (task) {
                    (task.submenu as IMenu[])[0].click(undefined, undefined);
                    assert.deepEqual(actions.pop(), ["child", "X"]);
                }
                const connector = entries.find(item => item.id === "connectorStyle")?.submenu as IMenu[];
                if (connector) {
                    assert.deepEqual(connector.filter(item => item.checked).map(item => item.id),
                        connectorIds.length === 1 ? ["rounded"] : []);
                    connector.find(item => item.id === "inherit").click(undefined, undefined);
                    assert.deepEqual(actions.pop(), [connectorIds, {connectorStyle: undefined}]);
                }
                const shapes = entries.find(item => item.id === "nodeShape")?.submenu as IMenu[];
                if (shapes) {
                    assert.deepEqual(shapes.filter(item => item.checked).map(item => item.id),
                        ids.length > 1 ? [] : ids[0] === "child" ? ["capsule"] : ["inherit"]);
                    shapes.find(item => item.id === "rectangle").click(undefined, undefined);
                    assert.deepEqual(actions.pop(), [ids, {shape: "rectangle"}]);
                }
            }
        }
    }
});
