import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/automation.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("automation settings reject readonly, publishing and historical editors before fetching data", async () => {
    for (const mode of ["disabled", "readonly", "publish", "created", "snapshot"]) {
        const methods = {} as typeof import("./automation");
        runInNewContext(compiled, {
            exports: methods,
            window: {siyuan: {config: {readonly: mode === "readonly"}, isPublish: mode === "publish"}},
            require: (name: string) => name === "../../../util/fetch" ? {
                fetchSyncPost: () => assert.fail("protected editor fetched automation settings"),
            } : {},
        });
        await methods.openAutomationDialog({disabled: mode === "disabled", options: {
            history: {created: mode === "created" ? "history" : undefined, snapshot: mode === "snapshot" ? "snapshot" : undefined},
        }} as IProtyle, {} as HTMLElement, "database");
    }
});

test("mobile automation settings save compatible relation sources with an independent undo configuration", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const transactions: Array<{perform: IOperation[], undo: IOperation[], complete: () => void}> = [];
    const conditionList = {innerHTML: "", querySelectorAll: (): HTMLElement[] => []};
    const conditionHost = {innerHTML: "", querySelector: (selector: string) => selector === "[data-conditions]" ? conditionList : {addEventListener() {}}};
    const actionsHost = {innerHTML: "", querySelectorAll: (): HTMLElement[] => []};
    const body = {
        isConnected: true, innerHTML: "", querySelectorAll: (): HTMLElement[] => [],
        querySelector: (selector: string) => selector === "[data-source-conditions]" ? conditionHost : actionsHost,
        addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    };
    const button = (selector: string) => ({addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(`${selector}:${type}`, listener)});
    const element = {querySelector: (selector: string) => selector === "[data-body]" ? body : button(selector), contains: () => false};
    let destroyed = 0;
    let sheetBound = 0;
    let sheetDisposed = 0;
    let width = "";
    const rule = {id: "rule", name: "Copy relation", enabled: true, trigger: "changed", actions: [{
        type: "edit", target: "filtered", avID: "target", fields: {relation: {mode: "static", value: {type: "relation", relation: {blockIDs: [] as string[]}}}},
    }]};
    const database = {id: "source", keyValues: [
        {key: {id: "wrong", name: "Wrong target", type: "relation", relation: {avID: "elsewhere"}}},
        {key: {id: "compatible", name: "Same target", type: "relation", relation: {avID: "linked"}}},
    ], automations: {spec: 1, rules: [rule]}};
    const destination = {id: "target", keyValues: [{key: {id: "relation", name: "Relation", type: "relation", relation: {avID: "linked"}}}]};
    const methods = {} as typeof import("./automation");
    runInNewContext(compiled, {
        exports: methods,
        window: {siyuan: {config: {}, languages: {databaseAutomations: "Automations"}}},
        document: {activeElement: null},
        require: (name: string) => ({
            "../../../util/functions": {isMobile: () => true},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../util/fetch": {fetchSyncPost: async (_path: string, request: {id: string}) => ({code: 0, data: {av: request.id === "source" ? database : destination}})},
            "../../../dialog": {Dialog: class {
                element = element;
                constructor(private options: {width: string, destroyCallback: () => void}) { width = options.width; }
                destroy() { destroyed++; this.options.destroyCallback(); }
            }},
            "../../../mobile/util/bindBottomSheetDialog": {bindBottomSheetDialog: () => {
                sheetBound++;
                return () => { sheetDisposed++; };
            }},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[], options: {callback: () => void}) => {
                transactions.push({perform, undo, complete: options.callback});
            }},
        })[name] || {},
    });
    await methods.openAutomationDialog({options: {}} as IProtyle, {dataset: {nodeId: "carrier"}} as unknown as HTMLElement, "source");
    assert.equal(width, "100vw");
    assert.equal(sheetBound, 1);
    const target = {value: "source", matches: (selector: string) => selector === "[data-mode]",
        closest: (selector: string) => selector === "[data-index]" ? {dataset: {index: "0"}} : {dataset: {fieldId: "relation"}}};
    listeners.get("change")({target});
    listeners.get("[data-save]:click")({currentTarget: {blur() {}}});
    const performed = JSON.parse(JSON.stringify(transactions[0].perform[0]));
    const undone = JSON.parse(JSON.stringify(transactions[0].undo[0]));
    assert.equal(performed.action, "setAttrViewAutomations");
    assert.equal(performed.avID, "source");
    assert.equal(performed.data.rules[0].actions[0].fields.relation.keyID, "compatible");
    assert.equal(undone.data.rules[0].actions[0].fields.relation.mode, "static");
    assert.equal(database.automations.rules[0].actions[0].fields.relation.mode, "static");
    assert.equal(destroyed, 0);
    transactions[0].complete();
    assert.equal(destroyed, 1);
    assert.equal(sheetDisposed, 1);
});
