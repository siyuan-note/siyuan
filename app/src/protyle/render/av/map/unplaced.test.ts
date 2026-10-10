import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {AVTableRow} from "../../../../types/api";
import * as escape from "../../../../util/escape";
import * as locationValue from "../locationValue";
import {getMapSettings} from "./state";
import * as unplacedMenu from "./unplacedMenu";
import * as desktopUnplaced from "./desktopUnplaced";
import * as protocol from "./protocol";
import {requireFixture} from "./testDOM";

class ElementStub {
    isConnected = true;
    textContent = "";
    value = "";
    focused = false;
    ownerDocument: any;
    parentElement: ElementStub;
    readonly classes = new Set<string>();
    readonly attributes = new Map<string, string>();
    readonly events = new Map<string, (event?: any) => void>();
    readonly classList = {
        add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
        remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
        toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(type: string, callback: (event?: any) => void) { this.events.set(type, callback); }
    removeEventListener(type: string) { this.events.delete(type); }
    remove() { this.isConnected = false; }
    focus() { this.focused = true; }
    contains(element: unknown) { return element === this; }
    getBoundingClientRect() { return {left: 476, top: 76, right: 500, bottom: 100, width: 24, height: 24}; }
}

const row = (id: string, location?: IAVCellLocationValue): AVTableRow => ({id, cells: [
    {id: `primary-${id}`, value: {id: `primary-${id}`, type: "block", isDetached: true,
        block: {content: `<Title ${id}>`}}},
    {id: `location-${id}`, value: {id: `location-${id}`, type: "location", keyID: "location", location}},
]}) as AVTableRow;

const flush = () => new Promise(resolve => setImmediate(resolve));

const bridgeSource = transpileModule(readFileSync("src/protyle/render/av/map/desktopUnplaced.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

const setup = (mobile = false, nativeReady = false) => {
    const requests: Array<{payload: any; signal: AbortSignal; resolve: (response: unknown) => void;
        reject: (reason?: unknown) => void}> = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const toggle = new ElementStub();
    toggle.classes.add("fn__none");
    const count = new ElementStub();
    const search = {textContent: "  main query  "};
    const input = new ElementStub();
    const canvas = new ElementStub();
    const root = {querySelector: (selector: string) => selector === ".av__map-canvas" ? canvas : toggle};
    const block = {dataset: {nodeId: "carrier", avId: "database"}, querySelector: () => search};
    const protyle = {options: {}} as IProtyle;
    const data = {id: "database", viewID: "map-view", view: {
        map: {locationKeyID: "location"}, columns: [{id: "location", type: "location"}],
        rows: [], rowCount: 1000,
    }} as IAV;
    let current = true;
    let positions = 0;
    const opens: Array<{row: IAVRow; keyID: string}> = [];
    const messages: string[] = [];
    const menus: MenuStub[] = [];
    class MenuStub {
        items: Array<{option: IMenu; element: ElementStub}> = [];
        element = Object.assign(new ElementStub(), {querySelector: () => count});
        position: IPosition;
        closed = false;
        constructor(_id?: string, private closeCB?: () => void) { menus.push(this); }
        addItem(option: IMenu) {
            const element = new ElementStub();
            Object.assign(element, {querySelector: () => input});
            option.bind?.(element as unknown as HTMLElement);
            this.items.push({option, element});
            return element;
        }
        open(position: IPosition) { this.position = position; }
        close() {
            if (this.closed) return;
            this.closed = true;
            this.items.forEach(item => item.element.remove());
            this.closeCB?.();
        }
        active() { return this.items.filter(item => item.element.isConnected); }
        click(label: string) {
            const item = this.active().find(item => item.option.label === label);
            assert.ok(item, `Missing menu item: ${label}`);
            return item.option.click?.(item.element as unknown as HTMLElement, {} as MouseEvent);
        }
    }
    const context = {siyuan: {isPublish: false, languages: new Proxy<Record<string, string>>({}, {
        get: (_target, key: string) => key,
    }), menus: {menu: {resetPosition: () => { positions++; }}}},
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; }};
    const bridge = {} as typeof desktopUnplaced;
    runInNewContext(bridgeSource, {exports: bridge, window: context, require: requireFixture({"./protocol": protocol})});
    const nativeOpens: Array<{value: any; resolve: (value: unknown) => void}> = [];
    const nativeSent: Array<{channel: string; value: any}> = [];
    const nativeListeners = new Map<string, (event: unknown, value: unknown) => void>();
    const nativeFrames = new Map<number, () => void>();
    const nativeTimers = new Map<number, () => void>();
    const scopeEvents = new Map<string, (event?: any) => void>();
    const documentEvents = new Map<string, (event?: any) => void>();
    const scope = {innerWidth: 1000, innerHeight: 800,
        getComputedStyle: () => ({display: "block", visibility: "visible", overflowX: "visible", overflowY: "visible",
            getPropertyValue: (name: string) => name === "--b3-font-size" ? "14px" : ""}),
        addEventListener: (type: string, callback: () => void) => scopeEvents.set(type, callback),
        removeEventListener: (type: string) => scopeEvents.delete(type),
        requestAnimationFrame: (callback: () => void) => { nativeFrames.set(++nextTimer, callback); return nextTimer; },
        cancelAnimationFrame: (id: number) => nativeFrames.delete(id),
        setTimeout: (callback: () => void) => { nativeTimers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: (id: number) => nativeTimers.delete(id)};
    const document = {defaultView: scope, hidden: false, elementFromPoint: () => toggle,
        addEventListener: (type: string, callback: () => void) => documentEvents.set(type, callback),
        removeEventListener: (type: string) => documentEvents.delete(type)};
    canvas.ownerDocument = document;
    toggle.ownerDocument = document;
    let ready = nativeReady;
    let theme: "light" | "dark" = "light";
    const releaseHost = bridge.registerDesktopMapUnplacedHost(canvas as unknown as HTMLElement, {
        ipc: {invoke: (_channel, value) => new Promise(resolve => nativeOpens.push({value, resolve})),
            send: (channel, value) => nativeSent.push({channel, value}),
            on: (channel, callback) => nativeListeners.set(channel, callback),
            removeListener: channel => nativeListeners.delete(channel)},
        envelope: () => ({version: 1, instanceID: "map-instance"}), available: () => ready, theme: () => theme});
    const methods = {} as typeof import("./unplaced");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/unplaced.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, window: context, AbortController,
        clearTimeout: (id: number) => timers.delete(id), require: requireFixture({
            "../../../../constants": {Constants: {TIMEOUT_INPUT: 256, ATTRIBUTE_MENU_KEYMAP: "data-keymap"}},
            "../../../../dialog/message": {showMessage: (text: string) => messages.push(text)},
            "../../../../plugin/Menu": {Menu: MenuStub},
            "../../../../util/escape": escape,
            "../../../../util/functions": {isMobile: () => mobile},
            "../../../../util/fetch": {fetchSyncPost: (url: string, payload: unknown, _cb: unknown, _message: unknown,
                signal: AbortSignal) => {
                assert.equal(url, "/api/av/getAttributeViewMapUnplaced");
                return new Promise((resolve, reject) => requests.push({payload, signal, resolve, reject}));
            }},
            "../locationValue": locationValue,
            "./state": {getMapSettings},
            "./unplacedMenu": unplacedMenu,
            "./desktopUnplaced": bridge,
            "./protocol": protocol,
            "./settings": {canEditMapSettings: () => !protyle.disabled && !context.siyuan.isPublish &&
                !protyle.options.history?.created && !protyle.options.history?.snapshot},
            "./openRecord": {openMapRecord: (_protyle: IProtyle, _block: HTMLElement, row: IAVRow, keyID: string) =>
                opens.push({row, keyID})},
        })});
    const destroy = methods.bindMapUnplaced({root: root as unknown as HTMLElement, blockElement: block as unknown as HTMLElement,
        protyle, data, current: () => current});
    let issuedRequestID = 0;
    const nativeState = () => nativeSent.filter(item => item.channel === "siyuan-map-unplaced-update").at(-1)?.value.state ||
        nativeOpens.at(-1)?.value.state;
    const nativeReply = (value: Record<string, unknown>) => nativeListeners.get("siyuan-map-unplaced-reply")?.({}, {
        version: 1, instanceID: "map-instance", sessionID: "a".repeat(48), ...value});
    return {methods, requests, menus, toggle, count, input, canvas, data, protyle, context, opens, destroy,
        nativeOpens, nativeSent, nativeState, nativeReply, releaseHost, document, scope, documentEvents, scopeEvents, messages,
        setTheme: (value: "light" | "dark") => { theme = value; },
        setReady: (value: boolean) => { ready = value; },
        nativeOpen: async (index = nativeOpens.length - 1) => {
            nativeOpens[index].resolve({version: 1, instanceID: "map-instance", sessionID: "a".repeat(48)});
            await flush();
        },
        nativeAction: (action: string, extra: Record<string, unknown> = {}) => nativeReply({type: "action", action,
            revision: nativeState().revision, requestID: action === "select" ? nativeState().requestID : ++issuedRequestID,
            query: nativeState().query, page: nativeState().page, ...extra}),
        runNativeFrames: () => { const pending = [...nativeFrames.values()]; nativeFrames.clear(); pending.forEach(callback => callback()); },
        runNativeTimers: () => { const pending = [...nativeTimers.values()]; nativeTimers.clear(); pending.forEach(callback => callback()); },
        positions: () => positions,
        stale: () => { current = false; },
        click: () => toggle.events.get("click")({preventDefault() {}}),
        inputSearch: (value: string, composing = false) => {
            input.value = value;
            input.events.get("input")({isComposing: composing, stopPropagation() {}});
        },
        enter: (label: string) => {
            const menu = menus[menus.length - 1];
            const item = menu.active().find(item => item.option.label === label);
            assert.ok(item, `Missing keyboard menu item: ${label}`);
            Object.assign(item.element, {querySelector: () => null,
                dispatchEvent: () => item.option.click?.(item.element as unknown as HTMLElement, {} as MouseEvent)});
            Object.assign(context.siyuan.menus.menu, {element: {
                classList: {contains: () => false}, querySelector: () => item.element,
                contains: (target: ElementStub) => target === item.element && target.isConnected,
            }, remove: () => menu.close()});
            const nativeMenu = {} as typeof import("../../../../menus/Menu");
            runInNewContext(transpileModule(readFileSync("src/menus/Menu.ts", "utf8"), {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
            }).outputText, {exports: nativeMenu, window: context, CustomEvent: class {}, require: requireFixture({
                "../constants": {Constants: {KEYCODELIST: {13: "↩"}}},
                "../protyle/util/compatibility": {getEventName: () => "click"},
                "../util/setPosition": {}, "../util/zIndex": {}, "./menuPosition": {}, "./menuGroup": {},
                "./sheetOpen": {}, "../protyle/util/hasClosest": {}, "../util/functions": {},
                "../layout/getTopBarHeight": {}, "../protyle/undo": {}, "../util/escape": {},
                "./menuKeyboard": {}, "../plugin/EventBusCore": {}, "../mobile/util/keyboardToolbar": {},
                "../block/popoverLifecycle": {}, "../config/entryVisibility/runtime": {},
            })});
            assert.equal(nativeMenu.bindMenuKeydown({keyCode: 13, target: item.element} as unknown as KeyboardEvent), true);
        },
        runTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
        respond: async (index: number, rows: AVTableRow[] = [], total = rows.length) => {
            requests[index].resolve({code: 0, data: {rows, total}});
            await flush();
        }};
};

test("map unplaced response accepts absent coordinates and names but excludes invalid or already placed values", () => {
    const scenario = setup();
    for (const location of [undefined, {}, {name: "Place"}, {latitude: null, longitude: null}]) {
        const result = scenario.methods.toMapUnplacedRow(row("entry", location), "location");
        assert.equal(result.id, "entry");
        assert.equal(result.cells[1].value.keyID, "location");
        assert.equal(result.cells[0].value.block.content, "<Title entry>");
    }
    for (const location of [{latitude: 0}, {latitude: 0, longitude: 0}, {latitude: 90, longitude: 0},
        {latitude: 91, longitude: 0}, {name: 42}, {unknown: true}, {latitude: "", longitude: ""}]) {
        assert.equal(scenario.methods.toMapUnplacedRow(row("entry", location as IAVCellLocationValue), "location"), undefined);
    }
    assert.equal(scenario.methods.toMapUnplacedRow(row("entry"), "other-field"), undefined);
    assert.equal(scenario.methods.toMapUnplacedRow({id: "entry", cells: []}, "location"), undefined);
    scenario.destroy();
});

test("map unplaced uses current view query and a count request before independent explicit pagination", async () => {
    const scenario = setup();
    assert.equal(scenario.requests.length, 1);
    assert.equal(JSON.stringify(scenario.requests[0].payload), JSON.stringify({id: "database", blockID: "carrier",
        viewID: "map-view", query: "main query", search: "", page: 1, pageSize: 1}));
    await scenario.respond(0, [row("not-loaded")], 51);
    assert.equal(scenario.toggle.classes.has("fn__none"), false);
    scenario.click();
    assert.equal(scenario.requests.length, 2);
    assert.equal(scenario.requests[1].payload.pageSize, 50);
    await scenario.respond(1, [row("not-loaded")], 51);
    assert.equal(scenario.requests.length, 2, "remaining pages require an explicit click");
    assert.equal(scenario.count.textContent, "51");
    const menu = scenario.menus[0];
    assert.equal(menu.position.isLeft, true);
    assert.equal(scenario.input.focused, true);
    const more = menu.active().find(item => item.option.label === "loadMore");
    scenario.enter("loadMore");
    assert.equal(more.element.isConnected, false, "keyboard activation must detach the item before the menu checks whether to close");
    assert.equal(menu.closed, false);
    more.option.click(more.element as unknown as HTMLElement, {} as MouseEvent);
    assert.equal(scenario.requests.length, 3, "a pending page cannot be requested twice");
    assert.equal(scenario.requests[2].payload.page, 2);
    await scenario.respond(2, [row("next-page")], 51);
    assert.equal(menu.active().some(item => item.option.label === "loadMore"), false);
    menu.click("&lt;Title next-page>");
    assert.equal(scenario.opens[0].row.id, "next-page");
    assert.equal(scenario.opens[0].keyID, undefined);
    assert.equal((scenario.data.view as IAVTable).rows.length, 0, "unplaced paging must not mutate map rows");
    scenario.destroy();
});

test("map unplaced count hides only known empty results and exposes a retry path after count failure", async () => {
    const empty = setup();
    await empty.respond(0);
    assert.equal(empty.toggle.classes.has("fn__none"), true);
    empty.destroy();
    const failed = setup();
    failed.requests[0].reject(new Error("offline"));
    await flush();
    assert.equal(failed.toggle.classes.has("fn__none"), false);
    failed.click();
    failed.requests[1].reject(new Error("offline"));
    await flush();
    assert.equal(failed.menus[0].active().some(item => item.option.label === "empty"), false);
    assert.equal(failed.count.classes.has("fn__none"), true);
    failed.menus[0].click("retry");
    assert.equal(failed.requests[2].payload.page, 1);
    await failed.respond(2, [row("recovered")]);
    assert.equal(failed.menus[0].active().some(item => item.option.label === "retry"), false);
    failed.destroy();
});

test("map unplaced search aborts obsolete requests and resets its own page without changing the view query", async () => {
    const scenario = setup();
    scenario.click();
    scenario.inputSearch("  new term  ");
    assert.equal(scenario.requests[1].signal.aborted, true);
    scenario.runTimers();
    const request = scenario.requests[2];
    assert.equal(request.payload.search, "new term");
    assert.equal(request.payload.query, "main query");
    assert.equal(request.payload.page, 1);
    await scenario.respond(2, [row("searched")]);
    await scenario.respond(1, [row("obsolete")]);
    assert.equal(scenario.menus[0].active().some(item => item.option.label === "&lt;Title obsolete>"), false);
    assert.equal(scenario.menus[0].active().some(item => item.option.label === "&lt;Title searched>"), true);
    scenario.inputSearch("composing", true);
    scenario.runTimers();
    assert.equal(scenario.requests.length, 3);
    scenario.input.events.get("compositionend")();
    scenario.runTimers();
    assert.equal(scenario.requests[3].payload.search, "composing");
    scenario.destroy();
});

test("closing or destroying unplaced menus aborts pending work and rejects late responses", async () => {
    for (const close of ["toggle", "menu", "destroy"]) {
        const scenario = setup();
        scenario.click();
        assert.equal(unplacedMenu.isMapUnplacedMenu(scenario.menus[0].element as unknown as HTMLElement,
            scenario.canvas as unknown as HTMLElement), true);
        if (close === "toggle") scenario.click();
        if (close === "menu") scenario.menus[0].close();
        if (close === "destroy") scenario.destroy();
        assert.equal(scenario.requests[1].signal.aborted, true, close);
        assert.equal(unplacedMenu.isMapUnplacedMenu(scenario.menus[0].element as unknown as HTMLElement,
            scenario.canvas as unknown as HTMLElement), false);
        assert.equal(scenario.toggle.attributes.get("aria-expanded"), "false");
        const before = scenario.positions();
        await scenario.respond(1, [row("late")]);
        assert.equal(scenario.positions(), before);
        scenario.destroy();
        assert.equal(scenario.requests[0].signal.aborted, true);
    }
});

test("a failed additional page preserves records and retries that page without keyboard dismissal", async () => {
    const scenario = setup();
    scenario.click();
    await scenario.respond(1, [row("first")], 75);
    scenario.menus[0].click("loadMore");
    scenario.requests[2].reject(new Error("connection lost"));
    await flush();
    const menu = scenario.menus[0];
    assert.equal(menu.active().some(item => item.option.label === "&lt;Title first>"), true);
    assert.equal(menu.active().some(item => item.option.label === "loadMore"), false);
    const retry = menu.active().find(item => item.option.label === "retry");
    scenario.enter("retry");
    assert.equal(retry.element.isConnected, false);
    assert.equal(menu.closed, false);
    assert.equal(scenario.requests[3].payload.page, 2);
    await scenario.respond(3, [row("second")], 75);
    assert.equal(menu.active().some(item => item.option.label === "&lt;Title first>"), true);
    assert.equal(menu.active().some(item => item.option.label === "&lt;Title second>"), true);
    scenario.destroy();
});

test("reopening an inbox starts fresh and a replaced menu response cannot overwrite its rows", async () => {
    const scenario = setup();
    scenario.click();
    scenario.menus[0].close();
    scenario.click();
    assert.equal(scenario.requests[2].payload.page, 1);
    assert.equal(scenario.toggle.attributes.get("aria-expanded"), "true");
    await scenario.respond(2, [row("current")]);
    await scenario.respond(1, [row("previous")]);
    assert.equal(scenario.menus[1].active().some(item => item.option.label === "&lt;Title current>"), true);
    assert.equal(scenario.menus[1].active().some(item => item.option.label === "&lt;Title previous>"), false);
    scenario.destroy();
});

test("stale permissions, field changes and removed maps cannot open rows or revive an inbox", async () => {
    for (const mode of ["disabled", "published", "created", "snapshot", "field", "removed"]) {
        const scenario = setup();
        scenario.click();
        await scenario.respond(1, [row("entry")]);
        if (mode === "disabled") scenario.protyle.disabled = true;
        if (mode === "published") scenario.context.siyuan.isPublish = true;
        if (["created", "snapshot"].includes(mode)) scenario.protyle.options.history = {[mode]: "version"};
        if (mode === "field") (scenario.data.view as IAVTable).map.locationKeyID = "different";
        if (mode === "removed") scenario.stale();
        scenario.menus[0].click("&lt;Title entry>");
        assert.equal(scenario.opens.length, 0, mode);
        scenario.menus[0].close();
        scenario.click();
        assert.equal(scenario.menus.length, 1, mode);
        scenario.destroy();
    }
});

test("mobile unplaced menu uses shared menu placement without forcing a software keyboard", async () => {
    const scenario = setup(true);
    scenario.click();
    await scenario.respond(1, [row("mobile")]);
    assert.equal(scenario.menus[0].position.target, scenario.toggle);
    assert.equal(scenario.input.focused, false);
    assert.equal(unplacedMenu.isMapUnplacedMenu(scenario.menus[0].element as unknown as HTMLElement,
        scenario.canvas as unknown as HTMLElement), false);
    scenario.menus[0].click("&lt;Title mobile>");
    assert.equal(scenario.opens[0].row.id, "mobile");
    scenario.destroy();
});

test("DOM inbox layout belongs to the open menu and preserves the flat search and row keyboard structure", async () => {
    for (const mobile of [false, true]) {
        const scenario = setup(mobile);
        scenario.click();
        await scenario.respond(1, [row("entry")]);
        const menu = scenario.menus[0];
        assert.ok(menu.element.classes.has("av__map-unplaced-menu"));
        const header = menu.active()[0];
        assert.equal(header.option.type, "empty");
        assert.ok(header.option.label.includes("av__map-unplaced-head"));
        assert.ok(header.option.label.includes("av__map-unplaced-search"));
        assert.ok(header.option.label.includes(mobile ? "counter--compact" : "counter--bg"));
        assert.equal(menu.active()[1].option.label, "&lt;Title entry>");
        scenario.enter("&lt;Title entry>");
        assert.equal(scenario.opens[0].row.id, "entry");
        assert.equal(menu.element.classes.has("av__map-unplaced-menu"), false);
        scenario.destroy();
    }
});

test("ready desktop host uses the real unplaced API and sends only the current page of text to the native menu", async () => {
    const scenario = setup(false, true);
    scenario.click();
    assert.equal(scenario.menus.length, 0, "native menus must not create a DOM menu over the map");
    assert.equal(scenario.nativeOpens.length, 1);
    assert.equal(scenario.nativeOpens[0].value.state.theme.fontSize, 14, "menu uses shared UI font size");
    assert.equal(scenario.nativeOpens[0].value.state.labels.search, "searchPlaceholder");
    assert.equal(JSON.stringify(scenario.requests[1].payload), JSON.stringify({id: "database", blockID: "carrier",
        viewID: "map-view", query: "main query", search: "", page: 1, pageSize: 50}));
    await scenario.nativeOpen();
    const pageRows = (page: number) => Array.from({length: page === 12 ? 1 : 50}, (_, index) => row(`record-${(page - 1) * 50 + index}`));
    await scenario.respond(1, pageRows(1), 551);
    assert.equal(scenario.nativeState().rows.length, 50);
    assert.equal(JSON.stringify(scenario.nativeState().rows[0]), JSON.stringify({id: "record-0", title: "<Title record-0>"}));
    assert.equal(scenario.nativeState().labels.more, "next");
    assert.equal(scenario.nativeState().labels.previous, "previous");
    for (let page = 2; page <= 12; page++) {
        scenario.nativeAction("more", {page});
        const index = scenario.requests.length - 1;
        assert.equal(scenario.requests[index].payload.page, page);
        await scenario.respond(index, pageRows(page), 551);
        assert.equal(scenario.nativeState().rows[0].id, `record-${(page - 1) * 50}`);
        assert.ok(scenario.nativeState().rows.length <= 50);
    }
    scenario.nativeAction("previous", {page: 11});
    await scenario.respond(scenario.requests.length - 1, pageRows(11), 551);
    scenario.nativeAction("select", {id: "record-550"});
    assert.equal(scenario.opens.length, 0, "a row from a replaced page is not selectable");
    scenario.nativeAction("select", {id: "record-500"});
    assert.equal(scenario.opens[0].row.id, "record-500");
    assert.equal(scenario.toggle.attributes.get("aria-expanded"), "false");
    assert.equal(scenario.toggle.focused, true);
    assert.equal((scenario.data.view as IAVTable).rows.length, 0);
    scenario.destroy();
});

test("native search aborts immediately while typing and rejects ABA responses with the same query", async () => {
    const scenario = setup(false, true);
    scenario.click();
    await scenario.nativeOpen();
    await scenario.respond(1, [row("original")], 1);
    scenario.nativeAction("editing");
    scenario.nativeAction("select", {id: "original"});
    assert.equal(scenario.opens.length, 0);
    scenario.setTheme("dark");
    const revision = scenario.nativeState().revision;
    scenario.runNativeFrames();
    assert.equal(scenario.nativeState().revision, revision, "theme updates never advance the data revision during editing");
    assert.equal(scenario.nativeSent.at(-1)?.channel, "siyuan-map-unplaced-theme");
    assert.equal(scenario.nativeSent.at(-1)?.value.theme.mode, "dark");
    scenario.nativeAction("search", {query: "same", page: 1});
    const first = scenario.requests.length - 1;
    scenario.nativeAction("editing");
    assert.equal(scenario.requests[first].signal.aborted, true);
    scenario.nativeAction("search", {query: "other", page: 1});
    const second = scenario.requests.length - 1;
    scenario.nativeAction("editing");
    scenario.nativeAction("search", {query: "same", page: 1});
    const last = scenario.requests.length - 1;
    assert.equal(scenario.requests[last].payload.search, "same");
    assert.equal(scenario.requests[last].payload.query, "main query");
    await scenario.respond(last, [row("latest")]);
    await scenario.respond(first, [row("stale-same")]);
    await scenario.respond(second, [row("stale-other")]);
    assert.equal(scenario.nativeState().rows[0].id, "latest");
    assert.equal(scenario.nativeState().theme.mode, "dark");
    scenario.destroy();
});

test("native paging failures retry the exact failed page and preserve the view query", async () => {
    const scenario = setup(false, true);
    scenario.click();
    await scenario.nativeOpen();
    await scenario.respond(1, [row("first")], 120);
    scenario.nativeAction("more", {page: 2});
    scenario.requests[2].reject(new Error("offline"));
    await flush();
    assert.equal(scenario.nativeState().error, true);
    assert.equal(scenario.nativeState().page, 2);
    scenario.nativeAction("retry", {page: 2});
    assert.equal(scenario.requests[3].payload.page, 2);
    await scenario.respond(3, [row("retry-page")], 120);
    assert.equal(scenario.nativeState().error, false);
    assert.equal(scenario.nativeState().rows[0].id, "retry-page");
    scenario.destroy();
});

test("native ownership rejects foreign session, instance, revision and request messages", async () => {
    const scenario = setup(false, true);
    scenario.click();
    await scenario.nativeOpen();
    await scenario.respond(1, [row("record")]);
    for (const mismatch of [{sessionID: "b".repeat(48)}, {instanceID: "other"}, {revision: 0}, {requestID: 999}]) {
        scenario.nativeReply({type: "action", action: "select", revision: scenario.nativeState().revision,
            requestID: scenario.nativeState().requestID, id: "record", ...mismatch});
    }
    assert.equal(scenario.opens.length, 0);
    assert.equal(scenario.toggle.attributes.get("aria-expanded"), "true");
    scenario.nativeAction("select", {id: "record"});
    assert.equal(scenario.opens.length, 1);
    scenario.destroy();
});

test("native menus close and abort proactively when their owner, permissions, field, view or encrypted notebook becomes unavailable", async () => {
    for (const mode of ["disabled", "published", "history", "field", "view", "removed", "notebook", "host", "canvas"]) {
        const scenario = setup(false, true);
        scenario.click();
        await scenario.nativeOpen();
        if (mode === "disabled") scenario.protyle.disabled = true;
        if (mode === "published") scenario.context.siyuan.isPublish = true;
        if (mode === "history") scenario.protyle.options.history = {created: "old"};
        if (mode === "field") (scenario.data.view as IAVTable).map.locationKeyID = "changed";
        if (mode === "view") scenario.data.viewID = "changed";
        if (mode === "removed") scenario.stale();
        if (mode === "notebook") {
            scenario.protyle.notebookId = "private";
            Object.assign(scenario.context.siyuan, {notebooks: [{id: "private", encrypted: true, closed: true}]});
        }
        if (mode === "host") scenario.releaseHost();
        if (mode === "canvas") scenario.canvas.remove();
        scenario.runNativeFrames();
        assert.equal(scenario.toggle.attributes.get("aria-expanded"), "false", mode);
        assert.equal(scenario.requests[1].signal.aborted, true, mode);
        await scenario.respond(1, [row("late")]);
        assert.equal(scenario.nativeSent.some(item => item.value.state?.rows.length), false, mode);
        scenario.destroy();
    }
});

test("closing or timing out a pending native open destroys a late session instead of reviving it", async () => {
    for (const close of ["toggle", "destroy", "timeout", "unregister"]) {
        const scenario = setup(false, true);
        scenario.click();
        if (close === "toggle") scenario.click();
        if (close === "destroy") scenario.destroy();
        if (close === "timeout") scenario.runNativeTimers();
        if (close === "unregister") scenario.releaseHost();
        assert.equal(scenario.toggle.attributes.get("aria-expanded"), "false", close);
        assert.equal(scenario.requests[1].signal.aborted, true, close);
        await scenario.nativeOpen();
        assert.equal(scenario.nativeSent.at(-1)?.channel, "siyuan-map-unplaced-close", close);
        assert.equal(scenario.nativeSent.at(-1)?.value.sessionID, "a".repeat(48), close);
        scenario.destroy();
    }
});

test("native owner outside click, Escape, scroll, occlusion, theme and visibility follow the live anchor", async () => {
    for (const mode of ["outside", "escape", "hidden", "occluded", "scroll", "collapsed", "transparent"]) {
        const scenario = setup(false, true);
        scenario.click();
        await scenario.nativeOpen();
        await scenario.respond(1, [row("entry")]);
        scenario.setTheme("dark");
        scenario.runNativeFrames();
        assert.equal(scenario.nativeSent.at(-1)?.channel, "siyuan-map-unplaced-theme");
        assert.equal(scenario.nativeSent.at(-1)?.value.theme.mode, "dark");
        if (mode === "outside") scenario.documentEvents.get("pointerdown")({target: new ElementStub()});
        if (mode === "escape") scenario.documentEvents.get("keydown")({key: "Escape", preventDefault() {}});
        if (mode === "hidden") { scenario.document.hidden = true; scenario.documentEvents.get("visibilitychange")(); }
        if (mode === "occluded") { scenario.document.elementFromPoint = () => new ElementStub(); scenario.runNativeFrames(); }
        if (mode === "scroll") {
            scenario.toggle.getBoundingClientRect = () => ({left: 1, top: 900, right: 25, bottom: 924, width: 24, height: 24});
            scenario.scopeEvents.get("scroll")();
        }
        if (mode === "collapsed" || mode === "transparent") {
            const previous = scenario.scope.getComputedStyle;
            scenario.scope.getComputedStyle = () => ({...previous(),
                visibility: mode === "collapsed" ? "collapse" : "visible", opacity: mode === "transparent" ? "0" : "1"});
            scenario.runNativeFrames();
        }
        assert.equal(scenario.toggle.attributes.get("aria-expanded"), "false", mode);
        if (mode === "escape") assert.equal(scenario.toggle.focused, true);
        scenario.destroy();
    }
});

test("mobile preserves its shared DOM menu even when a native host registration exists", () => {
    const scenario = setup(true, true);
    scenario.click();
    assert.equal(scenario.nativeOpens.length, 0);
    assert.equal(scenario.menus.length, 1);
    scenario.destroy();
});

test("a theme update crossed with a main-accepted typing action keeps the same data revision and resumes search", async () => {
    const scenario = setup(false, true);
    scenario.click();
    await scenario.nativeOpen();
    await scenario.respond(1, [row("first")]);
    const acceptedRevision = scenario.nativeState().revision;
    scenario.setTheme("dark");
    scenario.runNativeFrames();
    scenario.nativeAction("editing", {revision: acceptedRevision});
    scenario.nativeAction("search", {revision: acceptedRevision, query: "after theme", page: 1});
    assert.equal(scenario.requests[2].payload.search, "after theme");
    await scenario.respond(2, [row("after-theme")]);
    scenario.nativeAction("select", {id: "after-theme"});
    assert.equal(scenario.opens[0].row.id, "after-theme");
    scenario.destroy();
});

test("native open failures expose a fixed retry message and closed-before-open replies cannot revive a dead session", async () => {
    for (const mode of ["invalid", "timeout", "early-close", "closed", "resource"]) {
        const scenario = setup(false, true);
        scenario.click();
        if (mode === "invalid") { scenario.nativeOpens[0].resolve(undefined); await flush(); }
        if (mode === "timeout") scenario.runNativeTimers();
        if (mode === "early-close") {
            scenario.nativeReply({type: "closed", reason: "load-failed", restore: false});
            await scenario.nativeOpen();
        }
        if (mode === "closed" || mode === "resource") {
            await scenario.nativeOpen();
            scenario.nativeReply({type: "closed", reason: mode === "resource" ? "resource-failed" : "setup-failed", restore: false});
        }
        assert.equal(scenario.toggle.attributes.get("aria-expanded"), "false", mode);
        assert.equal(scenario.requests[1].signal.aborted, true, mode);
        assert.deepEqual(scenario.messages, ["mapUnplaced: retry"], mode);
        scenario.destroy();
    }
    const ordinary = setup(false, true);
    ordinary.click();
    await ordinary.nativeOpen();
    ordinary.nativeReply({type: "closed", reason: "outside", restore: false});
    assert.deepEqual(ordinary.messages, []);
    ordinary.destroy();
});

test("an API response crossed with main-accepted editing cannot strand the next search on an obsolete revision", async () => {
    const scenario = setup(false, true);
    scenario.click();
    await scenario.nativeOpen();
    const mainRevision = scenario.nativeState().revision;
    await scenario.respond(1, [row("arrived-before-editing-reply")]);
    assert.ok(scenario.nativeState().revision > mainRevision);
    scenario.nativeAction("editing", {revision: mainRevision});
    scenario.nativeAction("search", {revision: mainRevision, query: "next query", page: 1});
    assert.equal(scenario.requests[2].payload.search, "next query");
    await scenario.respond(2, [row("next-query")]);
    scenario.nativeReply({type: "action", action: "editing", revision: mainRevision, requestID: 1});
    scenario.nativeAction("select", {id: "next-query", revision: mainRevision});
    assert.equal(scenario.opens.length, 0, "selection still requires the exact current data revision");
    scenario.nativeAction("select", {id: "next-query"});
    assert.equal(scenario.opens[0].row.id, "next-query");
    scenario.destroy();
});

test("native opening follows anchor movement and theme changes that occur before the open reply", async () => {
    const scenario = setup(false, true);
    scenario.click();
    scenario.toggle.getBoundingClientRect = () => ({left: 600, top: 100, right: 624, bottom: 124, width: 24, height: 24});
    scenario.setTheme("dark");
    scenario.runNativeFrames();
    await scenario.nativeOpen();
    const anchor = [...scenario.nativeSent].reverse().find(item => item.channel === "siyuan-map-unplaced-anchor");
    assert.equal(JSON.stringify(anchor.value.anchor), JSON.stringify({x: 600, y: 100, width: 24, height: 24}));
    const theme = [...scenario.nativeSent].reverse().find(item => item.channel === "siyuan-map-unplaced-theme");
    assert.equal(theme.value.theme.mode, "dark");
    scenario.destroy();
});
