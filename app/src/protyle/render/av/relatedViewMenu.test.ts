import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";

const relatedSource = compileModule("src/protyle/render/av/relatedView.ts") +
    "\nexports.RelatedAVView = RelatedAVView;";
const clickSource = compileModule("src/menus/menuClick.ts");
const toggleSource = compileModule("src/menus/menuToggle.ts");

class Target {
    public dataset: Record<string, string> = {};
    public menu = false;
    constructor(type?: string, public parent?: Target) {
        if (type) this.dataset.type = type;
    }
    public closest(selector: string): Target {
        if (selector === '[data-menu="true"]' && this.menu ||
            selector === "[data-type]" && this.dataset.type ||
            selector === '[data-type="av-switcher"]' && this.dataset.type === "av-switcher") return this;
        return this.parent?.closest(selector);
    }
    public setAttribute(name: string, value: string) {
        if (name === "data-menu") this.menu = value === "true";
    }
    public getBoundingClientRect() { return {left: 10, bottom: 30, height: 20}; }
}

const fixture = (sheet = false) => {
    let visible = false;
    let stopped = 0;
    let invalidated = 0;
    let touchDown: (event: {pointerType: string; target: Target}) => void;
    const items: IMenu[] = [];
    const inside = new Target();
    const menu = {
        data: undefined as Target,
        element: {
            contains: (target: Target) => target === inside,
            classList: {contains: (name: string) => name === "fn__none" ? !visible :
                name === "b3-menu--sheet" && sheet},
        },
        remove() { visible = false; menu.data = undefined; },
        closeSheet() { menu.remove(); },
    };
    const context = {
        window: {siyuan: {menus: {menu}, languages: {avTemporarySort: "Temporary sort", asc: "ASC", desc: "DESC"}}},
        document: {activeElement: null as HTMLElement | null, addEventListener: (_type: string, handler: typeof touchDown) => { touchDown = handler; }},
        getSelection: () => ({rangeCount: 0}),
    };
    const clickAPI = evaluateModule<typeof import("../../../menus/menuClick")>(clickSource, {...context,
        require: () => ({hasClosestByAttribute: (target: Target) => !!target.closest('[data-menu="true"]')}),
    });
    const toggleAPI = evaluateModule<typeof import("../../../menus/menuToggle")>(toggleSource, context);
    const imports: Record<string, unknown> = {
        "../../../menus/menuClick": clickAPI,
        "../../../menus/menuToggle": toggleAPI,
        "../../../plugin/Menu": {Menu: class {
            constructor() { menu.remove(); items.length = 0; }
            public addItem(item: IMenu) { items.push(item); }
            public addSeparator() {}
            public open() { visible = true; }
        }},
        "./virtualScroll": {getAVData: () => ({views: [{id: "table", type: "table", name: "Table"}]})},
        "./view": {getFieldsByData: () => [{id: "notes", name: "Notes", type: "text"}]},
        "./col": {getColIconByType: () => "iconText"},
        "./capabilities": {hasAVCapability: () => true},
    };
    const {RelatedAVView} = evaluateModule<{RelatedAVView: {prototype: object}}>(relatedSource, {...context,
        require: (id: string) => imports[id] || {},
    });
    const view = Object.assign(Object.create(RelatedAVView.prototype), {
        host: {active: true}, hostElement: {}, invalidate: () => { invalidated++; },
    });
    clickAPI.bindTouchMenuDismiss();
    return {menu, items, inside, view, isVisible: () => visible, stopped: () => stopped,
        invalidated: () => invalidated, dismiss: clickAPI.globalClickHideMenu,
        click: (target: Target) => view.click({target, stopPropagation: () => { stopped++; }}),
        touch: (target: Target) => touchDown({pointerType: "touch", target}),
    };
};

for (const sheet of [false, true]) {
    test(`related sort menu dismisses on blank clicks and reopens (${sheet ? "sheet" : "desktop"})`, () => {
        const f = fixture(sheet);
        const sort = new Target("av-sort");
        f.click(sort);
        assert.equal(f.isVisible(), true);
        f.click(new Target());
        assert.equal(f.isVisible(), false);
        f.click(sort);
        assert.equal(f.isVisible(), true);
        f.click(sort);
        assert.equal(f.isVisible(), false);
        assert.equal(f.stopped(), 4);
    });

    test(`related menu switches anchors and preserves submenu actions (${sheet ? "sheet" : "desktop"})`, () => {
        const f = fixture(sheet);
        f.click(new Target("av-sort"));
        const switcher = new Target("av-switcher");
        f.click(new Target(undefined, switcher));
        assert.equal(f.menu.data, switcher);
        assert.equal(f.isVisible(), true);
        f.click(new Target("av-sort"));
        f.dismiss(f.inside as unknown as HTMLElement);
        assert.equal(f.isVisible(), true);
        const sortItem = f.items.find(item => item.submenu);
        (sortItem.submenu[0].click as () => void)();
        assert.equal(f.view.host.temporarySort.column, "notes");
        assert.equal(f.view.host.temporarySort.order, "ASC");
        assert.equal(f.invalidated(), 1);
    });
}

test("touch capture dismissal and related click handling remain compatible", () => {
    const f = fixture(true);
    const sort = new Target("av-sort");
    f.click(sort);
    f.touch(sort);
    assert.equal(f.isVisible(), true);
    f.click(sort);
    assert.equal(f.isVisible(), false);
    f.click(sort);
    const blank = new Target();
    f.touch(blank);
    assert.equal(f.isVisible(), false);
    f.click(blank);
    assert.equal(f.isVisible(), false);
});

test("blank clicks dismiss even while the related host is inactive", () => {
    const f = fixture();
    f.click(new Target("av-sort"));
    f.view.host.active = false;
    f.click(new Target());
    assert.equal(f.isVisible(), false);
});
