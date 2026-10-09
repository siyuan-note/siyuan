import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/locationColumn.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

test("location default CRS uses checked submenus on desktop and mobile", () => {
    for (const mobile of [false, true]) {
        const items: IMenu[] = [];
        const mobileItems: IMenu[] = [];
        const changes: string[] = [];
        const listeners = new Map<string, (event: any) => void>();
        let shown = 0;
        let closed = 0;
        let focused = false;
        const submenu = {querySelector: () => ({focus: () => focused = true})};
        const element = {
            dataset: {}, setAttribute() {}, focus() {},
            classList: {add() {}, remove() {}},
            querySelector: () => submenu,
            addEventListener: (type: string, handler: (event: any) => void) => listeners.set(type, handler),
            getBoundingClientRect: () => ({left: 0, bottom: 20, height: 20}),
            contains: (target: unknown) => target === submenu,
        };
        const api = {} as typeof import("./locationColumn");
        runInNewContext(compiled, {
            exports: api,
            window: {siyuan: {languages: {coordinateSystemUnknown: "Unknown", defaultCoordinateSystem: "Default", defaultCoordinateSystemTip: "New input only"},
                menus: {menu: {showSubMenu: () => shown++}}}},
            require: (name: string) => ({
                "../../../util/functions": {isMobile: () => mobile},
                "../../../menus/Menu": {MenuItem: class {
                    element = element;
                    constructor(options: IMenu) { items.push(...options.submenu); }
                }},
                "../../../plugin/Menu": {Menu: class {
                    addItem(item: IMenu) { mobileItems.push(item); }
                    open() { shown++; }
                }},
            })[name],
        });
        const column = {id: "location", type: "location", location: {defaultCoordinateSystem: "gcj02"}} as IAVColumn;
        api.bindLocationDefaultCoordinateSystem({
            column,
            menuElement: {
                querySelector: () => ({replaceWith: (replacement: unknown) => assert.equal(replacement, element)}),
                addEventListener() {},
                closest: () => ({remove: () => closed++}),
            } as unknown as HTMLElement,
            onChange: system => changes.push(system),
        });
        assert.deepEqual(items.map(item => item.label), ["Unknown", "WGS84", "GCJ-02", "BD-09"]);
        assert.deepEqual(items.map(item => item.checked), [false, false, true, false]);
        const event = {preventDefault() {}, stopPropagation() {}};
        if (mobile) {
            assert.equal(listeners.has("mouseenter"), false);
            listeners.get("click")(event);
            assert.equal(mobileItems.length, 4);
        } else {
            listeners.get("mouseenter")(event);
            listeners.get("keydown")({...event, key: "ArrowRight"});
            assert.equal(focused, true);
        }
        assert.ok(shown > 0);
        items[2].click({} as HTMLElement, {} as MouseEvent);
        assert.equal(changes.length, 0);
        items[1].click({} as HTMLElement, {} as MouseEvent);
        assert.deepEqual(changes, ["wgs84"]);
        assert.equal(closed, 2);
        assert.equal(column.location.defaultCoordinateSystem, "gcj02");
    }
});

test("location default CRS setting constructs symmetric do and undo operations", () => {
    const source = readFileSync("src/protyle/render/av/col.ts", "utf8");
    const start = source.indexOf("export const bindEditEvent =");
    const end = source.indexOf("    const visibilityElement =", start);
    const api: {bindEditEvent?: (options: unknown) => void} = {};
    const changes: unknown[] = [];
    const column = {id: "key", type: "location", location: {defaultCoordinateSystem: "unknown"}} as IAVColumn;
    runInNewContext(transpileModule(source.slice(start, end) + "};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports: api,
        getFieldsByData: () => [column],
        bindDateCalendarMenu: () => {},
        bindLocationDefaultCoordinateSystem: (options: {onChange: (system: string) => void}) => options.onChange("bd09"),
        transaction: (_protyle: unknown, doOperations: unknown, undoOperations: unknown) => changes.push([doOperations, undoOperations]),
    });
    api.bindEditEvent({data: {id: "database"}, menuElement: {querySelector: () => ({getAttribute: () => "key"})}});
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), [[
        [{action: "setAttrViewColLocationDefaultCoordinateSystem", id: "key", avID: "database", data: "bd09"}],
        [{action: "setAttrViewColLocationDefaultCoordinateSystem", id: "key", avID: "database", data: "unknown"}],
    ]]);
    assert.equal(column.location.defaultCoordinateSystem, "bd09");
});
