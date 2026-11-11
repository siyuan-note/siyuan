import * as capabilities from "./capabilities";
import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";
import * as filterTree from "./filterTree";

for (const action of [undefined, "setAttrViewColRelationFilters", "setAttrViewColRollupFilters"] as const) {
    test(`${action || "view filters"} add and edit conditions with matching undo destinations`, () => {
        const submissions: Array<{doOperations: IOperation[], undoOperations: IOperation[]}> = [];
        const items: Array<{click: () => void}> = [];
        const methods = loadModule<typeof import("./filter")>("src/protyle/render/av/filter.ts", {
            window: {siyuan: {languages: new Proxy({}, {get: (_target, key) => String(key)})}},
            document: {createElement: () => ({style: {}, offsetWidth: 10}), body: {appendChild() {}, removeChild() {}}},
            require: (name: string) => name === "./capabilities" ? capabilities : ({
                "./filterTree": filterTree,
                "./view": {getFieldsByData: (data: IAV) => "columns" in data.view ? data.view.columns : data.view.fields},
                "./col": {getColIconByType: () => "iconText"},
                "../../../util/escape": {escapeAttr: String, escapeHtml: String},
                "../../../util/setPosition": {setPosition() {}},
                "../../../constants": {Constants: {}},
                "../../../plugin/Menu": {Menu: class {
                    addItem(item: {click: () => void}) { items.push(item); }
                    open() {}
                }},
                "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
                    submissions.push({doOperations, undoOperations});
                }},
            })[name] || {},
        }, ScriptTarget.ES2022);
        const data = {id: "target", view: {columns: [{id: "text", type: "text", name: "Text"}],
            filters: [{combination: "and", filters: []}]}} as unknown as IAV;
        const filterOperation = action ? {action, avID: "source", keyID: "source-field"} : undefined;
        methods.addFilter({data, avId: data.id, protyle: {} as IProtyle,
            blockElement: {getAttribute: () => "source-block"} as unknown as Element,
            rect: {} as DOMRect, tabRect: {} as DOMRect, menuElement: {} as HTMLElement, filterOperation});
        items[0].click();
        const changed = {column: "text", operator: "Contains", value: {type: "text", text: {content: "changed"}}} as IAVFilter;
        methods.commitFilter(data, "0", changed, {} as IProtyle, "source-block", data.id, null, false, filterOperation);
        assert.equal(submissions.length, 2);
        for (const submission of submissions) {
            for (const operation of [...submission.doOperations, ...submission.undoOperations]) {
                assert.equal(operation.action, action || "setAttrViewFilters");
                assert.equal(operation.avID, action ? "source" : "target");
                assert.equal(operation.keyID, action ? "source-field" : undefined);
                assert.equal(operation.blockID, "source-block");
            }
        }
        const filters = (operation: IOperation) => JSON.parse(JSON.stringify(operation.data)) as IAVFilter[];
        assert.deepEqual(filters(submissions[0].undoOperations[0]), [{combination: "and", filters: []}]);
        assert.deepEqual(filters(submissions[1].undoOperations[0]), filters(submissions[0].doOperations[0]));
        assert.deepEqual(filters(submissions[1].doOperations[0]), [{combination: "and", filters: [changed]}]);
        assert.equal(data.id, "target");
    });
}

test("selection conditions with the same path read only their own editor options", () => {
    const methods = loadModule<typeof import("./filter")>("src/protyle/render/av/filter.ts", {
        document: {querySelector: () => assert.fail("must not read another condition's options")},
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (({
            "./view": {getFieldsByData: () => [{id: "choice", type: "mSelect"}]},
            "./cell": {genCellValue: (type: string, mSelect: IAVCellSelectValue[]) => ({type, mSelect})},
        })[name] || {}),
    }, ScriptTarget.ES2022);
    for (const selected of [[], ["own option"]]) {
        const listeners = new Map<string, (event: unknown) => void>();
        const row = {dataset: {path: "0"}, querySelector: (selector: string) =>
            selector === '[data-type="operation"]' ? {value: "Contains"} : null};
        const dropdown = {querySelectorAll: () => selected.map(name => ({
            dataset: {name, color: "1"},
            querySelector: () => ({getAttribute: () => "#iconCheck"}),
        }))};
        const panel = {
            dataset: {}, innerHTML: "",
            querySelector: (selector: string) => selector.includes("selectDropdown") ? dropdown : row,
            addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
        };
        const data = {view: {filters: [{column: "choice", operator: "Is not empty", value: {type: "mSelect"}}]}} as IAV;
        methods.bindInlineFilterEvents(panel as unknown as HTMLElement, data, {} as IProtyle, "block", "database", {
            root: panel as unknown as HTMLElement, save() {}, render: () => "updated",
        });
        listeners.get("change")({target: {
            dataset: {type: "operation", path: "0"}, value: "Contains", closest: () => panel,
        }});
        assert.equal(data.view.filters[0].operator, "Contains");
        assert.deepEqual(Array.from(data.view.filters[0].value.mSelect || [], item => item.content), selected);
    }
});

test("nested color conditions do not change the parent view filter, including capture events", () => {
    const fields = [{id: "text", type: "text"}];
    const methods = loadModule<typeof import("./filter")>("src/protyle/render/av/filter.ts", {
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (name === "./view" ? {getFieldsByData: () => fields} : {}),
    }, ScriptTarget.ES2022);
    const createEditor = () => {
        const listeners = new Map<string, Array<(event: unknown) => void>>();
        const panel = {
            dataset: {}, innerHTML: "", querySelector: () => ({}),
            addEventListener: (type: string, listener: (event: unknown) => void) => {
                listeners.set(type, [...listeners.get(type) || [], listener]);
            },
        };
        const data = {view: {filters: [{column: "text", operator: "Is not empty", value: {type: "text"}}]}} as IAV;
        let saves = 0;
        methods.bindInlineFilterEvents(panel as unknown as HTMLElement, data, {} as IProtyle, "block", "database", {
            root: panel as unknown as HTMLElement,
            render: () => "updated condition",
            save: () => { saves++; },
        });
        return {panel, data, listeners, get saves() { return saves; }};
    };
    const outer = createEditor();
    const inner = createEditor();
    const target = {
        dataset: {type: "fieldSelect", path: "0"}, value: "text",
        closest: () => inner.panel,
    };
    for (const listeners of outer.listeners.values()) {
        listeners.forEach(listener => listener({target, key: "Enter"}));
    }
    assert.equal(outer.saves, 0);
    assert.equal(outer.data.view.filters[0].operator, "Is not empty");
    inner.listeners.get("change").forEach(listener => listener({target}));
    assert.equal(inner.saves, 1);
    assert.equal(inner.data.view.filters[0].operator, "Contains");
    assert.equal(inner.panel.innerHTML, "updated condition");
});

test("absolute filter date pickers defer blur saves, preserve invalid values, and bind replacement rows", () => {
    let open = false;
    const pickers = new Map<unknown, {onCommit: () => void}>();
    const methods = loadModule<typeof import("./filter")>("src/protyle/render/av/filter.ts", {
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : ({
            "./view": {getFieldsByData: () => [{id: "date", type: "date"}]},
            "../../../datePicker": {
                bindDatePicker: (input: unknown, options: {onCommit: () => void}) => pickers.set(input, options),
                isDatePickerOpen: () => open,
            },
        })[name] || {},
    }, ScriptTarget.ES2022);
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    let invalid = false;
    const createInput = () => ({value: "2026-11-11", isConnected: true,
        dataset: {type: "absDate", path: "0"}, closest: () => panel});
    let input = createInput();
    const row = {dataset: {path: "0"}, querySelector: (selector: string) => {
        if (selector.includes(":invalid")) return invalid ? input : null;
        if (selector === '[data-type="operation"]') return {value: "Is"};
        if (selector === '[data-type="dateType"]') return {value: "specific"};
        if (selector === '[data-type="absDate"]') return input;
        return null;
    }};
    const panel = {dataset: {}, querySelector: () => row,
        addEventListener: (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, [...listeners.get(type) || [], listener]);
        },
    };
    const fire = (type: string) => listeners.get(type)?.forEach(listener => listener({target: input}));
    const data = {view: {filters: [{column: "date", operator: "Is", value: {type: "date"}}]}} as unknown as IAV;
    let saves = 0;
    methods.bindInlineFilterEvents(panel as unknown as HTMLElement, data, {} as IProtyle, "block", "database", {
        root: panel as unknown as HTMLElement, save: () => saves++,
    });
    fire("pointerdown");
    assert.equal(pickers.has(input), true);
    assert.equal(saves, 0);
    open = true;
    fire("blur");
    assert.equal(saves, 0, "opening a child picker does not save the old value");
    open = false;
    input.value = "2026-12-31";
    pickers.get(input).onCommit();
    assert.equal(saves, 1);
    assert.equal(data.view.filters[0].value.date.content, new Date("2026-12-31T00:00:00").getTime());
    invalid = true;
    input.value = "";
    fire("blur");
    assert.equal(saves, 1, "incomplete input is not a deliberate clear");
    invalid = false;
    fire("blur");
    assert.equal(saves, 2);
    assert.equal(data.view.filters[0].value.date.isNotEmpty, false);
    input = createInput();
    fire("focusin");
    assert.equal(pickers.has(input), true, "rows replaced during operator or relative-mode changes remain bound");
    input.value = "2027-01-01";
    open = true;
    fire("blur");
    open = false;
    assert.equal(saves, 2, "cancelling has no commit callback and no write");
    pickers.get(input).onCommit();
    assert.equal(saves, 3);
});

test("date filter structure changes validate only the absolute endpoints they retain", () => {
    const methods = loadModule<typeof import("./filter")>("src/protyle/render/av/filter.ts", {
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities :
            name === "./view" ? {getFieldsByData: () => [{id: "date", type: "date"}]} : {},
    }, ScriptTarget.ES2022);
    const cases = [
        {operator: "Is empty", mode: "specific", invalidStart: true, invalidEnd: true, saved: true},
        {operator: "Is not empty", mode: "specific", invalidStart: true, invalidEnd: true, saved: true},
        {operator: "Is", mode: "specific", invalidStart: false, invalidEnd: true, saved: true},
        {operator: ">", mode: "specific", invalidStart: false, invalidEnd: true, saved: true},
        {operator: "Is", mode: "specific", invalidStart: true, invalidEnd: false, saved: false},
        {operator: "Is between", mode: "specific", invalidStart: false, invalidEnd: true, saved: false},
        {operator: "Is between", mode: "custom", invalidStart: true, invalidEnd: true, saved: true},
    ];
    for (const item of cases) {
        const description = JSON.stringify(item);
        const listeners = new Map<string, (event: unknown) => void>();
        const control = (type: string, value: string) => ({value, dataset: {type, path: "0"}, closest: (): unknown => panel});
        const controls: Record<string, ReturnType<typeof control>> = {
            operation: control("operation", item.operator), dateType: control("dateType", item.mode),
            absDate: control("absDate", item.invalidStart ? "" : "2026-11-11"),
            absDate2: control("absDate2", item.invalidEnd ? "" : "2026-11-12"),
            dataDirection: control("dataDirection", "-1"), relCount: control("relCount", "2"), relUnit: control("relUnit", "0"),
            dataDirection2: control("dataDirection2", "1"), relCount2: control("relCount2", "3"), relUnit2: control("relUnit2", "1"),
        };
        const row = {dataset: {path: "0"}, querySelector: (selector: string): ReturnType<typeof control> | null => {
            if (selector.includes('data-type^="absDate"') && selector.endsWith(":invalid")) {
                return item.invalidStart ? controls.absDate : item.invalidEnd ? controls.absDate2 : null;
            }
            const type = /data-type="([^"]+)"/.exec(selector)?.[1];
            if (selector.endsWith(":invalid")) {
                return type === "absDate" && item.invalidStart ? controls.absDate :
                    type === "absDate2" && item.invalidEnd ? controls.absDate2 : null;
            }
            return controls[type] || null;
        }};
        const panel = {dataset: {}, innerHTML: "original", querySelector: () => row,
            addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener)};
        const data = {view: {filters: [{column: "date", operator: "Is between", value: {type: "date", date: {
            content: 1, isNotEmpty: true, content2: 2, isNotEmpty2: true, hasEndDate: true, isNotTime: true,
        }}}]}} as unknown as IAV;
        let saves = 0;
        methods.bindInlineFilterEvents(panel as unknown as HTMLElement, data, {} as IProtyle, "block", "database", {
            root: panel as unknown as HTMLElement, save: () => saves++, render: () => "updated",
        });
        listeners.get("change")({target: item.mode === "custom" ? controls.dateType : controls.operation});
        assert.equal(saves, Number(item.saved), description);
        assert.equal(panel.innerHTML, item.saved ? "updated" : "original", description);
        if (!item.saved) {
            assert.equal(data.view.filters[0].value.date.content, 1, description);
        } else if (item.mode === "custom") {
            assert.deepEqual(JSON.parse(JSON.stringify(data.view.filters[0].relativeDate)), {count: 2, unit: 0, direction: -1});
            assert.deepEqual(JSON.parse(JSON.stringify(data.view.filters[0].relativeDate2)), {count: 3, unit: 1, direction: 1});
        } else if (item.operator === "Is empty" || item.operator === "Is not empty") {
            assert.equal(data.view.filters[0].operator, item.operator);
            assert.equal(data.view.filters[0].value.date, undefined);
        } else {
            assert.equal(data.view.filters[0].value.date.content, new Date("2026-11-11T00:00:00").getTime());
            assert.equal(data.view.filters[0].value.date.isNotEmpty2, false);
        }
    }
});
