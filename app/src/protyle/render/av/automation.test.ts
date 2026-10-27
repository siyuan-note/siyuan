import * as capabilities from "./capabilities";
import * as filterDropdown from "./filterDropdown";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {AVAttributeViewData, AVAutomationBlockSourceInput} from "../../../types/api";

const compiled = transpileModule(readFileSync("src/protyle/render/av/automation.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("collection autosave versions document depth, attribute names, self exclusion and references with independent undo snapshots", async () => {
    const transactions: Array<{perform: IOperation[], undo: IOperation[]}> = [];
    let source: AVAutomationBlockSourceInput;
    let save: () => void;
    const child = {innerHTML: "", textContent: "", checked: true, classList: {toggle() {}},
        querySelectorAll: (): HTMLElement[] => [], addEventListener() {}};
    const body = {...child, isConnected: true, querySelector: () => child};
    const panel = {isConnected: true, addEventListener() {}, querySelector: () => body};
    const menu = {innerHTML: "", classList: {add() {}, remove() {}}, addEventListener() {}, querySelector: () => panel};
    const database: Pick<AVAttributeViewData, "id" | "keyValues" | "automations"> = {id: "database", keyValues: [], automations: {spec: 1, rules: [{
        id: "rule", name: "Collect", enabled: true, trigger: "block", blockSource: {documentIDs: ["doc"]},
        actions: [{type: "collect", target: "current", fields: {}}],
    }]}};
    const methods = {} as typeof import("./automation");
    runInNewContext(compiled, {
        exports: methods, window: {siyuan: {config: {}, languages: {}}},
        require: (name: string) => name === "./capabilities" ? capabilities : (({
            "./blockCollection": {collectionSourceIncomplete: () => false,
                mountBlockCollectionSource: (_host: HTMLElement, value: AVAutomationBlockSourceInput, _protyle: IProtyle, persist: () => void) => {
                    source = value; save = persist;
                }},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {av: database}})},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) => transactions.push({perform, undo})},
        })[name] || {}),
    });
    await methods.openAutomationMenu({protyle: {options: {}} as IProtyle,
        blockElement: {dataset: {nodeId: "carrier"}} as unknown as HTMLElement,
        avID: "database", menuElement: menu as unknown as HTMLElement, onResize() {}});
    assert.equal(transactions.length, 0);
    source.documentDepth = 0;
    save();
    const first = JSON.parse(JSON.stringify(transactions[0]));
    assert.equal(first.perform[0].data.spec, 5);
    assert.equal(first.perform[0].data.rules[0].blockSource.documentDepth, 0);
    assert.equal(first.undo[0].data.spec, 1);
    assert.equal(first.undo[0].data.rules[0].blockSource.documentDepth, undefined);
    source.documentDepth = 2;
    save();
    assert.deepEqual(JSON.parse(JSON.stringify(transactions[1].undo)), first.perform);
    delete source.documentDepth;
    save();
    const last = JSON.parse(JSON.stringify(transactions[2].perform[0].data));
    assert.equal(last.spec, 5);
    assert.equal(last.rules[0].blockSource.documentDepth, undefined);
    assert.equal(last.rules[0].enabled, true);
    assert.equal(database.automations.spec, 1);
    source.attributes = [{name: "dailynote", nameOperator: "contains", operator: "exists"}];
    save();
    const named = JSON.parse(JSON.stringify(transactions.at(-1)));
    assert.equal(named.perform[0].data.spec, 6);
    assert.equal(named.perform[0].data.rules[0].blockSource.attributes[0].nameOperator, "contains");
    assert.equal(named.undo[0].data.spec, 5);
    source.attributes[0] = {name: "^custom-dailynote-[0-9]{8}$", nameOperator: "regex", operator: "notExists"};
    save();
    assert.equal(JSON.parse(JSON.stringify(transactions.at(-1).perform[0].data)).spec, 6);
    source.attributes = [];
    save();
    assert.equal(JSON.parse(JSON.stringify(transactions.at(-1).perform[0].data)).spec, 6);
    source.includeSelectedDocuments = false;
    save();
    const excluded = JSON.parse(JSON.stringify(transactions.at(-1)));
    assert.equal(excluded.perform[0].data.spec, 7);
    assert.equal(excluded.perform[0].data.rules[0].blockSource.includeSelectedDocuments, false);
    assert.equal(excluded.undo[0].data.spec, 6);
    assert.equal(excluded.undo[0].data.rules[0].blockSource.includeSelectedDocuments, undefined);
    delete source.includeSelectedDocuments;
    save();
    const included = JSON.parse(JSON.stringify(transactions.at(-1)));
    assert.equal(included.perform[0].data.spec, 7);
    assert.equal(included.perform[0].data.rules[0].blockSource.includeSelectedDocuments, undefined);
    assert.deepEqual(included.undo, excluded.perform);
    source.referenceID = "20261026000000-target1";
    save();
    const referenced = JSON.parse(JSON.stringify(transactions.at(-1)));
    assert.equal(referenced.perform[0].data.spec, 8);
    assert.equal(referenced.perform[0].data.rules[0].blockSource.referenceID, source.referenceID);
    assert.deepEqual(referenced.undo, included.perform);
    delete source.referenceID;
    save();
    const cleared = JSON.parse(JSON.stringify(transactions.at(-1)));
    assert.equal(cleared.perform[0].data.spec, 8);
    assert.equal(cleared.perform[0].data.rules[0].blockSource.referenceID, undefined);
});

test("automation settings reject readonly, publishing and historical editors before fetching data", async () => {
    for (const mode of ["disabled", "readonly", "publish", "created", "snapshot"]) {
        const methods = {} as typeof import("./automation");
        runInNewContext(compiled, {
            exports: methods,
            window: {siyuan: {config: {readonly: mode === "readonly"}, isPublish: mode === "publish"}},
            require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (name === "../../../util/fetch" ? {
                fetchSyncPost: () => assert.fail("protected editor fetched automation settings"),
            } : {}),
        });
        await methods.openAutomationMenu({protyle: {disabled: mode === "disabled", options: {
            history: {created: mode === "created" ? "history" : undefined, snapshot: mode === "snapshot" ? "snapshot" : undefined},
        }} as IProtyle, blockElement: {} as HTMLElement, avID: "database", menuElement: {} as HTMLElement, onResize() {}});
    }
});

test("automation settings autosave changes with independent undo snapshots and keep the menu open", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const transactions: Array<{perform: IOperation[], undo: IOperation[]}> = [];
    const conditionList = {innerHTML: "", querySelectorAll: (): HTMLElement[] => []};
    const conditionHost = {innerHTML: "", querySelector: (selector: string) => selector === "[data-conditions]" ? conditionList : {addEventListener() {}}};
    const actionsHost = {innerHTML: "", classList: {toggle() {}}, querySelectorAll: (): HTMLElement[] => []};
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
    let captureClick: (event: {target: {closest: () => HTMLElement}}) => void;
    const classes = new Set(["b3-menu--fullscreen", "b3-menu--sheet"]);
    const menu = {innerHTML: "", classList: {add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name)},
        addEventListener: (_type: string, listener: typeof captureClick, capture: boolean) => {
            assert.equal(capture, true);
            captureClick = listener;
        },
        removeEventListener: (_type: string, listener: () => void) => assert.equal(listener, captureClick),
        querySelector: (selector: string) => selector === ".av__automation" ? panel : {click() { returned++; }}};
    const rule = {id: "rule", name: "Copy relation", enabled: true, trigger: "changed", actions: [{
        type: "edit", target: "filtered", avID: "target", fields: {relation: {mode: "static", value: {type: "relation", relation: {blockIDs: [] as string[]}}}},
    }]};
    const otherRule = {...rule, id: "other", actions: [{...rule.actions[0], avID: "unloaded"}]};
    const database = {id: "source", keyValues: [
        {key: {id: "wrong", name: "Wrong target", type: "relation", relation: {avID: "elsewhere"}}},
        {key: {id: "compatible", name: "Same target", type: "relation", relation: {avID: "linked"}}},
    ], automations: {spec: 1, rules: [rule, otherRule]}};
    const destination = {id: "target", keyValues: [{key: {id: "relation", name: "Relation", type: "relation", relation: {avID: "linked"}}}]};
    const methods = {} as typeof import("./automation");
    runInNewContext(compiled, {
        exports: methods,
        window: {siyuan: {config: {}, languages: {databaseAutomations: "Automations", fields: "Fields", automationIncomplete: "Incomplete: ${1}"},
            menus: {menu: {remove() { menuVisible = false; }}}}},
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (({
            "../../../plugin/Menu": {Menu: class {
                addItem() {}
                open() { menuVisible = true; }
            }},
            "./filterDropdown": filterDropdown,
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../util/fetch": {fetchSyncPost: async (_path: string, request: {id: string}) => ({code: 0, data: {av: request.id === "source" ? database : destination}})},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) => {
                transactions.push({perform, undo});
            }},
        })[name] || {}),
    });
    await methods.openAutomationMenu({protyle: {options: {}} as IProtyle,
        blockElement: {dataset: {nodeId: "carrier"}} as unknown as HTMLElement, avID: "source",
        menuElement: menu as unknown as HTMLElement, onResize() { resized++; }});
    assert.ok(classes.has("av__automation-panel"));
    assert.ok(classes.has("b3-menu--fullscreen"));
    assert.ok(classes.has("b3-menu--sheet"));
    assert.match(menu.innerHTML, /data-type="go-config"/);
    assert.doesNotMatch(menu.innerHTML, /data-save|data-cancel/);
    assert.ok(resized >= 2);
    const addField = {dataset: {action: "add-field"}, closest: () => ({dataset: {index: "0"}}),
        getBoundingClientRect: () => ({left: 0, bottom: 0, height: 20})};
    captureClick({target: {closest: () => null}});
    listeners.get("click")({target: {closest: () => addField}});
    assert.equal(menuVisible, true);
    captureClick({target: {closest: () => null}});
    listeners.get("click")({target: {closest: (): HTMLElement => null}});
    assert.equal(menuVisible, false);
    assert.equal(transactions.length, 0);
    const target = {value: "source", matches: (selector: string) => selector === "[data-mode]",
        closest: (selector: string) => selector === "[data-index]" ? {dataset: {index: "0"}} : {dataset: {fieldId: "relation"}}};
    listeners.get("change")({target});
    const performed = JSON.parse(JSON.stringify(transactions[0].perform[0]));
    const undone = JSON.parse(JSON.stringify(transactions[0].undo[0]));
    assert.equal(performed.action, "setAttrViewAutomations");
    assert.equal(performed.avID, "source");
    assert.equal(performed.data.rules[0].actions[0].fields.relation.keyID, "compatible");
    assert.equal(undone.data.rules[0].actions[0].fields.relation.mode, "static");
    assert.equal(database.automations.rules[0].actions[0].fields.relation.mode, "static");
    assert.deepEqual(performed.data.rules[1], otherRule);
    assert.equal(returned, 0);
    listeners.get("change")({target: {checked: false, matches: (selector: string) => selector === "[data-enabled]", closest: (): HTMLElement => null}});
    assert.equal(transactions.length, 2);
    assert.deepEqual(transactions[1].undo[0].data, transactions[0].perform[0].data);
    assert.equal(JSON.parse(JSON.stringify(transactions[0].perform[0].data)).rules[0].enabled, true);
    assert.equal(JSON.parse(JSON.stringify(transactions[1].perform[0].data)).rules[0].enabled, false);
    listeners.get("change")({target: {checked: true, matches: (selector: string) => selector === "[data-enabled]", closest: (): HTMLElement => null}});
    assert.equal(transactions.length, 3);
    assert.equal(JSON.parse(JSON.stringify(transactions[2].perform[0].data)).rules[0].enabled, true);
    listeners.get("click")({target: {closest: () => ({dataset: {action: "add-action"}, closest: (): HTMLElement => null})}});
    assert.equal(transactions.length, 4);
    assert.equal(JSON.parse(JSON.stringify(transactions[3].perform[0].data)).rules[0].enabled, false);
    assert.equal(JSON.parse(JSON.stringify(transactions[3].perform[0].data)).rules[0].actions.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(transactions[3].perform[0].data)).rules[1], otherRule);
    panel.isConnected = false;
    menuVisible = true;
    captureClick({target: {closest: () => null}});
    assert.equal(menuVisible, true);
    assert.equal(returned, 0);
});

test("empty automation settings persist an incomplete rule disabled on editing and reject enabling it", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const transactions: Array<{perform: IOperation[], undo: IOperation[]}> = [];
    const status = {textContent: "", classList: {toggle() {}}};
    const select = {textContent: ""};
    let renameRule: (id: string, name: string) => void;
    let removeRule: (id: string) => void;
    const enabled = {checked: false};
    const list = {innerHTML: "", querySelectorAll: (): HTMLElement[] => []};
    const conditions = {innerHTML: "", querySelector: (selector: string) => selector === "[data-conditions]" ? list : {addEventListener() {}}};
    const body = {isConnected: true, innerHTML: "",
        addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
        querySelectorAll: (): HTMLElement[] => [],
        querySelector: (selector: string) => ({"[data-source-conditions]": conditions, "[data-status]": status,
            "[data-rule-name]": select, "[data-enabled]": enabled})[selector] || list};
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
        window: {siyuan: {config: {}, languages: {databaseAutomations: "Automations", fields: "Fields", automationIncomplete: "Incomplete: ${1}"}}},
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (({
            "./automationRules": {openAutomationRules: (_target: HTMLElement, _rules: unknown, _current: string,
                _select: unknown, rename: typeof renameRule, remove: typeof removeRule) => { renameRule = rename; removeRule = remove; }},
            "./automationTemplate": {automationTimeZone: () => "UTC"},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {av: database}})},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) => {
                transactions.push({perform, undo});
            }},
        })[name] || {}),
    });
    await methods.openAutomationMenu({protyle: {options: {}} as IProtyle,
        blockElement: {dataset: {nodeId: "carrier"}} as unknown as HTMLElement, avID: "source",
        menuElement: menu as unknown as HTMLElement, onResize() {}});
    assert.match(body.innerHTML, /data-action="rules"/);
    assert.match(body.innerHTML, /data-action="rename-rule"/);
    assert.doesNotMatch(body.innerHTML, /data-rule-name-input/);
    assert.match(body.innerHTML, /data-trigger/);
    assert.match(list.innerHTML, /data-action="add-field"/);
    assert.equal(transactions.length, 0);
    assert.equal(database.automations.rules.length, 0);
    listeners.get("click")({target: {closest: () => ({dataset: {action: "rules"}, closest: (): HTMLElement => null})}});
    renameRule("draft-rule", "Draft");
    assert.equal(transactions.length, 1);
    const saved = JSON.parse(JSON.stringify(transactions[0].perform[0]));
    const undo = JSON.parse(JSON.stringify(transactions[0].undo[0]));
    assert.equal(saved.data.rules[0].id, "draft-rule");
    assert.equal(saved.data.rules[0].name, "Draft");
    assert.equal(saved.data.rules[0].enabled, false);
    assert.equal(undo.data.rules.length, 0);
    assert.equal(database.automations.rules.length, 0);
    assert.equal(status.textContent, "Incomplete: Fields");
    listeners.get("change")({target: {checked: true, matches: (selector: string) => selector === "[data-enabled]", closest: (): HTMLElement => null}});
    assert.equal(transactions.length, 1);
    assert.equal(enabled.checked, false);
    removeRule("draft-rule");
    assert.equal(transactions.length, 2);
    assert.equal(JSON.parse(JSON.stringify(transactions[1].perform[0].data)).rules.length, 0);
    assert.deepEqual(transactions[1].undo[0].data, transactions[0].perform[0].data);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(body.innerHTML, /data-action="rules"/);
    assert.match(body.innerHTML, /data-trigger/);
    assert.match(list.innerHTML, /data-action="add-field"/);
    assert.equal(transactions.length, 2);
    removeRule("draft-rule");
    assert.equal(transactions.length, 2);
});

test("leaving automation settings while loading does not replace the next page or submit a transaction", async () => {
    let complete: (response: unknown) => void;
    let returned = 0;
    const panel = {isConnected: true, addEventListener() {}, querySelector: (selector: string) => {
        assert.equal(selector, "[data-body]");
        return {};
    }};
    const menu = {innerHTML: "", classList: {add() {}, remove() {}}, addEventListener() {}, querySelector: (selector: string) =>
        selector === ".av__automation" ? panel : {click() { returned++; panel.isConnected = false; menu.innerHTML = "settings"; }}};
    const methods = {} as typeof import("./automation");
    runInNewContext(compiled, {
        exports: methods,
        window: {siyuan: {config: {}, languages: {databaseAutomations: "Automations"}}},
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (({
            "../../../util/fetch": {fetchSyncPost: () => new Promise(resolve => { complete = resolve; })},
            "../../wysiwyg/transaction": {transaction: () => assert.fail("cancel submitted a transaction")},
        })[name] || {}),
    });
    const pending = methods.openAutomationMenu({protyle: {options: {}} as IProtyle, blockElement: {} as HTMLElement,
        avID: "database", menuElement: menu as unknown as HTMLElement, onResize() {}});
    const back = menu.querySelector('[data-type="go-config"]');
    if ("click" in back) {
        back.click();
    }
    complete({code: 0, data: {av: {id: "database"}}});
    await pending;
    assert.equal(returned, 1);
    assert.equal(menu.innerHTML, "settings");
});
