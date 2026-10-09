import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {isContainerGutterBridge} from "../../protyle/gutter/container";

const source = transpileModule(readFileSync("src/boot/globalEvent/mousemove.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (location: "editor" | "popover" | "backlink") => {
    let hidden = false;
    const block = {getBoundingClientRect: () => ({left: 140, top: 100, bottom: 150})};
    const container = {
        dataset: {type: "NodeBlockQueryEmbed"},
        classList: {contains: () => false},
        contains: (element: unknown) => element === block,
        getBoundingClientRect: () => ({left: 130, top: 80, bottom: 150}),
    };
    const button = {dataset: {type: "NodeParagraph"}};
    const embedButton = {dataset: {type: "NodeBlockQueryEmbed"}};
    const root = {
        nodeType: 1,
        classList: {contains: (name: string) => name === "protyle-wysiwyg"},
        style: {paddingLeft: "130px"},
        getBoundingClientRect: () => ({left: 0}),
        contains: (element: unknown) => element === root,
        closest: (): null => null,
    };
    const calls: unknown[] = [];
    const protyle = {
        wysiwyg: {element: root},
        gutter: {
            element: {
                classList: {contains: () => hidden},
                getBoundingClientRect: () => ({left: 90, top: 110, bottom: 134}),
                querySelectorAll: () => [embedButton, button],
            },
            getNodeElement: (_protyle: unknown, item: unknown) => item === embedButton ? container : block,
            render: (_protyle: unknown, element: unknown) => calls.push(element),
        },
    };
    const modules: Record<string, unknown> = {
        "../../layout/getAll": {
            getAllModels: () => ({
                editor: location === "editor" ? [{editor: {protyle}}] : [],
                backlink: location === "backlink" ? [{editors: [{protyle}]}] : [],
            }),
        },
        "../../protyle/util/hasClosest": {hasClosestBlock: () => container},
        "../../protyle/gutter/container": {isContainerGutterBridge},
    };
    const api: {windowMouseMove: (event: MouseEvent) => void} = {windowMouseMove: () => {}};
    runInNewContext(source, {
        exports: api,
        require: (name: string) => modules[name] || {},
        window: {siyuan: {layout: {}, blockPanels: location === "popover" ? [{editors: [{protyle}]}] : []}},
        document: {
            body: {classList: {contains: () => false}},
            getElementById: (): null => null,
            elementFromPoint: () => container,
        },
    });
    return {
        calls, container,
        hide: () => { hidden = true; },
        move: (x: number, y = 120) => api.windowMouseMove({
            target: root, clientX: x, clientY: y, composedPath: () => [root],
        } as unknown as MouseEvent),
    };
};

test("editor padding preserves embedded content gutters in editors, popovers and backlinks", () => {
    for (const location of ["editor", "popover", "backlink"] as const) {
        const f = fixture(location);
        for (const x of [129, 110, 90]) {
            f.move(x);
        }
        assert.equal(f.calls.length, 0, location);
        f.move(89);
        f.move(110, 90);
        f.hide();
        f.move(110);
        assert.equal(f.calls.length, 3, location);
        assert.ok(f.calls.every(element => element === f.container));
    }
});
