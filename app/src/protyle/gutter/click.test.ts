import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createSourceFile, forEachChild, isCallExpression, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest, true);
const listeners = new Map<string, string>();
const collect = (node: import("typescript").Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener") {
        const type = node.arguments[0].getText(source).slice(1, -1);
        if (type === "click" || type === "contextmenu") {
            listeners.set(type, node.arguments[1].getText(source));
        }
    }
    forEachChild(node, collect);
};
collect(source);
assert.equal(listeners.size, 2);

const fixture = (type: string, mobile: boolean, cached: Record<string, boolean>) => {
    const calls: string[] = [];
    const noop = () => {};
    const button = {
        dataset: {type: "NodeList"},
        classList: {contains: () => false},
        getAttribute: (key: string) => key === "data-node-id" ? "list-id" : "NodeList",
        getBoundingClientRect: () => ({left: 10, bottom: 30}),
    };
    const menu = {
        element: {setAttribute: noop},
        fullscreen: () => calls.push("fullscreen"),
        popup: () => calls.push("popup"),
    };
    const dependencies = {
        window: {siyuan: {...cached, menus: {menu}}},
        hasClosestByTag: () => button,
        hideTooltip: noop,
        clearSelect: noop,
        isOnlyMeta: (event: MouseEvent) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey,
        isEncryptedBox: () => false,
        zoomOut: () => calls.push("zoom"),
        openAttr: () => calls.push("attributes"),
        hasTopClosestByClassName: () => false,
        restoreGutterRange: noop,
    };
    const callback = listeners.get(type).replace(/\/\/\/ #if MOBILE\n([\s\S]*?)\/\/\/ #else\n([\s\S]*?)\/\/\/ #endif/g,
        (_match, mobileSource: string, desktopSource: string) => mobile ? mobileSource : desktopSource);
    const js = transpileModule(`const listener = ${callback};`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const gutter = {renderMenu: () => calls.push("menu"), getNodeElement: () => button};
    const handler = new Function("protyle", ...Object.keys(dependencies), `${js}\nreturn listener;`)
        .call(gutter, {wysiwyg: {element: {}}, toolbar: {range: {}}, options: {}}, ...Object.values(dependencies));
    return (modifiers: Record<string, boolean> = {}) => {
        handler({target: button, preventDefault: noop, stopPropagation: noop,
            ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers});
        return calls;
    };
};

test("block menus open after mind map undo leaves cached modifier flags set", () => {
    for (const mobile of [false, true]) {
        for (const type of ["click", "contextmenu"]) {
            for (const key of ["ctrlIsPressed", "shiftIsPressed", "altIsPressed"]) {
                assert.deepEqual(fixture(type, mobile, {[key]: true})(), ["menu", mobile ? "fullscreen" : "popup"],
                    `${type}, mobile=${mobile}, stale ${key}`);
            }
        }
    }
});

test("block icon clicks still honor modifiers carried by the mouse event", () => {
    for (const mobile of [false, true]) {
        assert.deepEqual(fixture("click", mobile, {})({metaKey: true}), ["zoom"]);
        assert.deepEqual(fixture("click", mobile, {})({ctrlKey: true}), ["zoom"]);
        assert.deepEqual(fixture("click", mobile, {})({shiftKey: true}), ["attributes"]);
        for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
            assert.deepEqual(fixture("contextmenu", mobile, {})({[modifier]: true}), []);
        }
    }
});
