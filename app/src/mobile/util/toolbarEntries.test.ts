import * as assert from "node:assert/strict";
import {test} from "node:test";
import {applyMobileToolbarEntries} from "./toolbarEntries";
import {getDefaultToolbar, getPluginToolbarEntryKey, markPluginToolbarEntries} from "../../protyle/toolbar/defaults";

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

test("mobile toolbar keeps navigation reachable and removes empty separators", () => {
    const root = new ToolbarElement();
    const back = new ToolbarElement("goback");
    const family = new ToolbarElement("font-family");
    const size = new ToolbarElement("font-size");
    const first = new ToolbarElement(undefined, "separator_1");
    const second = new ToolbarElement(undefined, "separator_2");
    root.children = [back, first, family, second, size];
    const toolbar = getDefaultToolbar(true);
    const order = ["separator_1", "font-family", "separator_2", "font-size"];
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: key => key !== "font-family"});
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [back, size]);
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: () => false});
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [back]);
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {
        order: ["font-size", "separator_1", "font-family", "separator_2"], isVisible: () => true,
    });
    assert.deepEqual(root.children.filter(item => !item.classList.contains("fn__none")), [back, size, first, family]);
});

test("mobile toolbar applies plugin visibility and restores its configured order", () => {
    const defaults = getDefaultToolbar(true);
    const plugin = {name: "plugin-action"};
    const toolbar = markPluginToolbarEntries(defaults, [...defaults, plugin], "example", () => "Example");
    const key = getPluginToolbarEntryKey("example", "plugin-action");
    const root = new ToolbarElement();
    const back = new ToolbarElement("goback");
    const family = new ToolbarElement("font-family");
    const custom = new ToolbarElement(plugin.name);
    root.children = [back, family, custom];
    const order = [key, "font-family"];
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: id => id !== key});
    assert.equal(custom.dataset.id, key);
    assert.deepEqual(root.children, [back, custom, family]);
    assert.equal(custom.classList.contains("fn__none"), true);
    applyMobileToolbarEntries(root as unknown as HTMLElement, toolbar, {order, isVisible: () => true});
    assert.deepEqual(root.children, [back, custom, family]);
    assert.equal(custom.classList.contains("fn__none"), false);
});
