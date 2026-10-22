import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IOpenAVPanelOptions} from "../../protyle/render/av/panels/types";
import type {IBacklinkSourceFilter} from "./backlinkSourceFilter";

const setup = () => {
    let current = true;
    let selected: IBacklinkSourceFilter["database"];
    let opened: IOpenAVPanelOptions;
    let resolve: (value: unknown) => void;
    const requests: unknown[] = [];
    let targetRect = {right: 1500, bottom: 460, width: 24, height: 24} as DOMRect;
    const methods = {} as typeof import("./backlinkDatabaseFilter");
    runInNewContext(transpileModule(readFileSync("src/layout/dock/backlinkDatabaseFilter.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        require: (name: string) => ({
            "../../util/fetch": {fetchSyncPost: (route: string, payload: unknown) => {
                requests.push({route, payload});
                return new Promise(done => { resolve = done; });
            }},
            "../../util/escape": {escapeHtml: (text: string) => text.replaceAll("<", "&lt;")},
            "../../protyle/render/av/openMenuPanel": {openMenuPanel: (options: IOpenAVPanelOptions) => { opened = options; }},
        })[name],
        window: {siyuan: {config: {editor: {backlinkContainChildren: true}}, languages: {reset: "Reset", invalid: "Invalid", emptyContent: "Empty"}}},
    });
    const options = {
        id: "topic", notebook: "", keyword: "", filter: {dailyNote: "all", excludeSelf: false, excludedNotebookIDs: []} as IBacklinkSourceFilter,
        target: {getBoundingClientRect: () => targetRect} as HTMLElement,
        anchorRect: targetRect,
        isCurrent: () => current,
        getSelected: () => selected,
        apply: (value?: IBacklinkSourceFilter["database"]) => { selected = value; },
    };
    return {methods, options, requests, respond: (value: unknown) => resolve(value),
        hideTarget: () => { targetRect = {right: 0, bottom: 0, width: 0, height: 0} as DOMRect; },
        stale: () => { current = false; }, get selected() { return selected; }, get opened() { return opened; }};
};

test("database selection and query editing never mutate database metadata or another selection", async () => {
    const h = setup();
    const database = {id: "tasks", name: "<Tasks>", keys: [{id: "status", name: "Status", type: "text"}]};
    const pending = h.methods.loadBacklinkDatabaseFilterMenu(h.options);
    h.respond({code: 0, data: [database]});
    const menu = await pending;
    assert.equal(menu[2].label, "&lt;Tasks>");
    menu[2].click(null, null);
    assert.equal(h.selected.avID, "tasks");
    assert.equal(h.opened.protyle, undefined);
    assert.ok("rows" in h.opened.data.view);
    assert.equal(h.opened.data.view.rows.length, 0);
    const filters: IAVFilter[] = [{column: "status", operator: "Contains", value: {type: "text", text: {content: "open"}}}];
    h.opened.filterOperation.save(filters);
    assert.equal(h.selected.filters, filters);
    assert.equal(database.keys[0].name, "Status");
    menu[0].click(null, null);
    assert.equal(h.selected, undefined);
    h.opened.filterOperation.save(filters);
    assert.equal(h.selected, undefined, "a stale panel must not re-enable cleared database filtering");
    assert.equal(h.requests.length, 1);
});

test("database candidates arriving after the target changes do not reopen a filter panel", async () => {
    const h = setup();
    const pending = h.methods.loadBacklinkDatabaseFilterMenu(h.options);
    h.stale();
    h.respond({code: 0, data: [{id: "tasks", name: "Tasks", keys: []}]});
    assert.equal((await pending).length, 0);
    assert.equal(h.opened, undefined);
});

test("database filtering retains the toolbar position across candidate loading and source refresh", async () => {
    const h = setup();
    h.hideTarget();
    const pending = h.methods.loadBacklinkDatabaseFilterMenu(h.options);
    h.respond({code: 0, data: [{id: "tasks", name: "Tasks", keys: []}]});
    const menu = await pending;
    menu[2].click(null, null);
    assert.equal(h.opened.anchorRect.right, 1500);
    assert.equal(h.opened.anchorRect.bottom, 460);
});
