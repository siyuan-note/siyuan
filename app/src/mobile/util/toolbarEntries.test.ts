import * as assert from "node:assert/strict";
import {test} from "node:test";
import {applyMobileToolbarEntries} from "./toolbarEntries";
import {getDefaultToolbar, getPluginToolbarEntryKey, markPluginToolbarEntries} from "../../protyle/toolbar/defaults";
import {getEntryCatalogChildren} from "../../config/entryVisibility/catalog";
import {resolveEntryOrder} from "../../config/entryVisibility/order";

test("mobile default actions start with add and block without replacing saved order", () => {
    const catalog = getEntryCatalogChildren("editor.toolbar");
    const defaults = catalog.map(item => item.key);
    assert.deepEqual(defaults.slice(0, 6), [
        "mobile-add", "mobile-block", "mobile-outdent", "mobile-indent", "mobile-copy", "mobile-cut",
    ]);
    const saved = ["mobile-copy", "mobile-indent", "mobile-block", "mobile-add", "mobile-outdent"];
    const order = resolveEntryOrder(defaults, saved,
        new Set(catalog.filter(item => item.type === "separator").map(item => item.key)));
    assert.deepEqual(order.filter(key => saved.includes(key)), saved);
});

test("mobile block type availability and visibility do not change the existing block menu", () => {
    const root = new ToolbarElement();
    const type = new ToolbarElement("block-type");
    const block = new ToolbarElement("block");
    root.children = [type, block];
    const apply = (available: boolean, visible = true) => applyMobileToolbarEntries(root as unknown as HTMLElement,
        getDefaultToolbar(true), {order: ["block-type", "mobile-block"],
            isVisible: key => key !== "block-type" || visible,
            isAvailable: name => name !== "block-type" || available});
    apply(false);
    assert.equal(type.classList.contains("fn__none"), true);
    assert.equal(block.classList.contains("fn__none"), false);
    assert.equal(block.dataset.id, "mobile-block");
    apply(true);
    assert.equal(type.classList.contains("fn__none"), false);
    apply(true, false);
    assert.equal(type.classList.contains("fn__none"), true);
    assert.equal(block.classList.contains("fn__none"), false);
});

class ToolbarElement {
    public children: ToolbarElement[] = [];
    public dataset: {type?: string; id?: string};
    private classes = new Set<string>();
    public classList = {
        contains: (name: string) => this.classes.has(name),
        toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };

    constructor(type?: string, separator?: string) {
        this.dataset = {type};
        if (separator) {
            this.dataset.id = separator;
            this.classes.add("keyboard__split");
        }
    }

    public append(item: ToolbarElement) {
        this.children = this.children.filter(child => child !== item);
        this.children.push(item);
    }
}

test("shared toolbar restores document entries after editing a restricted fragment", () => {
    const root = new ToolbarElement();
    const bold = new ToolbarElement("strong");
    const tag = new ToolbarElement("tag");
    const separator = new ToolbarElement(undefined, "separator_1");
    root.children = [bold, separator, tag];
    const options = {order: ["strong", "separator_1", "tag"], isVisible: () => true};
    applyMobileToolbarEntries(root as unknown as HTMLElement, ["strong"], options);
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [bold]);
    applyMobileToolbarEntries(root as unknown as HTMLElement, getDefaultToolbar(true), options);
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [bold, separator, tag]);
});

test("mobile toolbar removes leading, trailing and empty separators", () => {
    const root = new ToolbarElement();
    const family = new ToolbarElement("font-family");
    const size = new ToolbarElement("font-size");
    const first = new ToolbarElement(undefined, "separator_1");
    const second = new ToolbarElement(undefined, "separator_2");
    root.children = [first, family, second, size];
    const toolbar = getDefaultToolbar(true);
    const order = ["separator_1", "font-family", "separator_2", "font-size"];
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: key => key !== "font-family"});
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [size]);
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: () => false});
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), []);
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {
        order: ["font-size", "separator_1", "font-family", "separator_2"], isVisible: () => true,
    });
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [size, first, family]);
});

test("mobile toolbar follows font visibility changes while preserving formatting entries", () => {
    const root = new ToolbarElement();
    const family = new ToolbarElement("font-family");
    const size = new ToolbarElement("font-size");
    const appearance = new ToolbarElement("text");
    const bold = new ToolbarElement("strong");
    const separator = new ToolbarElement(undefined, "separator_1");
    root.children = [family, size, separator, appearance, bold];
    applyMobileToolbarEntries(root as unknown as HTMLElement, getDefaultToolbar(true), {
        order: ["font-family", "font-size", "separator_1", "text", "strong"],
        isVisible: key => !["font-family", "font-size"].includes(key),
    });
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [appearance, bold]);
    applyMobileToolbarEntries(root as unknown as HTMLElement, getDefaultToolbar(true), {
        order: ["font-family", "font-size", "separator_1", "text", "strong"],
        isVisible: () => true,
    });
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")),
        [family, size, separator, appearance, bold]);
});

test("mobile toolbar applies plugin visibility and restores its configured order", () => {
    const defaults = getDefaultToolbar(true);
    const plugin = {name: "plugin-action"};
    const toolbar = markPluginToolbarEntries(defaults, [...defaults, plugin], "example", () => "Example");
    const key = getPluginToolbarEntryKey("example", "plugin-action");
    const root = new ToolbarElement();
    const family = new ToolbarElement("font-family");
    const custom = new ToolbarElement(plugin.name);
    root.children = [family, custom];
    const order = [key, "font-family"];
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: id => id !== key});
    assert.equal(custom.dataset.id, key);
    assert.deepEqual(root.children, [custom, family]);
    assert.equal(custom.classList.contains("fn__none"), true);
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: () => true});
    assert.deepEqual(root.children, [custom, family]);
    assert.equal(custom.classList.contains("fn__none"), false);
});

test("mobile actions merge into saved formatting order and honor availability and visibility", () => {
    const catalog = getEntryCatalogChildren("editor.toolbar");
    const order = resolveEntryOrder(catalog.map(item => item.key), ["em", "strong", "a"],
        new Set(catalog.filter(item => item.type === "separator").map(item => item.key)));
    assert.ok(order.indexOf("em") < order.indexOf("strong"));
    assert.ok(order.includes("mobile-undo"));
    assert.ok(order.includes("mobile-heading1"));
    const root = new ToolbarElement();
    const bold = new ToolbarElement("strong");
    const italic = new ToolbarElement("em");
    const undo = new ToolbarElement("undo");
    const heading = new ToolbarElement("heading1");
    root.children = [bold, italic, undo, heading];
    applyMobileToolbarEntries(root as unknown as HTMLElement, getDefaultToolbar(true), {
        order, isVisible: key => key !== "mobile-undo", isAvailable: name => name !== "heading1",
    });
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [italic, bold]);
    assert.equal(undo.dataset.id, "mobile-undo");
    assert.equal(heading.dataset.id, "mobile-heading1");
});
