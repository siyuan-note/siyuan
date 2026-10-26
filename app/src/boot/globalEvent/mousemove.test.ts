import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {renderGutterOnHover} from "../../protyle/gutter/hover";

const buildGlobals = ["SIYUAN_VERSION", "NODE_ENV"].map(name => ({
    name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
}));
buildGlobals.forEach(({name}) => Object.defineProperty(globalThis, name, {value: "test", configurable: true}));
const {isContainerGutterBridge} = require("../../protyle/gutter/container") as typeof import("../../protyle/gutter/container");
buildGlobals.forEach(({name, descriptor}) => {
    if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, name);
    }
});

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
        "../../protyle/gutter/hover": {renderGutterOnHover},
    };
    const api: {windowMouseMove: (event: MouseEvent) => void} = {windowMouseMove: () => {}};
    runInNewContext(source, {
        exports: api,
        getComputedStyle: () => ({paddingLeft: root.style.paddingLeft}),
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

test("editable embedded tables expose column resize handles while readonly and custom tables do not", () => {
    for (const embedded of [false, true]) {
        for (const editable of [false, true]) {
            for (const custom of [false, true]) {
                const attributes = new Map<string, string>();
                const resize = {
                    parentElement: {style: {left: ""}},
                    setAttribute: (name: string, value: string) => attributes.set(name, value),
                };
                const cell = {
                    colSpan: 1, offsetLeft: 100, offsetWidth: 100, previousElementSibling: {},
                    getBoundingClientRect: () => ({left: 100, right: 200}),
                };
                const table = {
                    clientHeight: 80,
                    getAttribute: () => editable ? "true" : "false",
                    querySelector: (selector: string) => selector === "colgroup" ? {clientHeight: 80} : null,
                };
                const block = {
                    style: {cursor: "", textAlign: ""}, firstElementChild: {scrollLeft: 20},
                    querySelector: (selector: string) => selector === "table" ? table : resize,
                };
                const target = {nodeType: 1, classList: {contains: () => false}};
                const dependencies = {
                    hasClosestByClassName: (_element: unknown, name: string) => {
                        if (name === "table") {
                            return block;
                        }
                        return name === "protyle" || name === "protyle-wysiwyg__embed" && embedded ||
                            name === "protyle-custom" && custom;
                    },
                    hasClosestByTag: () => cell,
                    getColIndex: () => 1,
                };
                const api = {} as {windowMouseMove: (event: unknown) => void};
                runInNewContext(source, {
                    exports: api, require: () => dependencies,
                    window: {siyuan: {layout: {}}},
                    document: {body: {classList: {contains: () => false}}, getElementById: (): null => null},
                });
                for (const [clientX, index, left] of [[199, "1", 177], [101, "0", 77]] as const) {
                    api.windowMouseMove({target, clientX, composedPath: () => [target]});
                    if (editable && !custom) {
                        assert.equal(attributes.get("data-col-index"), index);
                        assert.match(attributes.get("style"), new RegExp(`height:80px;left: ${left}px;display:block`));
                    } else {
                        assert.equal(attributes.size, 0);
                    }
                }
                if (editable && !custom) {
                    api.windowMouseMove({target, clientX: 150, composedPath: () => [target]});
                    assert.equal(attributes.get("style"), "display:none");
                }
            }
        }
    }
});
