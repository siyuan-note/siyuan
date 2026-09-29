import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import * as ts from "typescript";

const source = ts.transpileModule(readFileSync(join(__dirname, "Wnd.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

const fixture = () => {
    const document = {activeElement: undefined as any};
    class Element {
        classes = new Set<string>();
        classList = {
            add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
            contains: (name: string) => this.classes.has(name),
        };
        isConnected = true;
        focus() { document.activeElement = this; }
        scrollIntoView() { /* 模拟菜单项滚动，不依赖浏览器布局。 */ }
    }
    const original = new Element();
    original.focus();
    const items: Array<{element: Element, options: any, click?: (event: any) => void}> = [];
    let menuName: string;
    let popupCount = 0;
    let switched: unknown;
    const menuElement = Object.assign(new Element(), {
        getAttribute: () => menuName,
        setAttribute: (_name: string, value: string) => { menuName = value; },
        contains: (element: unknown) => items.some(item => item.element === element),
        querySelector: (selector: string) => items.find(item =>
            selector === ".b3-menu__item" || item.options.current)?.element,
    });
    menuElement.classes.add("fn__none");
    const menu = {
        element: menuElement,
        removeCB: undefined as (() => void) | undefined,
        remove: () => {
            menu.removeCB?.();
            menu.removeCB = undefined;
            items.length = 0;
            menuName = undefined;
            menuElement.classes.add("fn__none");
        },
        append: () => {},
        popup: () => {
            popupCount++;
            menuElement.classes.delete("fn__none");
        },
    };
    const header = (title: string, active: boolean) => ({
        querySelector: (selector: string) => selector === ".item__text" ? {textContent: title} : null,
        classList: {contains: () => active},
    });
    const headers = [header("first", false), header("second", true)];
    const anchor = {getBoundingClientRect: () => ({left: 10, top: 20, width: 30, height: 40})};
    const exports: any = {};
    const dependencies: Record<string, object> = {
        "../constants": {Constants: {MENU_TAB_LIST: "tab-list"}},
        "../util/escape": {escapeHtml: (value: string) => value},
        "../emoji/fileTreeIcon": {getFileTreeIconHTML: () => ""},
        "../protyle/util/hasClosest": {hasClosestByClassName: () => false},
        "../menus/Menu": {MenuItem: class {
            element = new Element();
            constructor(options: any) {
                const item = {element: this.element, options, click: undefined as ((event: any) => void) | undefined};
                items.push(item);
                options.bind({addEventListener: (_type: string, callback: typeof item.click) => { item.click = callback; }});
            }
        }},
    };
    runInNewContext(source, {
        exports, document, HTMLElement: Element,
        window: {siyuan: {menus: {menu}}},
        require: (name: string) => dependencies[name] || {},
    });
    const wnd = Object.create(exports.Wnd.prototype);
    wnd.headersElement = {children: headers, parentElement: {querySelector: () => anchor}};
    wnd.switchTab = (tab: unknown) => { switched = tab; new Element().focus(); };
    wnd.showHeading = () => {};
    return {wnd, menu, items, original, document, headers, anchor,
        popupCount: () => popupCount, switched: () => switched};
};

describe("tab switcher keyboard entry", () => {
    it("opens the current pane in header order and focuses its selected tab", () => {
        const f = fixture();
        f.wnd.renderTabList(undefined, true);
        assert.deepEqual(f.items.map(item => item.options.label), ["first", "second"]);
        assert.equal(f.document.activeElement, f.items[1].element);
        assert.equal(f.items[1].element.classList.contains("b3-menu__item--current"), true);
        f.menu.remove();
        assert.equal(f.document.activeElement, f.original);
    });

    it("toggles an open menu without reopening it", () => {
        const f = fixture();
        f.wnd.renderTabList(undefined, true);
        f.wnd.renderTabList(undefined, true);
        assert.equal(f.popupCount(), 1);
        assert.equal(f.menu.element.classList.contains("fn__none"), true);
        assert.equal(f.document.activeElement, f.original);
    });

    it("does not restore the old editor after switching tabs", () => {
        const f = fixture();
        f.wnd.renderTabList(undefined, true);
        f.items[0].click({target: {}, preventDefault: () => {}, stopPropagation: () => {}});
        assert.equal(f.switched(), f.headers[0]);
        assert.notEqual(f.document.activeElement, f.original);
    });

    it("preserves mouse focus and ignores empty panes or missing anchors", () => {
        const f = fixture();
        f.wnd.renderTabList(f.anchor);
        assert.equal(f.document.activeElement, f.original);
        f.menu.remove();
        f.headers.length = 0;
        f.wnd.renderTabList(undefined, true);
        assert.equal(f.popupCount(), 1);
        f.wnd.headersElement.parentElement.querySelector = (): null => null;
        f.wnd.renderTabList(undefined, true);
        assert.equal(f.popupCount(), 1);
    });
});
