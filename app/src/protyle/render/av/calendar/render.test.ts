import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";
import * as dates from "./date";
import {cellValueIsEmpty, createEmptyAVValue} from "../cellValue";
import {getConditionalBackground} from "../conditionalColor";

const search = {bindAvSearch() {}, captureAvSearchSelection() {}, deferAvSearchRender: () => false};

test("calendar refreshes the current view after composition and captures the latest selection before replacing the header", async () => {
    const range = {start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 8, 8).getTime(), timeZone: "UTC"};
    const input = {textContent: "before after"};
    const selection = {anchor: 9, focus: 2};
    const root = {querySelectorAll: (): unknown[] => [], querySelector: () => ({addEventListener() {}}),
        addEventListener() {}};
    let composing = true;
    let captured = false;
    let replaced = false;
    let completed = false;
    let refreshed = 0;
    let viewID = "calendar";
    let deferred: () => void;
    let bound: Parameters<typeof import("../search").bindAvSearch>[0];
    const block = {dataset: {}, removeAttribute() {}, querySelector: (selector: string) =>
        selector === ".av__calendar" ? root : input};
    const modules: Record<string, unknown> = {
        "./date": dates,
        "./state": {getCalendarState: () => ({anchor: range.start, mode: "month", rowLimit: 3}), getCalendarRequestRange: () => range},
        "../render": {
            genTabHeaderHTML: (data: IAV) => { assert.equal(data.viewID, viewID); return ""; },
            avRender(element: HTMLElement, protyle: IProtyle, callback: (data: IAV) => void) {
                refreshed++;
                return api.renderCalendar(element, protyle, {viewID,
                    view: {calendar: {}, columns: [], rows: [], calendarRange: range}} as unknown as IAV, callback);
            },
        },
        "../../../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../../../constants": {Constants: {ZWSP: ""}},
        "../container": {replaceAVContainer() { assert.equal(captured, true); replaced = true; }},
        "../virtualScroll": {getAVSelectedItemIDs: (): string[] => [], setAVData() {}},
        "../richText": {renderAVRichTextElements() {}},
        "../locate": {finishAVLocate() {}},
        "../search": {
            deferAvSearchRender(element: unknown, render: () => void) {
                assert.equal(element, input);
                deferred = render;
                return composing;
            },
            captureAvSearchSelection(element: unknown) {
                assert.equal(replaced, false);
                assert.equal(element, input);
                captured = true;
                return selection;
            },
            bindAvSearch(options: typeof bound) { bound = options; },
        },
    };
    const api = {} as typeof import("./render");
    runInNewContext(transpileModule(readFileSync(join(__dirname, "render.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports: api, require: (name: string) => modules[name] || {},
        window: {siyuan: {config: {lang: "en"}, languages: {}}}, document: {activeElement: input},
    });
    await api.renderCalendar(block as unknown as HTMLElement, {disabled: true, options: {}} as IProtyle,
        {viewID: "calendar", view: {calendar: {}, columns: [], rows: [], calendarRange: range}} as unknown as IAV,
        () => { completed = true; });
    assert.equal(replaced, false);
    assert.equal(captured, false);
    assert.equal(completed, false);
    composing = false;
    viewID = "another-calendar";
    input.textContent = "before latest after";
    deferred();
    assert.equal(refreshed, 1);
    assert.equal(replaced, true);
    assert.equal(completed, true);
    assert.equal(bound.query, input.textContent);
    assert.equal(bound.isSearching, true);
    assert.equal(bound.selection, selection);
});

test("calendar omits empty fields while preserving zero, unchecked boxes and rendered values", async () => {
    const start = new Date(2026, 8, 1).getTime();
    const range = {start, end: dates.addCalendarDays(start, 7), timeZone: "UTC"};
    const types: TAVCol[] = ["text", "number", "phone", "url", "email", "template", "select", "mSelect", "relation", "rollup", "mAsset", "date"];
    const values = types.map(type => createEmptyAVValue(`empty-${type}`, type));
    values.push(
        {...createEmptyAVValue("date", "date"), date: {content: start, isNotEmpty: true, isNotTime: true}},
        {...createEmptyAVValue("zero", "number"), number: {content: 0, isNotEmpty: true}},
        createEmptyAVValue("unchecked", "checkbox"),
        {...createEmptyAVValue("rendered", "text"), renderedContent: "Rendered", hasRenderTemplate: true},
        {...createEmptyAVValue("blank-rendered", "text"), text: {content: "Source"}, renderedContent: "", hasRenderTemplate: true},
        createEmptyAVValue("primary", "block"),
    );
    let html = "";
    const complete = new Error("rendered");
    const api = {} as typeof import("./render");
    const modules: Record<string, unknown> = {
        "./date": dates,
        "./state": {getCalendarState: () => ({anchor: start, mode: "week", rowLimit: 3}), getCalendarRequestRange: () => range},
        "./settings": {isCalendarDateColumn: () => true},
        "../cellValue": {cellValueIsEmpty},
        "../conditionalColor": {getConditionalBackground},
        "../cell": {renderCell: () => "<span></span>"},
        "../render": {genTabHeaderHTML: () => ""},
        "../search": search,
        "../../../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../../../constants": {Constants: {}},
        "../virtualScroll": {getAVSelectedItemIDs: (): string[] => []},
        "../container": {replaceAVContainer: (_block: unknown, value: string) => { html = value; throw complete; }},
    };
    runInNewContext(transpileModule(readFileSync(join(__dirname, "render.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports: api, require: (name: string) => modules[name] || {},
        window: {siyuan: {config: {lang: "en"}, languages: {}}}, document: {activeElement: null},
    });
    await assert.rejects(api.renderCalendar({querySelector: (): null => null, removeAttribute() {}} as unknown as HTMLElement,
        {disabled: true, options: {}} as IProtyle, {viewID: "calendar", view: {
            calendar: {dateKeyID: "date"}, calendarRange: range,
            columns: values.map(value => ({id: value.keyID, type: value.type, name: value.keyID})),
            rows: [{id: "row", cells: values.map(value => ({value})), conditionalColors: {background: {content: "", color: "3"}}}],
        }} as unknown as IAV), error => error === complete);
    for (const type of types) {
        assert.doesNotMatch(html, new RegExp(`data-field-id="empty-${type}"`));
    }
    assert.doesNotMatch(html, /data-field-id="blank-rendered"/);
    assert.match(html, /--b3-av-calendar-background:var\(--b3-font-background3\)/);
    for (const key of ["primary", "date", "zero", "unchecked", "rendered"]) {
        assert.match(html, new RegExp(`data-field-id="${key}"`));
    }
});

test("calendar without a date field renders its setup instead of reading an absent undated cache", async () => {
    const range = {start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 8, 8).getTime(), timeZone: "UTC"};
    const state = {anchor: range.start, mode: "month", rowLimit: 3};
    const complete = new Error("container rendered");
    let html = "";
    const exports = {} as typeof import("./render");
    const modules: Record<string, unknown> = {
        "./date": dates,
        "./state": {getCalendarState: () => state, getCalendarRequestRange: () => range},
        "./settings": {getCalendarSettingsHTML: () => "date-field-settings"},
        "../render": {genTabHeaderHTML: () => "view-switcher"},
        "../search": search,
        "../col": {getColNameByType: (type: string) => type},
        "../../../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../../../constants": {Constants: {ZWSP: ""}},
        "../container": {replaceAVContainer: (_block: unknown, value: string) => {
            html = value;
            throw complete;
        }},
        "../virtualScroll": {getAVSelectedItemIDs: (): string[] => []},
    };
    runInNewContext(transpileModule(readFileSync(join(__dirname, "render.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports, require: (name: string) => modules[name] || {},
        window: {siyuan: {config: {lang: "en"}, languages: {calendarSelectDateField: "Select date field"}}},
        document: {activeElement: null},
    });
    await assert.rejects(exports.renderCalendar({querySelector: (): null => null, removeAttribute() {}} as unknown as HTMLElement,
        {options: {}} as IProtyle,
        {viewID: "calendar", view: {calendar: {}, columns: [], rows: [], calendarRange: range}} as unknown as IAV),
    error => error === complete);
    assert.match(html, /view-switcher/);
    assert.match(html, /Select date field/);
    assert.match(html, /date-field-settings/);
});

test("calendar refresh keeps selected event segments and blank clicks dismiss the menu", async () => {
    const range = {start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 8, 8).getTime(), timeZone: "UTC"};
    const state = {anchor: range.start, mode: "month", rowLimit: 3};
    const items = ["selected", "other", "selected"].map(id => ({
        dataset: {calendarItem: id},
        selected: false,
        classList: {toggle(name: string, selected: boolean) {
            assert.equal(name, "av__gallery-item--select");
            items.find(item => item.classList === this)!.selected = selected;
        }},
    }));
    let click: (event: unknown) => void;
    let menuClosed = 0;
    const root = {
        querySelectorAll: () => items,
        querySelector: () => ({addEventListener() {}}),
        addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
            if (type === "click" && !capture) {
                click = listener;
            }
        },
    };
    const modules: Record<string, unknown> = {
        "./date": dates,
        "./state": {getCalendarState: () => state, getCalendarRequestRange: () => range},
        "./settings": {getCalendarSettingsHTML: () => "", bindCalendarSettings() {}},
        "../render": {genTabHeaderHTML: () => ""},
        "../col": {getColNameByType: (type: string) => type},
        "../../../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../../../constants": {Constants: {ZWSP: ""}},
        "../container": {replaceAVContainer() {}},
        "../virtualScroll": {getAVSelectedItemIDs: () => ["selected", "deleted"], setAVData() {}},
        "../search": search,
        "../richText": {renderAVRichTextElements() {}},
        "../locate": {finishAVLocate() {}},
    };
    const exports = {} as typeof import("./render");
    runInNewContext(transpileModule(readFileSync(join(__dirname, "render.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports, require: (name: string) => modules[name] || {},
        window: {siyuan: {config: {lang: "en"}, languages: {}, menus: {menu: {remove() { menuClosed++; }}}}},
        document: {activeElement: null},
    });
    await exports.renderCalendar({
        dataset: {},
        querySelector: (selector: string) => selector === ".av__calendar" ? root : null,
        removeAttribute() {},
    } as unknown as HTMLElement, {options: {}} as IProtyle,
    {viewID: "calendar", view: {calendar: {}, columns: [], rows: [], calendarRange: range}} as unknown as IAV);
    assert.deepEqual(items.map(item => item.selected), [true, false, true]);
    let stopped = false;
    click({target: {closest: (): null => null}, stopPropagation() { stopped = true; }});
    assert.equal(menuClosed, 1);
    assert.equal(stopped, true);
});

test("calendar checkbox clicks and keyboard activation update only the chosen field and honor readonly modes", async () => {
    for (const mode of ["desktop", "mobile", "disabled", "publish", "history", "snapshot", "desktop-template", "mobile-template"]) {
        const computed = mode.endsWith("-template");
        const start = new Date(2026, 8, 1).getTime();
        const range = {start, end: dates.addCalendarDays(start, 7), timeZone: "UTC"};
        const values = [
            {...createEmptyAVValue("date", "date"), date: {content: start, isNotEmpty: true, isNotTime: true}},
            createEmptyAVValue("first", "checkbox"), createEmptyAVValue("second", "checkbox"),
        ];
        if (computed) {
            values[0] = {...values[0], date: {isNotEmpty: false}, hasRenderTemplate: true, renderedContent: "2026-09-01"};
        }
        const cells = values.map(value => ({id: value.keyID, value}));
        const handlers: Record<string, (event: unknown) => void> = {};
        const updates: unknown[] = [];
        let opens = 0;
        let html = "";
        let startDrag: () => void;
        let menusClosed = 0;
        const menuIcons: string[] = [];
        const root = {
            isConnected: true,
            classList: {add() {}},
            querySelectorAll: (): unknown[] => [],
            querySelector: () => ({addEventListener() {}}),
            addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
                if (capture !== true) {
                    handlers[type] = listener;
                }
            },
        };
        const modules: Record<string, unknown> = {
            "./date": dates,
            "./state": {getCalendarState: () => ({anchor: start, mode: "week", rowLimit: 3}), getCalendarRequestRange: () => range},
            "./settings": {isCalendarDateColumn: () => true, bindCalendarSettings() {}},
            "./undated": {getCalendarUndatedHTML: () => "", bindCalendarUndated() {}},
            "./hitTest": {getCalendarDropDay: () => start},
            "./preview": {createCalendarPreviewLayout: () => ({})},
            "../render": {genTabHeaderHTML: () => ""},
            "../cellValue": {cellValueIsEmpty},
            "../conditionalColor": {getConditionalBackground},
            "../cell": {renderCell: () => "<span></span>", updateCellsValue: (...args: unknown[]) => updates.push(args)},
            "../openDatabaseRow": {openDatabaseRowByData: () => opens++},
            "../action": {avContextmenu: (_protyle: unknown, _item: unknown, _position: unknown,
                options: {customize: (menu: unknown) => void}) => options.customize({
                addSeparator() {}, addItem: (item: {icon: string}) => menuIcons.push(item.icon),
            })},
            "../../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../../util/functions": {isMobile: () => mode.startsWith("mobile")},
            "../../../../constants": {Constants: {ZWSP: ""}},
            "../container": {replaceAVContainer: (_block: unknown, value: string) => { html = value; }},
            "../virtualScroll": {getAVSelectedItemIDs: (): string[] => [], setAVData() {}},
            "../search": search,
            "../richText": {renderAVRichTextElements() {}},
            "../locate": {finishAVLocate() {}},
        };
        const exports = {} as typeof import("./render");
        runInNewContext(transpileModule(readFileSync(join(__dirname, "render.ts"), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
        }).outputText, {
            exports, require: (name: string) => modules[name] || {},
            window: {siyuan: {isPublish: mode === "publish", config: {lang: "en"}, languages: {},
                menus: {menu: {remove() { menusClosed++; }}}},
            setTimeout: (callback: () => void) => { startDrag = callback; return 1; }, addEventListener() {}},
            AbortController,
            document: {activeElement: null},
        });
        const block = {dataset: {avId: "database", nodeId: "carrier"},
            querySelector: (selector: string) => selector === ".av__calendar" ? root : null, removeAttribute() {}};
        const protyle = {disabled: mode === "disabled", options: {history: {
            created: mode === "history" ? "history" : "", snapshot: mode === "snapshot" ? "snapshot" : "",
        }}} as IProtyle;
        await exports.renderCalendar(block as unknown as HTMLElement, protyle, {viewID: "calendar", view: {
            calendar: {dateKeyID: "date"}, calendarRange: range,
            columns: values.map(value => ({id: value.keyID, type: value.type, name: value.keyID,
                renderTemplate: computed && value.type === "date" ? "2026-09-01" : ""})),
            rows: [{id: "row", cells}],
        }} as unknown as IAV);
        const editable = mode === "desktop" || mode === "mobile" || computed;
        assert.match(html, new RegExp(`role="checkbox" tabindex="${editable ? "0" : "-1"}" aria-checked="false" aria-disabled="${!editable}"`));
        const item = {dataset: {calendarItem: "row"}};
        const field = {dataset: {colId: "second"}, closest: () => item};
        const target = {closest: (selector: string) => selector.includes("checkbox") ? field : item};
        handlers.click({target, stopPropagation() {}});
        handlers.keydown({target, key: " ", preventDefault() {}, stopPropagation() {}});
        handlers.pointerdown({target, button: 0, pointerType: "mouse", stopPropagation() {}});
        handlers.touchstart({target, touches: [{}]});
        assert.equal(opens, 0);
        assert.equal(updates.length, editable ? 2 : 0);
        for (const args of updates as Parameters<typeof import("../cell").updateCellsValue>[]) {
            assert.deepEqual(JSON.parse(JSON.stringify(args[2])), {checked: true});
            assert.equal(args[9][0].cell, cells[2]);
            assert.equal(args[9][0].rowID, "row");
            assert.equal(args[9][0].colID, "second");
        }
        if (computed) {
            assert.match(html, /data-calendar-item="row"/);
            assert.match(html, /2026-09-01/);
            assert.doesNotMatch(html, /data-calendar-(move|resize|add|undated-toggle)/);
            const eventTarget = {closest: (selector: string) => selector === "[data-calendar-item]" ? item : null};
            handlers.pointerdown({target: eventTarget, button: 0, pointerType: "mouse", stopPropagation() {}});
            handlers.touchstart({target: eventTarget, touches: [{identifier: 1, clientX: 10, clientY: 20}]});
            assert.equal(startDrag, undefined);
            handlers.contextmenu({target: eventTarget, clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {}});
            assert.deepEqual(menuIcons, ["iconOpen"]);
        }
        if (mode === "mobile") {
            const closedBeforeDrag = menusClosed;
            handlers.touchstart({
                target: {closest: (selector: string) => selector === "[data-calendar-item]" ? item : null},
                touches: [{identifier: 1, clientX: 10, clientY: 20}],
            });
            assert.equal(menusClosed, closedBeforeDrag, "touching an event does not dismiss its menu before dragging");
            startDrag();
            assert.equal(menusClosed, closedBeforeDrag + 1, "long-press dragging dismisses the item menu");
        }
    }
});

test("calendar edit-mode changes refresh controls and stale actions cannot create rows", async () => {
    for (const mobile of [false, true]) {
        const start = new Date(2026, 8, 1).getTime();
        const range = {start, end: dates.addCalendarDays(start, 7), timeZone: "UTC"};
        const state = {anchor: start, mode: "week", rowLimit: 3, expandedWeeks: new Set()};
        const handlers: Record<string, (event: unknown) => void> = {};
        let html = "";
        let created = 0;
        const root = {
            querySelectorAll: (): unknown[] => [],
            querySelector: () => ({addEventListener() {}}),
            addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
                if (capture !== true) {
                    handlers[type] = listener;
                }
            },
        };
        const block = {dataset: {avId: "database", nodeId: "carrier"},
            querySelector: (selector: string) => selector === ".av__calendar" ? root : null, removeAttribute() {}};
        const data = {viewID: "calendar", viewType: "calendar", view: {
            calendar: {dateKeyID: "date"}, calendarRange: range,
            columns: [{id: "date", type: "date"}], rows: [],
        }} as unknown as IAV;
        const protyle = {disabled: true, options: {}, element: {getAttribute: (): null => null},
            wysiwyg: {element: {style: {}, setAttribute() {},
                querySelectorAll: (selector: string) => selector === '.av[data-av-type="calendar"]' ? [block] : []}},
        } as unknown as IProtyle;
        const calendar = {} as typeof import("./render");
        const modules: Record<string, unknown> = {
            "./date": dates,
            "./state": {getCalendarState: () => state, getCalendarRequestRange: () => range},
            "./settings": {isCalendarDateColumn: () => true},
            "./undated": {getCalendarUndatedHTML: () => "", bindCalendarUndated() {}},
            "../render": {genTabHeaderHTML: () => ""},
            "../newItemTemplate": {createAttributeViewItem: () => created++},
            "../../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../../constants": {Constants: {ZWSP: ""}},
            "../container": {replaceAVContainer: (_block: unknown, value: string) => { html = value; }},
            "../virtualScroll": {getAVData: () => data, getAVSelectedItemIDs: (): string[] => [], setAVData() {}},
            "../search": search,
            "../richText": {renderAVRichTextElements() {}},
            "../locate": {finishAVLocate() {}},
            "../render/av/calendar/render": calendar,
            "../../util/functions": {isMobile: () => mobile},
            "../ui/hideElements": {hideElements() {}},
            "./disabledWYSIWYG": {disabledWYSIWYG() {}},
            "./setEditMode": {updateMobileTitleReadonly() {}},
            "../../dialog/tooltip": {hideTooltip() {}},
            "./compatibility": {isAndroid: () => mobile, isIPhone: () => false},
        };
        const context = {
            require: (name: string) => modules[name] || {},
            window: {siyuan: {config: {lang: "en"}, languages: {}, menus: {menu: {remove() {}}}}},
            document: {activeElement: null as Element | null},
        };
        const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
        }).outputText;
        runInNewContext(compile(join(__dirname, "render.ts")), {...context, exports: calendar});
        const modes = {} as typeof import("../../../util/onGet");
        runInNewContext(compile(join(__dirname, "../../../util/onGet.ts")), {...context, exports: modes});
        await calendar.renderCalendar(block as unknown as HTMLElement, protyle, data);
        assert.doesNotMatch(html, /data-calendar-add=/);
        modes.enableProtyle(protyle);
        assert.match(html, /data-calendar-add=/);
        const editableClick = handlers.click;
        const clickAdd = () => editableClick({stopPropagation() {}, target: {
            closest: (selector: string) => selector === "[data-calendar-add]" ? {dataset: {calendarAdd: start}} : null,
        }});
        clickAdd();
        assert.equal(created, 1);
        modes.disabledProtyle(protyle);
        assert.doesNotMatch(html, /data-calendar-add=/);
        clickAdd();
        assert.equal(created, 1, "a handler retained before locking must check the current mode");
        modes.enableProtyle(protyle);
        assert.match(html, /data-calendar-add=/);
        clickAdd();
        assert.equal(created, 2);
    }
});
