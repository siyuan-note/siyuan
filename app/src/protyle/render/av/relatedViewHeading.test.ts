import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";

const source = compileModule("src/protyle/render/av/relatedView.ts") + "\nexports.RelatedAVView = RelatedAVView;";

class Element {
    public innerHTML = "";
    public className = "";
    public dataset: Record<string, string> = {};
    public listeners: Record<string, (event: Record<string, unknown>) => void> = {};
    public addEventListener(type: string, handler: (event: Record<string, unknown>) => void) { this.listeners[type] = handler; }
    public append() {}
}

const fixture = () => {
    const imports = {
        setAVRelationHost() {}, createAVHostProtyle() {}, registerAVHostRefresh() {},
        escapeHtmlTextAndAttr: (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
        canEditAVHost: () => true, globalClickHideMenu() {},
    };
    const {RelatedAVView} = evaluateModule<{RelatedAVView: new (...args: unknown[]) => {
        element: Element; host: {active: boolean}; folded: boolean; sync: () => void; openCandidates: () => void;
    }}>(source, {
        window: {siyuan: {languages: {_attrView: {relatedDatabaseViewAdd: "Add existing entry"}}}},
        document: {createElement: () => new Element(), body: {}},
        MutationObserver: class { public observe() {} },
        require: () => imports,
    });
    const view = new RelatedAVView({id: "test"}, {}, {
        sourceAvID: "source", sourceItemID: "item", keyID: "relation", name: 'Sales <orders> & "notes"',
    }, "carrier");
    let synced = 0;
    let added = 0;
    let stopped = 0;
    view.sync = () => { synced++; };
    view.openCandidates = () => { added++; };
    const click = (action?: string) => view.element.listeners.click({
        target: {closest: (selector: string) => selector === "[data-related-action]" && action ? {dataset: {relatedAction: action}} : null},
        stopPropagation: () => { stopped++; },
    });
    return {view, click, synced: () => synced, added: () => added, stopped: () => stopped};
};

test("related heading uses one native expanding button for arrow, label and blank space, separate from add", () => {
    const f = fixture();
    const buttons = [...f.view.element.innerHTML.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
    assert.equal(buttons.length, 2);
    assert.match(buttons[0], /type="button"/);
    assert.match(buttons[0], /class="protyle-db-attr__toggle fn__flex fn__flex-1"/);
    assert.match(buttons[0], /data-related-action="fold" aria-expanded="true"/);
    assert.match(buttons[0], /<svg><use xlink:href="#iconDown"/);
    assert.match(buttons[0], /<span class="block__logo av-related-view__title fn__ellipsis fn__flex-1">Sales &lt;orders> &amp; &quot;notes&quot;<\/span>/);
    assert.doesNotMatch(buttons[0], /data-related-action="add"/);
    assert.match(buttons[1], /data-related-action="add" data-position="8west"/);
});

test("heading clicks toggle once, including while folded, while add and table clicks remain independent", () => {
    const f = fixture();
    f.view.host.active = false;
    f.click("fold");
    assert.equal(f.view.folded, true);
    f.click("fold");
    assert.equal(f.view.folded, false);
    assert.equal(f.synced(), 2);
    f.click("add");
    f.click();
    assert.equal(f.added(), 1);
    assert.equal(f.synced(), 2);
    assert.equal(f.stopped(), 4);
});

test("heading native buttons retain Enter and Space activation without bubbling into the editor", () => {
    const f = fixture();
    for (const key of ["Enter", " "]) {
        let prevented = false;
        let stopped = false;
        f.view.element.listeners.keydown({key,
            target: {closest: (selector: string) => selector.includes("button") ? {} : null},
            preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; },
        });
        assert.equal(prevented, false);
        assert.equal(stopped, true);
    }
});

test("west-facing add tooltip stays within desktop and narrow viewports and falls back near the left edge", () => {
    const tip = {style: {} as Record<string, string>, clientWidth: 120, clientHeight: 24,
        classList: {toggle() {}}, querySelector: (): null => null, removeAttribute() { this.style = {}; }};
    const window = {innerWidth: 1280, innerHeight: 800, DOMPurify: {sanitize: (value: string) => value}};
    const api = evaluateModule<typeof import("../../../dialog/tooltip")>(compileModule("src/dialog/tooltip.ts"), {
        window, document: {getElementById: () => tip, documentElement: {classList: {contains: () => false}}},
        require: () => ({isMobile: () => false, isTouchHoverInput: () => false, emitToPlugins() {}}),
    });
    for (const width of [390, 1280]) {
        window.innerWidth = width;
        for (const left of [8, width - 40]) {
            const rect = {left, right: left + 24, top: 20, height: 24};
            const target = {getBoundingClientRect: () => rect, getClientRects: () => [rect],
                getAttribute: (name: string) => name === "data-position" ? "8west" : null,
                parentElement: {getBoundingClientRect: () => rect}};
            api.showTooltip("Add existing entry", target as unknown as HTMLElement);
            const tipLeft = parseFloat(tip.style.left);
            assert.ok(tipLeft >= 0 && tipLeft + tip.clientWidth <= width);
            assert.equal(tipLeft, left === 8 ? rect.right : left - tip.clientWidth - 8);
        }
    }
});
