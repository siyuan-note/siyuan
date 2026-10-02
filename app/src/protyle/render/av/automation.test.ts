import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {AVAttributeViewData} from "../../../types/api";

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
        await methods.openAutomationMenu({protyle: {disabled: mode === "disabled", options: {
            history: {created: mode === "created" ? "history" : undefined, snapshot: mode === "snapshot" ? "snapshot" : undefined},
        }} as IProtyle, blockElement: {} as HTMLElement, avID: "database", menuElement: {} as HTMLElement, onResize() {}});
    }
});

test("automation settings reuse the menu and return after saving with an independent undo configuration", async () => {
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
    const panel = {isConnected: true, querySelector: (selector: string) => selector === "[data-body]" ? body : button(selector),
        addEventListener() {}};
    let returned = 0;
    let resized = 0;
    let menuVisible = false;
    let captureClick: () => void;
    const classes = new Set(["b3-menu--fullscreen", "b3-menu--sheet"]);
    const menu = {innerHTML: "", classList: {add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name)},
        addEventListener: (_type: string, listener: () => void, capture: boolean) => {
            assert.equal(capture, true);
            captureClick = listener;
        },
        removeEventListener: (_type: string, listener: () => void) => assert.equal(listener, captureClick),
        querySelector: (selector: string) => selector === ".av__automation" ? panel : {click() { returned++; }}};
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
        window: {siyuan: {config: {}, languages: {databaseAutomations: "Automations"},
            menus: {menu: {remove() { menuVisible = false; }}}}},
        require: (name: string) => ({
            "../../../plugin/Menu": {Menu: class {
                addItem() {}
                open() { menuVisible = true; }
            }},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../util/fetch": {fetchSyncPost: async (_path: string, request: {id: string}) => ({code: 0, data: {av: request.id === "source" ? database : destination}})},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[], options: {callback: () => void}) => {
                transactions.push({perform, undo, complete: options.callback});
            }},
        })[name] || {},
    });
    await methods.openAutomationMenu({protyle: {options: {}} as IProtyle,
        blockElement: {dataset: {nodeId: "carrier"}} as unknown as HTMLElement, avID: "source",
        menuElement: menu as unknown as HTMLElement, onResize() { resized++; }});
    assert.ok(classes.has("av__automation-panel"));
    assert.ok(classes.has("b3-menu--fullscreen"));
    assert.ok(classes.has("b3-menu--sheet"));
    assert.match(menu.innerHTML, /data-type="go-config"/);
    assert.ok(resized >= 2);
    const addField = {dataset: {action: "add-field"}, closest: () => ({dataset: {index: "0"}}),
        getBoundingClientRect: () => ({left: 0, bottom: 0, height: 20})};
    captureClick();
    listeners.get("click")({target: {closest: () => addField}});
    assert.equal(menuVisible, true);
    captureClick();
    listeners.get("click")({target: {closest: (): HTMLElement => null}});
    assert.equal(menuVisible, false);
    assert.equal(transactions.length, 0);
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
    assert.equal(returned, 0);
    transactions[0].complete();
    assert.equal(returned, 1);
    panel.isConnected = false;
    menuVisible = true;
    captureClick();
    assert.equal(menuVisible, true);
    transactions[0].complete();
    assert.equal(returned, 1);
});

test("empty automation settings open a new draft and only persist it on save", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const transactions: Array<{perform: IOperation[], undo: IOperation[]}> = [];
    const list = {innerHTML: "", querySelectorAll: (): HTMLElement[] => []};
    const conditions = {innerHTML: "", querySelector: (selector: string) => selector === "[data-conditions]" ? list : {addEventListener() {}}};
    const body = {isConnected: true, innerHTML: "", addEventListener() {}, querySelectorAll: (): HTMLElement[] => [],
        querySelector: (selector: string) => selector === "[data-source-conditions]" ? conditions : list};
    const panel = {isConnected: true, addEventListener() {}, querySelector: (selector: string) => selector === "[data-body]" ? body : {
        addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.set(selector, listener),
    }};
    const menu = {innerHTML: "", classList: {add() {}, remove() {}}, addEventListener() {}, querySelector: () => panel};
    const database: Pick<AVAttributeViewData, "id" | "keyValues" | "automations"> = {
        id: "source", keyValues: [], automations: {spec: 1, rules: []},
    };
    const methods = {} as typeof import("./automation");
    runInNewContext(compiled, {
        exports: methods,
        Lute: {NewNodeID: () => "draft-rule"},
        window: {siyuan: {config: {}, languages: {databaseAutomations: "Automations"}}},
        require: (name: string) => ({
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {av: database}})},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) => {
                transactions.push({perform, undo});
            }},
        })[name] || {},
    });
    await methods.openAutomationMenu({protyle: {options: {}} as IProtyle,
        blockElement: {dataset: {nodeId: "carrier"}} as unknown as HTMLElement, avID: "source",
        menuElement: menu as unknown as HTMLElement, onResize() {}});
    assert.match(body.innerHTML, /data-name/);
    assert.match(body.innerHTML, /data-trigger/);
    assert.match(list.innerHTML, /data-action="add-field"/);
    assert.equal(transactions.length, 0);
    assert.equal(database.automations.rules.length, 0);
    listeners.get("[data-save]")({currentTarget: {blur() {}}});
    assert.equal(transactions.length, 1);
    const saved = JSON.parse(JSON.stringify(transactions[0].perform[0]));
    const undo = JSON.parse(JSON.stringify(transactions[0].undo[0]));
    assert.equal(saved.data.rules[0].id, "draft-rule");
    assert.equal(undo.data.rules.length, 0);
    assert.equal(database.automations.rules.length, 0);
});

test("leaving automation settings while loading does not replace the next page or submit a transaction", async () => {
    let complete: (response: unknown) => void;
    let returned = 0;
    const listeners = new Map<string, () => void>();
    const panel = {isConnected: true, addEventListener() {}, querySelector: (selector: string) => {
        assert.ok(["[data-body]", "[data-cancel]"].includes(selector));
        return {addEventListener: (_type: string, listener: () => void) => listeners.set(selector, listener)};
    }};
    const menu = {innerHTML: "", classList: {add() {}, remove() {}}, addEventListener() {}, querySelector: (selector: string) =>
        selector === ".av__automation" ? panel : {click() { returned++; panel.isConnected = false; menu.innerHTML = "settings"; }}};
    const methods = {} as typeof import("./automation");
    runInNewContext(compiled, {
        exports: methods,
        window: {siyuan: {config: {}, languages: {databaseAutomations: "Automations"}}},
        require: (name: string) => ({
            "../../../util/fetch": {fetchSyncPost: () => new Promise(resolve => { complete = resolve; })},
            "../../wysiwyg/transaction": {transaction: () => assert.fail("cancel submitted a transaction")},
        })[name] || {},
    });
    const pending = methods.openAutomationMenu({protyle: {options: {}} as IProtyle, blockElement: {} as HTMLElement,
        avID: "database", menuElement: menu as unknown as HTMLElement, onResize() {}});
    listeners.get("[data-cancel]")();
    complete({code: 0, data: {av: {id: "database"}}});
    await pending;
    assert.equal(returned, 1);
    assert.equal(menu.innerHTML, "settings");
});
