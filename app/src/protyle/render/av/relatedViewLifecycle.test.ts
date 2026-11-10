import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";
import {DOMElement, DOMFixture} from "./testDOM";

const compiled = compileModule("src/protyle/render/av/relatedView.ts") + "\nexports.testPanels = panels;";

interface TestView {
    element: HTMLElement;
    hostElement: HTMLElement;
    sourceElement: HTMLElement;
    host: {active: boolean; available: boolean; sourceBlockID: string; viewID: string};
    disposed: boolean;
    columnWidths: Record<string, Record<string, string>>;
    invalidate: () => void;
}

const fixture = () => {
    const document = new DOMFixture();
    const createElement = document.createElement.bind(document);
    document.createElement = (name: string) => {
        const element = createElement(name);
        const closest = element.closest.bind(element);
        element.closest = (selector: string) => selector.split(",").map(part => closest(part.trim())).find(Boolean) || null;
        return element;
    };
    const hosts = new Map<HTMLElement, TestView["host"]>();
    const timers = new Map<number, () => void>();
    const observers = new Set<() => void>();
    const listeners = new Set<(id: string) => void>();
    const versions = new Map<HTMLElement, number>();
    const pending: Array<() => void> = [];
    const pendingErrors: Array<(error: Error) => void> = [];
    let timerID = 0;
    let renderCount = 0;
    const automaticRefreshes: boolean[] = [];
    let defer = false;
    const editor = {id: "editor", disabled: false, options: {}, block: {}} as IProtyle;
    const imports: Record<string, unknown> = {
        "./render": {avRender: async (element: HTMLElement, _editor: unknown, _callback: unknown,
                                      _all: boolean, _data: unknown, automaticRefresh: boolean) => {
            automaticRefreshes.push(automaticRefresh);
            renderCount++;
            const version = (versions.get(element) || 0) + 1;
            versions.set(element, version);
            const finish = () => {
                if (versions.get(element) !== version || !hosts.get(element)?.active) return;
                element.firstElementChild.innerHTML = '<div class="av__row" data-id="member">Member</div>';
                hosts.get(element).available = true;
            };
            if (defer) await new Promise<void>((resolve, reject) => {
                pending.push(() => { finish(); resolve(); });
                pendingErrors.push(reject);
            });
            else finish();
        }},
        "./host": {
            setAVRelationHost: (element: HTMLElement, host: TestView["host"]) => hosts.set(element, host),
            deleteAVRelationHost: (element: HTMLElement) => hosts.delete(element),
            createAVHostProtyle: () => editor,
            registerAVHostRefresh: (_id: string, listener: (id: string) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        },
        "./locate": {beginAVRender: (element: HTMLElement) => versions.set(element, (versions.get(element) || 0) + 1)},
        "./virtualScroll": {setAVData() {}},
        "./cellEditor": {closeAVCellEditor() {}},
        "./relatedViewColumnWidth": {applyRelatedAVColumnWidths() {}, startRelatedAVColumnResize() {}},
        "../../../util/escape": {escapeHtmlTextAndAttr: (value: string) => value},
    };
    const api = evaluateModule<typeof import("./relatedView") & {testPanels: WeakMap<HTMLElement, TestView[]>}>(compiled, {
        document, HTMLElement: DOMElement, structuredClone,
        window: {siyuan: {config: {readonly: false}, languages: {_attrView: {}}}},
        setTimeout: (callback: () => void) => { const id = ++timerID; timers.set(id, callback); return id; },
        clearTimeout: (id: number) => timers.delete(id),
        MutationObserver: class {
            constructor(private callback: () => void) {}
            observe() { observers.add(this.callback); }
            disconnect() { observers.delete(this.callback); }
        },
        require: (id: string) => imports[id] || {},
    });
    const panel = (connected = false) => {
        const element = document.createElement("div");
        element.innerHTML = '<div data-av-id="source"></div>';
        if (connected) document.body.append(element);
        return element as unknown as HTMLElement;
    };
    const mount = (element: HTMLElement, item = "entry", target = "target", view = "table", carrier = "carrier",
                   automaticRefresh = false) => {
        api.mountRelatedAVViews(element, [{avID: "source", keyValues: [
            {key: {id: "primary", type: "block"}, values: [{blockID: item} as IAVCellValue]},
            {key: {id: "relation", name: "Related", type: "relation", relation: {
                avID: target, detailView: {enabled: true, spec: 1, viewID: view},
            } as IAVColumnRelation}},
        ]}], editor, carrier, automaticRefresh);
        return api.testPanels.get(element)[0];
    };
    const flush = () => {
        const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback());
    };
    return {api, document, editor, panel, mount, hosts, listeners, pending, pendingErrors, flush,
        automaticRefreshes, renderCount: () => renderCount, defer: () => { defer = true; },
        observe: () => [...observers].forEach(callback => callback())};
};

test("transaction refresh and retained attribute hosts preserve automatic template evaluation mode", () => {
    const f = fixture();
    const source = f.panel(true);
    f.mount(source);
    f.api.syncRelatedAVViews(source);
    assert.equal(f.automaticRefreshes.at(-1), false);
    f.listeners.forEach(listener => listener("source"));
    f.flush();
    assert.equal(f.automaticRefreshes.at(-1), true);
    f.api.preserveRelatedAVViews(source);
    source.innerHTML = '<div data-av-id="source"></div>';
    f.mount(source, "entry", "target", "table", "carrier", true);
    f.api.syncRelatedAVViews(source);
    assert.equal(f.automaticRefreshes.at(-1), true);
});

test("related refresh preserves the mounted table while new membership is pending", () => {
    const f = fixture();
    const source = f.panel(true);
    const before = f.mount(source);
    before.columnWidths.table = {title: "348px"};
    f.api.syncRelatedAVViews(source);
    const content = before.hostElement.innerHTML;
    const destination = f.panel();
    const provisional = f.mount(destination);
    f.defer();
    f.api.preserveRelatedAVViews(source, destination);
    source.replaceWith(destination);
    f.api.syncRelatedAVViews(destination);
    f.flush();
    const after = f.api.testPanels.get(destination)[0];
    assert.ok(after === before, "Keep the live instance rather than rendering an empty replacement");
    assert.equal(after.hostElement.innerHTML, content);
    assert.equal(after.sourceElement, destination.firstElementChild);
    assert.equal(after.columnWidths.table.title, "348px");
    assert.equal(provisional.disposed, true);
    assert.equal(f.listeners.size, 1);
    f.observe();
    assert.equal(after.disposed, false);
});

test("in-place attribute replacement reattaches the live related table", () => {
    const f = fixture();
    const source = f.panel(true);
    const before = f.mount(source);
    f.api.syncRelatedAVViews(source);
    f.api.preserveRelatedAVViews(source);
    source.innerHTML = '<div data-av-id="source"></div>';
    const after = f.mount(source);
    f.api.syncRelatedAVViews(source);
    assert.ok(after === before, "Reattach the existing related view after attribute HTML replacement");
    assert.equal(after.sourceElement, source.firstElementChild);
    assert.ok(after.hostElement.querySelector('[data-id="member"]'));
    f.observe();
    assert.equal(after.disposed, false);
});

test("adding and removing related tables preserves definition order through panel replacement", () => {
    const f = fixture();
    const tables = (keys: string[]) => [{avID: "source", keyValues: [
        {key: {id: "primary", type: "block" as TAVCol}, values: [{blockID: "entry"} as IAVCellValue]},
        ...keys.map(id => ({key: {id, name: id, type: "relation" as TAVCol, relation: {
            avID: "target", detailView: {enabled: true, spec: 1 as const, viewID: "table"},
        }}})),
    ]}];
    let source = f.panel(true);
    f.api.mountRelatedAVViews(source, tables(["first"]), f.editor, "carrier");
    const original = f.api.testPanels.get(source)[0];
    for (const keys of [["first", "second"], ["first", "second", "third"], ["first", "third"], ["third", "first"]]) {
        const destination = f.panel();
        f.api.mountRelatedAVViews(destination, tables(keys), f.editor, "carrier");
        f.api.preserveRelatedAVViews(source, destination);
        const retained = f.api.testPanels.get(destination);
        assert.deepEqual(Array.from(destination.firstElementChild.children), Array.from(retained, view => view.element),
            "retained and newly created tables stay in the requested order before becoming visible");
        assert.ok(retained.includes(original));
        source.replaceWith(destination);
        f.api.syncRelatedAVViews(destination);
        f.flush();
        f.observe();
        assert.equal(original.disposed, false);
        source = destination;
    }
});

test("successive refreshes retain one owner while membership renders are pending", () => {
    const f = fixture();
    let source = f.panel(true);
    const view = f.mount(source);
    f.api.syncRelatedAVViews(source);
    f.defer();
    for (let index = 0; index < 3; index++) {
        const destination = f.panel();
        f.mount(destination);
        f.api.preserveRelatedAVViews(source, destination);
        source.replaceWith(destination);
        f.api.syncRelatedAVViews(destination);
        source = destination;
        f.observe();
    }
    f.flush();
    assert.ok(f.api.testPanels.get(source)[0] === view);
    assert.equal(f.listeners.size, 1);
    assert.equal(f.hosts.size, 1);
    assert.ok(view.hostElement.querySelector('[data-id="member"]'));
    f.api.disposeRelatedAVViews(source);
    f.flush();
    assert.equal(f.hosts.size, 0);
    assert.equal(f.listeners.size, 0);
});

test("a retained view cancels the pre-transfer response before committing fresh members", async () => {
    const f = fixture();
    const source = f.panel(true);
    const view = f.mount(source);
    f.defer();
    f.api.syncRelatedAVViews(source);
    const destination = f.panel();
    f.mount(destination);
    f.api.preserveRelatedAVViews(source, destination);
    source.replaceWith(destination);
    f.api.syncRelatedAVViews(destination);
    assert.equal(f.pending.length, 2);
    f.pending[0]();
    await Promise.resolve();
    assert.equal(view.hostElement.querySelector('[data-id="member"]'), null);
    f.pending[1]();
    await Promise.resolve();
    assert.ok(view.hostElement.querySelector('[data-id="member"]'));
    f.api.disposeRelatedAVViews(source);
    assert.equal(view.disposed, false);
    f.api.disposeRelatedAVViews(destination);
    assert.equal(view.disposed, true);
});

test("removing a relation definition disposes its preserved host", () => {
    const f = fixture();
    const source = f.panel(true);
    const view = f.mount(source);
    f.api.syncRelatedAVViews(source);
    f.api.preserveRelatedAVViews(source);
    source.innerHTML = '<div data-av-id="source"></div>';
    f.api.mountRelatedAVViews(source, [], f.editor, "carrier");
    f.observe();
    assert.equal(view.disposed, true);
    assert.equal(f.hosts.size, 0);
    assert.equal(f.listeners.size, 0);
});

test("a stale network failure cannot erase a retained view after its newer render succeeds", async () => {
    const f = fixture();
    const source = f.panel(true);
    const view = f.mount(source);
    f.defer();
    f.api.syncRelatedAVViews(source);
    const destination = f.panel();
    f.mount(destination);
    f.api.preserveRelatedAVViews(source, destination);
    source.replaceWith(destination);
    f.api.syncRelatedAVViews(destination);
    f.pending[1]();
    await Promise.resolve();
    f.pendingErrors[0](new Error("stale network failure"));
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(view.hostElement.querySelector('[data-id="member"]'));
    assert.equal(view.host.available, true);
});

test("disposing a preserved in-place panel releases its pending views", () => {
    const f = fixture();
    const source = f.panel(true);
    const view = f.mount(source);
    f.api.syncRelatedAVViews(source);
    f.api.preserveRelatedAVViews(source);
    source.innerHTML = "";
    f.api.disposeRelatedAVViews(source);
    f.observe();
    f.flush();
    assert.equal(view.disposed, true);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.hosts.size, 0);
});

for (const change of ["item", "target", "view", "carrier"]) {
    test(`related refresh never reuses content across a changed ${change}`, () => {
        const f = fixture();
        const source = f.panel(true);
        const before = f.mount(source);
        before.columnWidths.table = {title: "348px"};
        f.api.syncRelatedAVViews(source);
        const destination = f.panel();
        const next = f.mount(destination, change === "item" ? "other" : "entry",
            change === "target" ? "other" : "target", change === "view" ? "other" : "table",
            change === "carrier" ? "other" : "carrier");
        f.api.preserveRelatedAVViews(source, destination);
        source.replaceWith(destination);
        assert.equal(f.api.testPanels.get(destination)[0], next);
        assert.equal(before.disposed, true);
        assert.equal(next.hostElement.textContent, "");
        assert.equal(Object.keys(next.columnWidths).length, 0);
        assert.equal(f.listeners.size, 1);
    });
}

test("disposed render responses cannot populate another entry or retain refresh listeners", async () => {
    const f = fixture();
    const source = f.panel(true);
    const before = f.mount(source);
    f.defer();
    f.api.syncRelatedAVViews(source);
    f.api.disposeRelatedAVViews(source);
    f.pending.forEach(resolve => resolve());
    await Promise.resolve();
    assert.equal(before.hostElement.textContent, "");
    assert.equal(f.hosts.size, 0);
    assert.equal(f.listeners.size, 0);
});

test("security invalidation clears visible members and rejects a pending refresh", async () => {
    const f = fixture();
    const source = f.panel(true);
    const before = f.mount(source);
    f.api.syncRelatedAVViews(source);
    f.defer();
    before.invalidate();
    f.flush();
    f.api.invalidateRelatedAVSecurity();
    f.pending.forEach(resolve => resolve());
    await Promise.resolve();
    assert.equal(before.host.active, false);
    assert.equal(before.host.available, false);
    assert.equal(before.hostElement.querySelector('[data-id="member"]'), null);
});
