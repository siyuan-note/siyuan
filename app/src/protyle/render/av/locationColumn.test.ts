import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/locationColumn.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

test("location default CRS lists explicit systems and providers on desktop and mobile without guessing missing defaults", () => {
    for (const [mobile, defaultSystem] of [[false, "gcj02"], [true, "gcj02"], [false, "unknown"], [true, "unknown"]] as const) {
        const items: IMenu[] = [];
        const mobileItems: IMenu[] = [];
        const changes: string[] = [];
        const listeners = new Map<string, (event: any) => void>();
        const attributes = new Map<string, string>();
        let shown = 0;
        let closed = 0;
        let focused = false;
        const submenu = {querySelector: () => ({focus: () => focused = true})};
        const element = {
            dataset: {}, setAttribute: (name: string, value: string) => attributes.set(name, value), focus() {},
            classList: {add() {}, remove() {}},
            querySelector: () => submenu,
            addEventListener: (type: string, handler: (event: any) => void) => listeners.set(type, handler),
            getBoundingClientRect: () => ({left: 0, bottom: 20, height: 20}),
            contains: (target: unknown) => target === submenu,
        };
        const api = {} as typeof import("./locationColumn");
        runInNewContext(compiled, {
            exports: api,
            window: {siyuan: {languages: {
                coordinateSystemWGS84: "WGS84 (OpenFreeMap)", coordinateSystemGCJ02: "GCJ-02 (AMap, Tencent Maps)",
                coordinateSystemBD09: "BD-09 (Baidu Maps)", defaultCoordinateSystem: "Default", defaultCoordinateSystemTip: "New input only",
            },
                menus: {menu: {showSubMenu: () => shown++}}}},
            require: (name: string) => ({
                "../../../util/functions": {isMobile: () => mobile},
                "../../../menus/Menu": {MenuItem: class {
                    element = element;
                    constructor(options: IMenu) {
                        assert.equal(options.icon, "iconGlobe");
                        assert.equal(options.action, "iconInfo");
                        assert.equal(options.actionLabel, "New input only");
                        items.push(...options.submenu);
                    }
                }},
                "../../../plugin/Menu": {Menu: class {
                    addItem(item: IMenu) { mobileItems.push(item); }
                    open() { shown++; }
                }},
            })[name],
        });
        const column = {id: "location", type: "location", location: {defaultCoordinateSystem: defaultSystem}} as IAVColumn;
        api.bindLocationDefaultCoordinateSystem({
            column,
            menuElement: {
                querySelector: () => ({replaceWith: (replacement: unknown) => assert.equal(replacement, element)}),
                addEventListener() {},
                closest: () => ({remove: () => closed++}),
            } as unknown as HTMLElement,
            onChange: system => changes.push(system),
        });
        assert.deepEqual(items.map(item => item.label), ["WGS84 (OpenFreeMap)", "GCJ-02 (AMap, Tencent Maps)", "BD-09 (Baidu Maps)"]);
        assert.equal(attributes.has("title"), false);
        assert.deepEqual(items.map(item => item.checked), [false, defaultSystem === "gcj02", false]);
        assert.deepEqual(changes, []);
        const event = {preventDefault() {}, stopPropagation() {}};
        if (mobile) {
            assert.equal(listeners.has("mouseenter"), false);
            listeners.get("click")(event);
            assert.equal(mobileItems.length, 3);
        } else {
            listeners.get("mouseenter")(event);
            listeners.get("keydown")({...event, key: "ArrowRight"});
            assert.equal(focused, true);
        }
        assert.ok(shown > 0);
        items[1].click({} as HTMLElement, {} as MouseEvent);
        assert.deepEqual(changes, defaultSystem === "gcj02" ? [] : ["gcj02"]);
        items[0].click({} as HTMLElement, {} as MouseEvent);
        assert.deepEqual(changes, defaultSystem === "gcj02" ? ["wgs84"] : ["gcj02", "wgs84"]);
        assert.equal(closed, 2);
        assert.equal(column.location.defaultCoordinateSystem, defaultSystem);
    }
});

test("location field menus use a map marker without changing pin or coordinate system actions", () => {
    const source = readFileSync("src/protyle/render/av/col.ts", "utf8");
    const start = source.indexOf("export const getColIconByType =");
    const end = source.indexOf("const addAttrViewColAnimation =", start);
    const api = {} as {getColIconByType: (type: string) => string};
    runInNewContext(transpileModule(source.slice(start, end), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {exports: api});
    assert.equal(api.getColIconByType("location"), "iconMapPin");
    assert.match(source, /id: "location",\s*icon: "iconMapPin"/);
    assert.match(source, /icon: isFreeze \? "iconUnpin" : "iconPin"/);
    const icons = readFileSync("appearance/icons/litheness/icon.js", "utf8");
    const marker = icons.match(/<symbol id="iconMapPin"[^>]*>[\s\S]*?<\/symbol>/)?.[0];
    assert.ok(marker);
    assert.match(marker, /viewBox="0 0 24 24"/);
    assert.match(marker, /stroke="currentColor" stroke-width="1.7"/);
    assert.match(marker, /<circle cx="12" cy="10" r="3"/);
    assert.match(readFileSync("appearance/icons/index.html", "utf8"), /#iconGlobe[\s\S]*?#iconMapPin[\s\S]*?#iconPublish/);

    const renderSource = readFileSync("src/protyle/render/av/render.ts", "utf8");
    const renderStart = renderSource.indexOf("const getTableHTMLs =");
    const renderEnd = renderSource.indexOf("export const getGroupTitleHTML =", renderStart);
    const renderAPI = {} as {getTableHTMLs: (data: unknown, element: unknown) => string};
    runInNewContext(transpileModule("export " + renderSource.slice(renderStart, renderEnd), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports: renderAPI,
        getColIconByType: api.getColIconByType,
        escapeAttr: (value: string) => value || "",
        escapeHtml: (value: string) => value || "",
        unicode2Emoji: (value: string) => `custom-icon-${value}`,
        getCalcValue: () => "",
        window: {siyuan: {languages: {}}},
    });
    for (const avType of ["table", "list", "map"]) {
        for (const icon of ["", "1f4cd"]) {
            const html = renderAPI.getTableHTMLs({
                columns: [{id: "location", type: "location", name: "Location", icon}], rows: [], rowCount: 0,
            }, {dataset: {avType}});
            if (icon) {
                assert.match(html, /custom-icon-1f4cd/);
                assert.doesNotMatch(html, /#iconMapPin/);
            } else {
                assert.match(html, /class="av__cellheadericon"><use xlink:href="#iconMapPin"/);
            }
        }
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
