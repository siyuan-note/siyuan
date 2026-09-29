import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("selection conditions with the same path read only their own editor options", () => {
    const methods = {} as typeof import("./filter");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/filter.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        document: {querySelector: () => assert.fail("must not read another condition's options")},
        require: (name: string) => ({
            "./view": {getFieldsByData: () => [{id: "choice", type: "mSelect"}]},
            "./cell": {genCellValue: (type: string, mSelect: IAVCellSelectValue[]) => ({type, mSelect})},
        })[name] || {},
    });
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
    const methods = {} as typeof import("./filter");
    const fields = [{id: "text", type: "text"}];
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/filter.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        require: (name: string) => name === "./view" ? {getFieldsByData: () => fields} : {},
    });
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
