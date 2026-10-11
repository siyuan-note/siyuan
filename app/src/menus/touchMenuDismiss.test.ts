import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string) => transpileModule(readFileSync(__dirname + file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const source = compile("/menuClick.ts");
const closestSource = compile("/../protyle/util/hasClosest.ts");

const fixture = () => {
    class Element {
        nodeType = 1;
        classes = new Set<string>();
        attributes = new Map<string, string>();
        classList = {contains: (name: string) => this.classes.has(name)};
        constructor(public parentElement?: Element) {}
        getAttribute(name: string) { return this.attributes.get(name); }
        contains(target: Element): boolean {
            return target === this || Boolean(target?.parentElement && this.contains(target.parentElement));
        }
    }
    const menuElement = new Element();
    const inside = new Element(menuElement);
    const editor = new Element();
    editor.classes.add("protyle-wysiwyg");
    const content = new Element(editor);
    const keeper = new Element();
    keeper.attributes.set("data-menu", "true");
    const keeperChild = new Element(keeper);
    let removed = 0;
    let handler: (event: PointerEvent) => void;
    const document = {
        activeElement: content,
        addEventListener(type: string, callback: typeof handler, options: AddEventListenerOptions) {
            assert.equal(type, "pointerdown");
            assert.equal(options.capture, true);
            assert.equal(options.passive, true);
            handler = callback;
        },
    };
    const menu = {element: menuElement, remove: () => removed++};
    const window = {siyuan: {menus: {menu}}};
    const selection = {rangeCount: 0, getRangeAt: () => ({startContainer: inside})};
    const closest = {};
    runInNewContext(closestSource, {exports: closest});
    const exports = {} as typeof import("./menuClick");
    runInNewContext(source, {exports, document, window, getSelection: () => selection, require: () => closest});
    exports.bindTouchMenuDismiss();
    const down = (target = content, pointerType = "touch") => {
        const event = new Event("pointerdown", {cancelable: true});
        Object.defineProperties(event, {target: {value: target}, pointerType: {value: pointerType}});
        handler(event as PointerEvent);
        assert.equal(event.defaultPrevented, false);
    };
    return {down, menuElement, inside, editor, content, keeperChild, document, selection, removed: () => removed};
};

test("outside touch and pen presses dismiss popups without a compatibility click", () => {
    for (const pointerType of ["touch", "pen"]) {
        const f = fixture();
        f.down(f.content, pointerType);
        f.down(f.editor, pointerType);
        assert.equal(f.removed(), 2);
        assert.equal(f.document.activeElement, f.content);
    }
});

test("mouse presses, menu items and data-menu controls preserve their existing handlers", () => {
    const f = fixture();
    f.down(f.content, "mouse");
    f.down(f.inside);
    f.down(f.keeperChild);
    assert.equal(f.removed(), 0);
});

test("hidden and fullscreen menus retain their dedicated lifecycle", () => {
    for (const cls of ["fn__none", "b3-menu--fullscreen"]) {
        const f = fixture();
        f.menuElement.classes.add(cls);
        f.down();
        assert.equal(f.removed(), 0);
    }
});

test("selection inside a focused menu retains the existing dismissal guard", () => {
    const f = fixture();
    f.selection.rangeCount = 1;
    f.document.activeElement = f.inside;
    f.down();
    assert.equal(f.removed(), 0);
    f.document.activeElement = f.content;
    f.down();
    assert.equal(f.removed(), 1);
});
