import * as assert from "node:assert/strict";
import {test} from "node:test";
import {
    configureBacklinkTypeFold,
    getBacklinkTypeFoldKey,
    normalizeBacklinkFoldTypes,
    setBacklinkTypeFoldExpandHandler,
    updateBacklinkTypeFolds,
} from "./backlinkTypeFold";

class ElementFixture {
    public dataset: Record<string, string> = {};
    public nextElementSibling: ElementFixture;
    public button: ElementFixture;
    public className = "";
    public type = "";
    public innerHTML = "";
    public onclick: (event: {preventDefault: () => void, stopPropagation: () => void}) => void;
    public attributes = new Map<string, string>();
    public classList = {contains: (name: string) => this.className.split(" ").includes(name)};
    public owner: ElementFixture;
    public text = "";

    public querySelector() { return this.button; }
    public prepend(button: ElementFixture) { this.button = button; button.owner = this; }
    public appendChild(text: string) { this.text = text; }
    public addEventListener() { /* 测试只模拟按钮点击。 */ }
    public setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    public getAttribute(key: string) { return this.attributes.get(key) ?? null; }
    public hasAttribute(key: string) { return this.attributes.has(key); }
    public toggleAttribute(key: string, enabled: boolean) {
        if (enabled) {
            this.attributes.set(key, "");
        } else {
            this.attributes.delete(key);
        }
    }
    public remove() { this.owner.button = undefined; }
}

const makeOccurrence = (id: string, type: string) => {
    const anchor = new ElementFixture();
    anchor.dataset = {backlinkId: id, backlinkType: type};
    anchor.className = "protyle-breadcrumb__bar";
    const content = new ElementFixture();
    anchor.nextElementSibling = content;
    return {anchor, content};
};

test("normalizes supported types and distinguishes item identities and policy generations", () => {
    assert.deepEqual(normalizeBacklinkFoldTypes(["NodeAttributeView", "unknown", "NodeAttributeView"]), ["NodeAttributeView"]);
    assert.deepEqual(normalizeBacklinkFoldTypes(null), []);
    assert.notEqual(getBacklinkTypeFoldKey("a", "NodeHeading"), getBacklinkTypeFoldKey("b", "NodeHeading"));
    assert.notEqual(getBacklinkTypeFoldKey("a", "NodeHeading"), getBacklinkTypeFoldKey("a", "NodeHeading", 1));
});

test("collapses whole occurrences, preserves neighbors and source folds, and restores manual choices", t => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousDocument = globals.document;
    const previousWindow = globals.window;
    globals.document = {createElement: () => new ElementFixture(), createTextNode: (text: string) => text};
    globals.window = {siyuan: {languages: {database: "Database", expand: "Expand", collapse: "Collapse"}}};
    t.after(() => {
        globals.document = previousDocument;
        globals.window = previousWindow;
    });
    const database = makeOccurrence("database", "NodeAttributeView");
    const heading = makeOccurrence("heading", "NodeHeading");
    database.content.nextElementSibling = heading.anchor;
    heading.content.setAttribute("fold", "1");
    const anchors = [database.anchor, heading.anchor];
    const protyle = {wysiwyg: {element: {querySelectorAll: () => anchors}}} as unknown as IProtyle;
    const expanded: string[] = [];
    setBacklinkTypeFoldExpandHandler(protyle, id => expanded.push(id));
    const values = new Map<string, unknown>();
    const store = {
        get: <T>(key: string) => values.get(key) as T,
        set: <T>(key: string, value: T) => { values.set(key, value); },
        remove: (key: string) => { values.delete(key); },
    };
    configureBacklinkTypeFold(protyle, [], store);
    assert.equal(database.anchor.button, undefined);
    configureBacklinkTypeFold(protyle, ["NodeAttributeView"], store);
    assert.equal(database.content.attributes.has("data-backlink-type-folded"), true);
    assert.equal(heading.content.attributes.has("data-backlink-type-folded"), false);
    assert.equal(heading.content.getAttribute("fold"), "1");
    assert.equal(database.anchor.button.getAttribute("aria-expanded"), "false");
    database.anchor.button.onclick({preventDefault() {}, stopPropagation() {}});
    assert.deepEqual(expanded, ["database"]);
    assert.equal(database.content.attributes.has("data-backlink-type-folded"), false);
    updateBacklinkTypeFolds(protyle);
    assert.deepEqual(expanded, ["database"]);
    assert.equal(database.anchor.button.getAttribute("aria-expanded"), "true");

    const replacement = makeOccurrence("database", "NodeAttributeView");
    anchors[0] = replacement.anchor;
    configureBacklinkTypeFold(protyle, ["NodeAttributeView"], store);
    assert.equal(replacement.anchor.button.getAttribute("aria-expanded"), "true");
    store.set("type-fold-generation:NodeAttributeView", 1);
    updateBacklinkTypeFolds(protyle);
    assert.equal(replacement.anchor.button.getAttribute("aria-expanded"), "false");
    configureBacklinkTypeFold(protyle, [], store);
    assert.equal(replacement.anchor.button, undefined);
    assert.equal(replacement.content.attributes.has("data-backlink-type-folded"), false);
});
