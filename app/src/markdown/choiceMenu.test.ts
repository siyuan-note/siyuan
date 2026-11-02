import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createMarkdownSubmenu} from "./choiceMenu";

// Exercise submenu sizing without depending on a running Electron display.
test("Markdown submenu includes its borders and remeasures after a constrained opening", () => {
    const previous = new Map<string, PropertyDescriptor>();
    const setGlobal = (name: string, value: unknown) => {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, {value, configurable: true});
    };
    const menu = {
        style: {maxHeight: "", top: "", left: ""}, scrollHeight: 104, offsetHeight: 106, clientHeight: 104,
        getBoundingClientRect: () => ({width: 220}), append: () => {}, contains: () => false,
    };
    class Entry extends EventTarget {
        childNodes: Node[] = [];
        className = "";
        innerHTML = "";
        tabIndex = 0;
        classList = {add: () => {}, remove: () => {}};
        attributes = new Map<string, string>();
        setAttribute(name: string, value: string) {this.attributes.set(name, value);}
        getAttribute(name: string) {return this.attributes.get(name);}
        querySelector(selector: string) {return selector === ".b3-menu__label" ? {textContent: ""} : menu;}
        getBoundingClientRect() {return {top: 20, right: 100, left: 0};}
        closest(): undefined {return undefined;}
        contains() {return false;}
    }
    const entry = new Entry();
    setGlobal("document", new EventTarget());
    setGlobal("window", new EventTarget());
    setGlobal("innerWidth", 800);
    setGlobal("innerHeight", 100);
    let submenu: ReturnType<typeof createMarkdownSubmenu>;
    try {
        submenu = createMarkdownSubmenu({element: entry as unknown as HTMLElement, label: "Mode", icon: "iconEdit"});
        entry.dispatchEvent(new Event("click"));
        assert.equal(menu.style.maxHeight, "72px", "constrained menus still scroll within the viewport");
        submenu.close();
        Object.defineProperty(globalThis, "innerHeight", {value: 800, configurable: true});
        entry.dispatchEvent(new Event("click"));
        assert.equal(menu.style.maxHeight, "106px", "content plus both borders fit without a spurious scrollbar");
        assert.equal(menu.style.left, "100px");
    } finally {
        submenu?.destroy();
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
});
