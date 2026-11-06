import * as assert from "node:assert/strict";
import {it} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";
import {escapeAriaLabel, escapeHtml} from "../../../util/escape";

const compiled = compileModule("src/protyle/render/av/relatedViewConfig.ts");
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

class Control {
    public checked = false;
    public disabled = false;
    public isConnected = true;
    public textContent = "";
    public focused = false;
    public dataset: Record<string, string> = {};
    public children: Control[] = [];
    public listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
    public classes = new Set<string>();
    public classList = {
        add: (name: string) => this.classes.add(name),
        remove: (name: string) => this.classes.delete(name),
        toggle: (name: string, force: boolean) => force ? this.classes.add(name) : this.classes.delete(name),
    };
    public querySelector: (selector: string) => Control = () => undefined;
    public replaceWith: (element: Control) => void = () => {};
    public addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
        this.listeners.set(type, [...this.listeners.get(type) || [], listener]);
    }
    public dispatch(type: string, event: Record<string, unknown> = {}) {
        (this.listeners.get(type) || []).forEach(listener => listener({
            preventDefault() {}, stopPropagation() {}, ...event,
        }));
    }
    public focus() { this.focused = true; }
    public setAttribute(name: string, value: string) { this.dataset[name] = value; }
    public contains(element: Control): boolean { return this === element || this.children.includes(element); }
}

const setup = (detailView?: IAVColumnRelation["detailView"], info = "relatedDatabaseViewInfo") => {
    const field = {id: "relation-key", type: "relation", relation: {avID: "target", detailView}} as IAVColumn;
    const protyle = {disabled: false} as IProtyle;
    const config = {readonly: false};
    const operations: Array<{forward: IOperation[], undo: IOperation[]}> = [];
    const requests: Array<{url: string; payload: unknown}> = [];
    const messages: string[] = [];
    const mobileItems: IMenu[] = [];
    const menu = new Control();
    const switchElement = new Control();
    const infoButton = new Control();
    const infoElement = new Control();
    infoElement.classes.add("fn__none");
    let target = new Control();
    const tip = new Control();
    const tipText = new Control();
    tip.querySelector = () => tipText;
    const source = new Control();
    source.dataset.avId = "target";
    let targetOptions: IMenu;
    let mobile = false;
    let shown = 0;
    let fullscreen = 0;
    let observe: () => void;
    let response: () => Promise<unknown> = async () => ({code: 0, data: {av: {views: [
        {id: "gallery", type: "gallery", name: "Cards"},
        {id: "first", type: "table", name: "First <view>"},
        {id: "second", type: "table", name: "Second"},
    ]}}});
    const replace = (element: Control) => {
        target = element;
        target.replaceWith = replace;
    };
    target.replaceWith = replace;
    menu.querySelector = selector => ({
        '[data-type="relatedViewEnabled"]': switchElement,
        '[data-type="relatedViewInfo"]': infoButton,
        "[data-related-view-info]": infoElement,
        '[data-type="relatedViewTarget"]': target,
        "[data-related-view-tip]": tip,
        '[data-type="goSearchAV"]': source,
    }[selector]);
    const lang = new Proxy({}, {get: (_object, key) => key === "relatedDatabaseViewInfo" ? info : String(key)});
    const commonMenu = {showSubMenu() { shown++; }, append(element: Control & {options: IMenu}) {
        mobileItems.push(element.options);
    }, fullscreen() { fullscreen++; }};
    const api = evaluateModule<typeof import("./relatedViewConfig")>(compiled, {
        window: {siyuan: {config, languages: {_attrView: lang, _kernel: {267: "Untitled"}, loading: "Loading"},
            menus: {menu: commonMenu}}},
        MutationObserver: class {
            constructor(callback: () => void) { observe = callback; }
            public observe() {}
            public disconnect() {}
        },
        require: (id: string) => ({
            "../../../menus/Menu": {MenuItem: class {
                public element = new Control();
                constructor(options: IMenu) {
                    Object.assign(this.element, {options});
                    if (options.submenu) {
                        targetOptions = options;
                        const submenu = new Control();
                        const first = new Control();
                        submenu.querySelector = () => first;
                        this.element.children.push(submenu);
                        this.element.querySelector = () => submenu;
                    }
                }
            }},
            "../../../menus/menuToggle": {toggleMenu: (options: {build: (menu: unknown) => void; show: (menu: unknown) => void}) => {
                options.build(commonMenu);
                options.show(commonMenu);
            }},
            "../../../util/functions": {isMobile: () => mobile},
            "../../../util/escape": {escapeAriaLabel, escapeHtml},
            "../../../dialog/message": {showMessage: (message: string) => messages.push(message)},
            "../../../util/fetch": {fetchSyncPost: (url: string, payload: unknown) => {
                requests.push({url, payload});
                return response();
            }},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, forward: IOperation[], undo: IOperation[]) => {
                operations.push(copy({forward, undo}));
            }},
        }[id] || {}),
    });
    return {api, field, protyle, config, menu, switchElement, infoButton, infoElement, source, operations, requests, messages, mobileItems,
        tipText, get target() { return target; }, get targetOptions() { return targetOptions; },
        get shown() { return shown; }, get fullscreen() { return fullscreen; },
        setResponse: (callback: typeof response) => { response = callback; },
        setMobile: () => { mobile = true; }, observe: () => observe(),
        bind: () => api.bindRelatedViewConfig(protyle, "source", field, menu as unknown as HTMLElement, "source-carrier"),
        toggle: (enabled: boolean) => { switchElement.checked = enabled; switchElement.dispatch("change"); },
    };
};

it("opens and closes the explanation without toggling the relation setting on desktop and mobile", async () => {
    for (const mobile of [false, true]) {
        const h = setup();
        if (mobile) h.setMobile();
        const html = h.api.getRelatedViewConfigHTML(h.field, h.protyle);
        assert.match(html, /<button type="button"[^>]+data-type="relatedViewInfo"[^>]+aria-expanded="false"/);
        assert.match(html, /iconInfo/);
        assert.match(html, /relatedDatabaseViewInfo/);
        await h.bind();
        let stopped = false;
        h.infoButton.dispatch("click", {stopPropagation() { stopped = true; }});
        assert.equal(stopped, true);
        assert.equal(h.infoButton.dataset["aria-expanded"], "true");
        assert.equal(h.infoElement.classes.has("fn__none"), false);
        assert.equal(h.switchElement.checked, false);
        assert.equal(h.operations.length, 0);
        h.infoButton.dispatch("click");
        assert.equal(h.infoButton.dataset["aria-expanded"], "false");
        assert.equal(h.infoElement.classes.has("fn__none"), true);
    }
});

it("uses the native hover tooltip and escapes its separately parsed content", () => {
    const text = 'View <entry> "details" &lt;sample>';
    const h = setup(undefined, text);
    const html = h.api.getRelatedViewConfigHTML(h.field, h.protyle);
    assert.match(html, /block__icon block__icon--show ariaLabel/);
    assert.ok(html.includes(`data-position="north" aria-label="${escapeAriaLabel(text)}"`));
    assert.ok(html.includes(escapeHtml(text)));
});

it("uses a native switch and a checked existing-table submenu without a select or layout copy", async () => {
    const h = setup();
    const html = h.api.getRelatedViewConfigHTML(h.field, h.protyle);
    assert.match(html, /b3-switch b3-switch--menu/);
    assert.doesNotMatch(html, /<select/);
    await h.bind();
    assert.equal(h.targetOptions.label, "relatedDatabaseView");
    assert.equal(h.targetOptions.accelerator, escapeHtml("First <view>"));
    assert.deepEqual(copy(h.requests), [{url: "/api/av/getAttributeView", payload: {id: "target", blockID: "source-carrier",
        relationFieldContext: {sourceAvID: "source", relationKeyID: "relation-key"}}}]);
    assert.deepEqual(copy(h.targetOptions.submenu.map(item => [item.label, item.checked])),
        [[escapeHtml("First <view>"), true], ["Second", false]]);
    h.toggle(true);
    assert.deepEqual(h.operations[0], {
        forward: [{action: "setAttrViewRelationDetail", avID: "source", keyID: "relation-key", blockID: "source-carrier",
            data: {spec: 1, enabled: true, viewID: "first"}}],
        undo: [{action: "setAttrViewRelationDetail", avID: "source", keyID: "relation-key", blockID: "source-carrier", data: null}],
    });
    assert.equal(h.target.classes.has("fn__none"), false);
    assert.equal(h.tipText.textContent, "relatedDatabaseViewShared");
    h.targetOptions.submenu[1].click(undefined, undefined);
    assert.equal(h.target.focused, true);
    assert.deepEqual(h.operations[1].undo[0].data, {spec: 1, enabled: true, viewID: "first"});
    assert.deepEqual(copy(h.field.relation.detailView), {spec: 1, enabled: true, viewID: "second"});
    h.toggle(false);
    assert.deepEqual(copy(h.field.relation.detailView), {spec: 1, enabled: false, viewID: "second"});
    assert.equal(h.target.classes.has("fn__none"), true);
    h.toggle(true);
    assert.equal(h.field.relation.detailView.viewID, "second");
});

it("falls back only to an existing table when the configured view disappears", async () => {
    const h = setup({spec: 1, enabled: false, viewID: "removed"});
    await h.bind();
    h.toggle(true);
    assert.equal(h.field.relation.detailView.viewID, "first");
    assert.deepEqual(h.operations[0].undo[0].data, {spec: 1, enabled: false, viewID: "removed"});
});

it("explains missing table views and unavailable targets without generating a view", async () => {
    for (const unavailable of [false, true]) {
        const h = setup();
        h.setResponse(async () => unavailable ? {code: -1} : {code: 0, data: {av: {views: [{id: "gallery", type: "gallery"}]}}});
        await h.bind();
        h.toggle(true);
        assert.equal(h.operations.length, 0);
        assert.equal(h.switchElement.checked, false);
        assert.deepEqual(h.messages, [unavailable ? "relatedDatabaseViewUnavailable" : "relatedDatabaseViewNoTable"]);
    }
    const h = setup({spec: 1, enabled: true, viewID: "removed"});
    h.setResponse(async () => { throw new Error("Offline"); });
    await h.bind();
    h.toggle(false);
    assert.equal(h.operations.length, 1, "an unavailable target can still be hidden");
    assert.equal(h.field.relation.detailView.viewID, "removed");
    const missing = setup({spec: 1, enabled: true, viewID: "removed"});
    delete missing.field.relation.avID;
    missing.source.dataset.avId = "";
    await missing.bind();
    assert.equal(missing.requests.length, 0);
    assert.equal(missing.switchElement.disabled, false);
    missing.toggle(false);
    assert.equal(missing.operations.length, 1, "a missing relation target can still be hidden");
});

it("guards pending requests, removed panels, retargeted fields and read-only changes", async () => {
    for (const mode of ["pending", "removed", "retargeted", "readonly", "unknown"]) {
        const h = setup();
        let resolve: (response: unknown) => void;
        h.setResponse(() => new Promise(done => { resolve = done; }));
        const binding = h.bind();
        assert.equal(h.switchElement.disabled, true);
        h.toggle(true);
        assert.equal(h.operations.length, 0);
        if (mode === "removed") h.switchElement.isConnected = false;
        if (mode === "retargeted") h.source.dataset.avId = "new-target";
        if (mode === "readonly") h.protyle.disabled = true;
        if (mode === "unknown") h.field.relation.detailView = {spec: 2, enabled: true, viewID: "first"} as unknown as IAVColumnRelation["detailView"];
        resolve({code: 0, data: {av: {views: [{type: "table", id: "first"}]}}});
        await binding;
        if (mode !== "pending") {
            h.toggle(true);
            assert.equal(h.operations.length, 0, mode);
        } else {
            h.config.readonly = true;
            h.toggle(true);
            assert.equal(h.operations.length, 0);
        }
        if (mode === "retargeted") {
            h.source.dataset.avId = "target";
            h.observe();
            assert.equal(h.switchElement.disabled, false);
            h.toggle(true);
            assert.equal(h.operations.length, 1);
        }
    }
});

it("uses hover and keyboard on desktop, and a native bottom menu on mobile", async () => {
    const h = setup({spec: 1, enabled: true, viewID: "second"});
    await h.bind();
    h.target.dispatch("mouseenter");
    assert.equal(h.shown, 1);
    h.target.dispatch("keydown", {key: "ArrowRight"});
    assert.equal(h.shown, 2);
    assert.equal(h.target.querySelector("").querySelector("").focused, true);
    h.target.dispatch("keydown", {key: "ArrowLeft"});
    assert.equal(h.target.focused, true);
    assert.equal(h.target.classes.has("b3-menu__item--show"), false);
    h.setMobile();
    h.toggle(false);
    h.toggle(true);
    h.target.dispatch("mouseenter");
    assert.equal(h.shown, 2);
    h.target.dispatch("click");
    assert.equal(h.fullscreen, 1);
    assert.deepEqual(h.mobileItems.map(item => item.checked), [false, true]);
    h.mobileItems[0].click(undefined, undefined);
    assert.equal(h.field.relation.detailView.viewID, "first");
});

it("keeps history and snapshot field configuration read-only", async () => {
    for (const history of [{created: 1}, {snapshot: "snapshot-id"}]) {
        const h = setup({spec: 1, enabled: true, viewID: "first"});
        h.protyle.options = {history} as IProtyle["options"];
        assert.match(h.api.getRelatedViewConfigHTML(h.field, h.protyle), /checked disabled/);
        await h.bind();
        assert.equal(h.switchElement.disabled, true);
        h.toggle(false);
        h.targetOptions.submenu[1].click(undefined, undefined);
        assert.equal(h.operations.length, 0);
    }
});

it("enables new relation configuration in the same menu and stages it until confirmation", async () => {
    for (const mobile of [false, true]) {
        const h = setup();
        if (mobile) h.setMobile();
        delete h.field.relation;
        h.source.dataset.avId = "";
        await h.bind();
        assert.equal(h.switchElement.disabled, true);
        h.source.dataset.avId = "target";
        h.source.dataset.blockId = "target-carrier";
        h.observe();
        await settle();
        assert.equal(h.switchElement.disabled, false);
        assert.deepEqual(copy(h.requests), [{url: "/api/av/getAttributeView",
            payload: {id: "target", blockID: "target-carrier"}}]);
        h.toggle(true);
        assert.equal(h.operations.length, 0, "do not save detail settings before the relation exists");
        assert.equal(h.field.relation, undefined, "do not mutate the existing field before confirmation");
        assert.deepEqual(copy(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element)),
            {spec: 1, enabled: true, viewID: "first"});
        h.targetOptions.submenu[1].click(undefined, undefined);
        assert.deepEqual(copy(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element)),
            {spec: 1, enabled: true, viewID: "second"});
        h.toggle(false);
        h.toggle(true);
        assert.equal(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element).viewID, "second");
        h.source.dataset.avId = "different";
        assert.equal(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element), undefined);
    }
});

it("retargeting rejects stale view lists and clears staged configuration when returning to the original target", async () => {
    const h = setup({spec: 1, enabled: true, viewID: "second"});
    await h.bind();
    const responses: Array<(value: unknown) => void> = [];
    h.setResponse(() => new Promise(resolve => responses.push(resolve)));
    h.source.dataset.avId = "other";
    h.source.dataset.blockId = "other-carrier";
    h.observe();
    assert.equal(h.switchElement.disabled, true);
    h.source.dataset.avId = "newest";
    h.source.dataset.blockId = "newest-carrier";
    h.observe();
    responses[0]({code: 0, data: {av: {views: [{id: "stale", type: "table"}]}}});
    await settle();
    assert.equal(h.switchElement.disabled, true);
    responses[1]({code: 0, data: {av: {views: [{id: "new", type: "table"}]}}});
    await settle();
    h.toggle(true);
    assert.deepEqual(copy(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element)),
        {spec: 1, enabled: true, viewID: "new"});
    assert.equal(h.operations.length, 0);
    assert.equal(h.field.relation.detailView.viewID, "second");
    h.source.dataset.avId = "target";
    h.observe();
    responses[2]({code: 0, data: {av: {views: [{id: "second", type: "table"}]}}});
    await settle();
    assert.equal(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element), undefined);
    assert.equal(h.switchElement.checked, true);
    h.toggle(false);
    assert.equal(h.operations.length, 1);
    assert.deepEqual(h.operations[0].undo[0].data, {spec: 1, enabled: true, viewID: "second"});
});

it("rejects a previous target's submenu callback while loading and after replacement", async () => {
    const h = setup({spec: 1, enabled: true, viewID: "second"});
    h.setMobile();
    await h.bind();
    h.target.dispatch("click");
    const previousChoice = h.mobileItems[0];
    let resolve: (value: unknown) => void;
    h.setResponse(() => new Promise(done => { resolve = done; }));
    h.source.dataset.avId = "new-target";
    h.source.dataset.blockId = "new-carrier";
    h.observe();
    previousChoice.click(undefined, undefined);
    assert.equal(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element), undefined);
    resolve({code: 0, data: {av: {views: [{id: "new", type: "table"}]}}});
    await settle();
    previousChoice.click(undefined, undefined);
    assert.equal(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element), undefined);
    assert.equal(h.operations.length, 0);
    h.toggle(true);
    assert.equal(h.api.getPendingRelatedViewConfig(h.menu as unknown as Element).viewID, "new");
});
