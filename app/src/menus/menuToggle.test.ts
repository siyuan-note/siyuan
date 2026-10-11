import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {loadMenuToggle, menuAnchor} = require("../../tests/menu-toggle-fixture.cjs");

const fixture = () => {
    let visible = false;
    let sheet = false;
    const attributes = new Map<string, string>();
    let builds = 0;
    const shows: string[] = [];
    let restoreKeyboard: () => void;
    const menu = {
        data: undefined as Element,
        element: {classList: {contains: (name: string) => name === "fn__none" ? !visible : name === "b3-menu--sheet" && sheet},
            getAttribute: (key: string) => attributes.get(key),
            setAttribute: (key: string, value: string) => attributes.set(key, value)},
        remove() { visible = false; menu.data = undefined; attributes.clear(); },
        popup() { visible = true; sheet = false; shows.push("popup"); },
        closeSheet() { menu.remove(); restoreKeyboard?.(); },
        fullscreen(position = "all", restore?: () => void) {
            visible = true; sheet = true; shows.push(position); restoreKeyboard = restore;
        },
        addItem() { builds++; },
    };
    const globals = {window: {siyuan: {menus: {menu}}}};
    const helpers = loadMenuToggle(globals) as typeof import("./menuToggle");
    const exports = {} as typeof import("../plugin/Menu");
    runInNewContext(transpileModule(readFileSync("src/plugin/Menu.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {...globals, exports, require: () => helpers});
    const open = (target: Element, toggle?: boolean) => helpers.toggleMenu({
        target, toggle, build: () => { builds++; }, show: () => menu.popup(),
    });
    return {...helpers, Menu: exports.Menu, open, menu, shows, builds: () => builds, visible: () => visible,
        restoreKeyboard: () => restoreKeyboard};
};

test("the same trigger closes without rebuilding; another trigger opens immediately", () => {
    const f = fixture();
    const a = menuAnchor(), b = menuAnchor();
    f.open(a);
    f.open(a);
    assert.equal(f.visible(), false);
    assert.equal(f.builds(), 1);
    f.open(a);
    f.open(b);
    assert.equal(f.menu.data, b);
    assert.equal(f.visible(), true);
    assert.equal(f.builds(), 3);
});

test("SVG children normalize to the button, without treating a containing row as the same trigger", () => {
    const f = fixture();
    const button = menuAnchor(), row = menuAnchor();
    f.open(button);
    f.open({closest: () => button} as unknown as Element);
    assert.equal(f.visible(), false);
    f.open(row, false);
    f.open(button);
    assert.equal(f.menu.data, button);
    assert.equal(f.visible(), true);
    assert.equal(row.marked, false);
});

test("outside dismissal permits reopening and context menus reopen without marking their row", () => {
    const f = fixture();
    const anchor = menuAnchor();
    f.open(anchor);
    f.menu.remove();
    f.open(anchor);
    assert.equal(f.visible(), true);
    const row = menuAnchor();
    f.open(row, false);
    f.open(row, false);
    assert.equal(f.visible(), true);
    assert.equal(f.menu.data, row);
    assert.equal(row.marked, false);
});

test("pending menus can be cancelled, switched and dismissed before their response builds the menu", () => {
    const f = fixture();
    const a = menuAnchor(), b = menuAnchor();
    const replies: (() => void)[] = [];
    const request = (target: Element) => f.toggleMenu({target, build: (_menu, session) => {
        replies.push(() => {
            if (!session.isCurrent()) { return; }
            f.menu.remove();
            f.menu.addItem();
            session.show(() => f.menu.popup());
        });
    }});
    request(a);
    request(a);
    replies[0]();
    assert.equal(f.builds(), 0);
    request(a);
    request(b);
    replies[1]();
    assert.equal(f.builds(), 0);
    f.menu.remove();
    replies[2]();
    assert.equal(f.builds(), 0);
    request(a);
    replies[3]();
    assert.equal(f.visible(), true);
    assert.equal(f.menu.data, a);
});

test("mobile sheets retain their requested position and keyboard restoration callback", () => {
    const f = fixture();
    const anchor = menuAnchor();
    let restored = 0;
    const restore = () => { restored++; };
    f.toggleMenu({target: anchor, build: () => {}, show: menu => menu.fullscreen("bottom", restore)});
    assert.equal(f.restoreKeyboard(), restore);
    assert.deepEqual(f.shows, ["bottom"]);
    f.toggleMenu({target: anchor, build: () => {}, show: menu => menu.fullscreen("bottom")});
    assert.deepEqual(f.shows, ["bottom"]);
    assert.equal(restored, 1);
});

test("plugin toggle decides before constructing; legacy AV fixed-id construction still closes across targets", () => {
    const f = fixture();
    const a = menuAnchor(), b = menuAnchor();
    const open = (target: Element) => f.Menu.toggle({target, id: "shared", build: menu => menu.addItem({}),
        show: menu => menu.open({x: 1, y: 2})});
    open(a);
    open(b);
    assert.equal(f.menu.data, b);
    assert.equal(f.visible(), true);
    open(b);
    assert.equal(f.visible(), false);
    const first = new f.Menu("av-column");
    assert.equal(first.isOpen, false);
    first.addItem({});
    first.open({x: 1, y: 2});
    const second = new f.Menu("av-column");
    assert.equal(second.isOpen, true);
    second.addItem({});
    second.open({x: 3, y: 4});
    assert.equal(f.visible(), false);
    const third = new f.Menu("av-column");
    assert.equal(third.isOpen, false);
});
