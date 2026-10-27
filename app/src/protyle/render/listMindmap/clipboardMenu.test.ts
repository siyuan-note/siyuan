import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";

test("desktop and mobile More menus keep cut first and preserve paste restrictions and task status actions", () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
        ScriptTarget.ES2021, true);
    let callback = "";
    const visit = (node: import("typescript").Node) => {
        if (isPropertyAssignment(node) && node.name.getText(source) === "onClipboardMenu") {
            callback = node.initializer.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(callback);
    const compiled = transpileModule(`class Controller {openMore = ${callback};} globalThis.Controller = Controller;`,
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    for (const mobile of [false, true]) {
        for (const ids of [["child"], ["root"], ["child", "second"]]) {
            for (const editable of [true, false]) {
                const entries: IMenu[] = [];
                const actions: unknown[] = [];
                const placements: unknown[] = [];
                const anchor = {getBoundingClientRect: () => ({left: 20, bottom: 100, height: 26})};
                const model = {nodes: new Map([["root", {virtual: true}], ["child", {taskMarker: " "}], ["second", {}]])};
                const context: any = {
                    owner: {}, list: {}, canEdit: () => editable, readListMindmap: () => model,
                    canCutMindmapBranches: (_model: unknown, selected: string[]) => !selected.includes("root"),
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
                });
                target.openMore(anchor, ids);
                assert.deepEqual(JSON.parse(JSON.stringify(placements)), [mobile ? "bottom" : {x: 20, y: 100, h: 26}]);
                const expected = [...(editable && !ids.includes("root") ? ["cut"] : []), "copy",
                    ...(editable && ids.length === 1 ? ["mindmapPasteChild", ...(ids[0] === "root" ? [] : ["mindmapPasteSibling"])] : []),
                    ...(editable && ids.length === 1 && ids[0] === "child" ? ["checkToggle"] : [])];
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
            }
        }
    }
});
