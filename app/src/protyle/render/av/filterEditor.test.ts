import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

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
