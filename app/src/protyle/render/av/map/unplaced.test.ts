import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {AVTableRow} from "../../../../types/api";
import * as escape from "../../../../util/escape";
import * as locationValue from "../locationValue";
import {getMapSettings} from "./state";

class ElementStub {
    isConnected = true;
    textContent = "";
    value = "";
    focused = false;
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
    remove() { this.isConnected = false; }
    focus() { this.focused = true; }
    getBoundingClientRect() { return {right: 500, bottom: 100, height: 24}; }
}

const row = (id: string, location?: IAVCellLocationValue): AVTableRow => ({id, cells: [
    {id: `primary-${id}`, value: {id: `primary-${id}`, type: "block", isDetached: true,
        block: {content: `<Title ${id}>`}}},
    {id: `location-${id}`, value: {id: `location-${id}`, type: "location", keyID: "location", location}},
]}) as AVTableRow;

const flush = () => new Promise(resolve => setImmediate(resolve));

const setup = (mobile = false) => {
    const requests: Array<{payload: any; signal: AbortSignal; resolve: (response: unknown) => void;
        reject: (reason?: unknown) => void}> = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const toggle = new ElementStub();
    toggle.classes.add("fn__none");
    const count = new ElementStub();
    const search = {textContent: "  main query  "};
    const input = new ElementStub();
    const root = {querySelector: () => toggle};
    const block = {dataset: {nodeId: "carrier", avId: "database"}, querySelector: () => search};
    const protyle = {options: {}} as IProtyle;
    const data = {id: "database", viewID: "map-view", view: {
        map: {locationKeyID: "location"}, columns: [{id: "location", type: "location"}],
        rows: [], rowCount: 1000,
    }} as IAV;
    let current = true;
    let positions = 0;
    const opens: Array<{row: IAVRow; keyID: string}> = [];
    const menus: MenuStub[] = [];
    class MenuStub {
        items: Array<{option: IMenu; element: ElementStub}> = [];
        element = {querySelector: () => count};
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
    const methods = {} as typeof import("./unplaced");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/unplaced.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, window: context, AbortController,
        clearTimeout: (id: number) => timers.delete(id), require: (id: string) => ({
            "../../../../constants": {Constants: {TIMEOUT_INPUT: 256, ATTRIBUTE_MENU_KEYMAP: "data-keymap"}},
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
            "./settings": {canEditMapSettings: () => !protyle.disabled && !context.siyuan.isPublish &&
                !protyle.options.history?.created && !protyle.options.history?.snapshot},
            "./openRecord": {openMapRecord: (_protyle: IProtyle, _block: HTMLElement, row: IAVRow, keyID: string) =>
                opens.push({row, keyID})},
        })[id] || {}});
    const destroy = methods.bindMapUnplaced({root: root as unknown as HTMLElement, blockElement: block as unknown as HTMLElement,
        protyle, data, current: () => current});
    return {methods, requests, menus, toggle, count, input, data, protyle, context, opens, destroy,
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
            }).outputText, {exports: nativeMenu, window: context, CustomEvent: class {}, require: (id: string) => ({
                "../constants": {Constants: {KEYCODELIST: {13: "↩"}}},
                "../protyle/util/compatibility": {getEventName: () => "click"},
            })[id] || {}});
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
        if (close === "toggle") scenario.click();
        if (close === "menu") scenario.menus[0].close();
        if (close === "destroy") scenario.destroy();
        assert.equal(scenario.requests[1].signal.aborted, true, close);
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
    scenario.menus[0].click("&lt;Title mobile>");
    assert.equal(scenario.opens[0].row.id, "mobile");
    scenario.destroy();
});
