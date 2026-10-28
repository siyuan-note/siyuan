import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {clampGroupTableVirtualData, getGroupTableRenderPlan} from "./groupTableVirtual";

const setup = () => {
    const constants = {CUSTOM_SY_AV_VIEW: "view", ATTRIBUTE_V_SCROLL: "v-scroll", DIALOG_ATTR: "attr"};
    const attributes = new Map([["view", "first"], ["v-scroll", "true"], ["data-sub-items", ""], ["data-av-type", "table"]]);
    const body = {dataset: {groupId: "group", rootPage: "2", pageSize: "50", avLocateWindow: "true"},
        querySelector: (selector: string): {getBoundingClientRect: () => {top: number}} | null => selector ? replacement : null, removeAttribute() {}};
    const row = {dataset: {id: "row-400", index: "400"}, closest: () => body,
        getBoundingClientRect: () => ({top: 100, bottom: 136, height: 36})};
    const replacement = {getBoundingClientRect: () => ({top: 64})};
    const cell = {getAttribute: (key: string) => key === "data-detached" ? "true" : "",
        getBoundingClientRect: () => ({height: 36}), closest: () => body};
    const rows = [row];
    const block = {isConnected: true, dataset: {nodeId: "carrier", avId: "db", avType: "table"},
        getAttribute: (name: string) => attributes.get(name), hasAttribute: (name: string) => attributes.has(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        querySelectorAll: (selector: string) => selector === ".av__body" ? [body] : selector === ".av__row[data-id]" ? rows : [],
        querySelector: (selector: string): unknown => selector.startsWith(".av__body[data-group-id=") && !selector.includes(" .") ? body :
            selector.includes('[data-id="inserted"]') ? cell : null,
    };
    const protyle = {id: "editor", notebookId: "plain", options: {}, contentElement: {scrollTop: 10000,
        getBoundingClientRect: () => ({top: 0, bottom: 600})}};
    const requests: unknown[] = [];
    const mounted: number[] = [];
    const locateRequests = new WeakMap();
    let onRender = () => {};
    let focused = false;
    const dependencies: Record<string, unknown> = {
        "../../../constants": {Constants: constants},
        "../../../util/pathName": {isEncryptedBox: () => false},
        "./virtualScroll": {getAVData: () => ({subItems: {parentKeyID: "parent-key", childrenKeyID: "children-key"}})},
        "./backlinkScroll": {getBacklinkScrollElement: (): undefined => undefined},
        "./locate": {setAVLocateRequest: (_block: HTMLElement, request: unknown) => requests.push(request)},
        "./locateState": {locateRequests},
    };
    const load = <T>(name: string) => {
        const exports = {} as T;
        runInNewContext(ts.transpileModule(readFileSync(`src/protyle/render/av/${name}.ts`, "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText, {exports, require: (id: string) => dependencies[id] || {}, window: {siyuan: {storage: {}}}});
        dependencies["./" + name] = exports;
        return exports;
    };
    const state = load<typeof import("./subItemsState")>("subItemsState");
    const api = load<typeof import("./subItemsRefresh")>("subItemsRefresh");
    const extract = <T>(name: string, context: Record<string, unknown>, file = "render.ts"): T => {
        const source = ts.createSourceFile(file, readFileSync("src/protyle/render/av/" + file, "utf8"), ts.ScriptTarget.ES2022, true);
        const statement = source.statements.find(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name));
        return runInNewContext(ts.transpileModule(statement.getText(source).replace(/^export /, ""), {
            compilerOptions: {target: ts.ScriptTarget.ES2022},
        }).outputText + "\n" + name, context);
    };
    const data = {columns: [] as IAVColumn[], rows: Array.from({length: 501}, (_, index) => ({id: `row-${index}`})), pageSize: 50,
        nested: {page: 2, pageSize: 50, rootCount: 200, matchedCount: 10000}};
    const renderTable = extract<(...args: unknown[]) => string>("getTableHTMLs", {
        clampGroupTableVirtualData,
        Constants: constants, getRowHTML: ({rowIndex}: {rowIndex: number}) => { mounted.push(rowIndex); return "<div></div>"; },
        window: {siyuan: {languages: {avSubItemsCounts: "${roots}/${matches}"}}}, escapeHtml: (value: string) => value,
        GROUP_TABLE_ESTIMATED_ROW_HEIGHT: 36,
    });
    const refresh = extract<typeof import("./render").refreshAV>("refreshAV", {
        Constants: constants, prepareSubItemsRefresh: api.prepareSubItemsRefresh, clearSubItemsViewportAnchor: state.clearSubItemsViewportAnchor,
        locateRequests, getAVElements: () => [block], getAVViewPageSize: () => "50",
        addingFocusTokens: new Map(), refreshTimeouts: {}, clearTimeout() {},
        window: {setTimeout: (callback: () => void) => callback()}, document: {querySelector: (): null => null},
        inspectAVInsertedItem() {}, removeAVPasteSkeleton() {}, isTableLikeView: () => true,
        genCellValueByElement: () => ({block: {content: ""}}), scrollAddingCellIntoView() {},
        waitForAddingCellPosition: async () => ({cellElement: cell}), popTextCell: () => { focused = true; },
        avRender: (_block: HTMLElement, _protyle: IProtyle, callback?: () => void) => {
            onRender();
            renderTable(data, block, attributes.has("v-scroll") ? {renderedStart: 350, renderedEnd: 449, topSpacerHeight: 12600} : undefined);
            callback?.();
        },
    });
    return {state, api, body, block: block as unknown as HTMLElement, protyle: protyle as unknown as IProtyle,
        attributes, requests, mounted, rows, data, focused: () => focused, refresh, renderTable, extract, constants,
        locateRequests, onRender: (callback: () => void) => { onRender = callback; }};
};

test("editing an ordinary cell at row 400 retains the 350..449 virtual window", () => {
    const h = setup();
    h.refresh(h.protyle, {action: "updateAttrViewCell", avID: "db", keyID: "text-key", rowID: "row-400"});
    assert.deepEqual([h.mounted.length, h.mounted[0], h.mounted.at(-1)], [100, 350, 449]);
});

test("switching views uses the destination folds and pages without the old virtual window", () => {
    const h = setup();
    h.state.getSubItemsState(h.block, "first").groupExpandedIDs = {group: ["old-parent"]};
    h.state.getSubItemsState(h.block, "second").groupExpandedIDs = {group: ["new-parent"]};
    h.state.getSubItemsState(h.block, "first").childPaging = {"group/old-parent": {page: 8, pageSize: 50}};
    h.refresh(h.protyle, {action: "setAttrViewBlockView", avID: "db", blockID: "carrier", id: "second"});
    const request = h.state.getSubItemsRequest(h.block, h.protyle);
    assert.deepEqual([...request.groupExpandedIDs.group], ["new-parent"]);
    assert.deepEqual(Object.keys(request.childPaging), []);
    assert.equal(h.body.dataset.rootPage, undefined);
    assert.equal(h.body.dataset.avLocateWindow, undefined);
    assert.deepEqual([h.mounted.length, h.mounted[0], h.mounted.at(-1)], [100, 0, 99]);
});

test("structural refresh follows the visible item identity and corrects its scroll offset", () => {
    const h = setup();
    const pending = h.api.prepareSubItemsRefresh(h.block, h.protyle,
        {action: "updateAttrViewCells", avID: "db", cellUpdates: [{keyID: "parent-key", rowID: "child", data: {}}]});
    const windows: Record<string, IAVVirtualData> = {};
    h.state.prepareSubItemsViewport(h.block, {view: {groups: [{...h.data, id: "group",
        rows: h.data.rows.slice(1)}]}} as unknown as IAV, windows);
    assert.equal(windows.group.renderedStart, 349);
    assert.equal(windows.group.renderedEnd, 448);
    pending.restoreViewport();
    assert.equal(h.protyle.contentElement.scrollTop, 9964);
});

test("adding a child from page 2 locates the returned item before opening its name editor without a ghost", async () => {
    const h = setup();
    h.state.getSubItemsState(h.block, "first").childPaging = {"group/parent": {page: 2, pageSize: 200}};
    h.refresh(h.protyle, {action: "insertAttrViewBlock", avID: "db", blockID: "carrier", groupID: "group", parentID: "parent",
        srcs: [{itemID: "requested", id: "block", isDetached: true, content: ""}], retData: {insertedItemIDs: ["inserted"], existingItemIDs: []}});
    assert.equal((h.requests[0] as {itemID: string}).itemID, "inserted");
    assert.equal((h.requests[0] as {groupID: string}).groupID, "group");
    await Promise.resolve();
    assert.equal(h.focused(), true);
});

test("deleting the first visible deep row anchors its surviving neighbor instead of returning to row zero", () => {
    const h = setup();
    h.rows.push({...h.rows[0], dataset: {id: "row-401", index: "401"}});
    h.api.prepareSubItemsRefresh(h.block, h.protyle,
        {action: "removeAttrViewBlock", avID: "db", srcIDs: ["row-400"]});
    const windows: Record<string, IAVVirtualData> = {};
    h.state.prepareSubItemsViewport(h.block, {view: {groups: [{...h.data, id: "group",
        rows: h.data.rows.filter(row => row.id !== "row-400")}]}} as unknown as IAV, windows);
    assert.equal(windows.group.renderedStart, 350);
    assert.equal(windows.group.renderedEnd, 449);
});

test("cross-view locate survives persisting its carrier view and supplies the target to the next render", () => {
    const h = setup();
    const getAVLocateRequest = h.extract("getAVLocateRequest", {locateRequests: h.locateRequests}, "locate.ts");
    const getAVLocateParams = h.extract<typeof import("./locate").getAVLocateParams>("getAVLocateParams", {
        Constants: h.constants, getAVLocateRequest, clearAVLocateRequest: () => assert.fail("Pending locate was cleared"),
    }, "locate.ts");
    const getAVLocateViewChange = h.extract("getAVLocateViewChange", {}, "locateView.ts");
    const persistAVLocateView = h.extract<typeof import("./locate").persistAVLocateView>("persistAVLocateView", {
        Constants: h.constants, getAVLocateRequest, getAVLocateViewChange, window: {siyuan: {isPublish: false}},
        transaction: (_protyle: IProtyle, operations: IOperation[]) => h.refresh(h.protyle, operations[0]),
    }, "locate.ts");
    h.locateRequests.set(h.block, {itemID: "deep-child", groupID: "group", viewID: "second", previousViewID: "first"});
    let nextRequest: ReturnType<typeof getAVLocateParams>;
    h.onRender(() => { nextRequest = getAVLocateParams(h.block); });
    assert.equal(persistAVLocateView(h.block, h.protyle, {viewID: "second", viewType: "table",
        target: {itemID: "deep-child", status: "visible"}} as IAV), true);
    assert.equal(nextRequest.targetItemID, "deep-child");
    assert.equal(nextRequest.targetGroupID, "group");
    assert.equal(nextRequest.viewID, "second");
});

test("manual switching cancels pending locate before either editable or readonly rendering", () => {
    for (const disabled of [false, true]) {
        const h = setup();
        h.protyle.disabled = disabled;
        h.protyle.options.action = [];
        h.locateRequests.set(h.block, {itemID: "old-target", viewID: "second"});
        const verify = () => assert.equal(h.locateRequests.has(h.block), false);
        const switchAVView = h.extract<typeof import("./action").switchAVView>("switchAVView", {
            locateRequests: h.locateRequests, clearSubItemsViewportAnchor: h.state.clearSubItemsViewportAnchor,
            Constants: h.constants, clearSelect() {}, window: {siyuan: {isPublish: false}},
            setReadonlyAVView() {}, transaction: verify, avRender: verify, getAVCurrentViewID: () => "first",
        }, "action.ts");
        switchAVView(h.protyle, h.block, {dataset: {id: "second"}} as unknown as HTMLElement);
        assert.equal(h.locateRequests.has(h.block), false);
    }
});

for (const grouped of [false, true]) {
    test(`shrinking a nested ${grouped ? "group" : "table"} from 501 rows to 50 clamps its old window and removes stale space`, () => {
        const h = setup();
        const oldWindow = {renderedStart: 350, renderedEnd: 449, topSpacerHeight: 12600};
        const view = {...h.data, id: "group", groupHidden: 0, groupFolded: false, rows: h.data.rows.slice(0, 50)};
        const window = grouped ? getGroupTableRenderPlan([view as IAVTable], {group: oldWindow}).virtualData.group : oldWindow;
        const html = h.renderTable(view, h.block, window, grouped);
        assert.deepEqual([h.mounted.length, h.mounted[0], h.mounted.at(-1)], [50, 0, 49]);
        assert.doesNotMatch(html, /height: 12600px/);
        assert.doesNotMatch(h.renderTable({...view, rows: []}, h.block, oldWindow, grouped), /height: 12600px/);
    });
}

test("ordinary sorting changes follow the surviving visible identity while unchanged sequences keep the exact window", () => {
    const h = setup();
    const oldWindow = {renderedStart: 350, renderedEnd: 449, topSpacerHeight: 12600};
    const windows = {group: oldWindow};
    const operation = {action: "updateAttrViewCell", avID: "db", keyID: "text-key", rowID: "row-400"} as IOperation;
    h.api.prepareSubItemsRefresh(h.block, h.protyle, operation);
    h.state.prepareSubItemsViewport(h.block, {view: {groups: [{...h.data, id: "group"}]}} as unknown as IAV, windows);
    assert.equal(windows.group, oldWindow);
    h.api.prepareSubItemsRefresh(h.block, h.protyle, operation);
    h.state.prepareSubItemsViewport(h.block, {view: {groups: [{...h.data, id: "group",
        rows: [...h.data.rows].reverse()}]}} as unknown as IAV, windows);
    assert.equal(windows.group.renderedStart, 50);
    assert.equal(windows.group.renderedEnd, 149);
    assert.equal(windows.group.topSpacerHeight, 1800);
});

test("filtered visible anchors fall back to surviving neighbors and never override an explicit locate window", () => {
    const h = setup();
    h.body.dataset.groupId = "";
    h.rows.push({...h.rows[0], dataset: {id: "row-401", index: "401"},
        getBoundingClientRect: () => ({top: 136, bottom: 172, height: 36})});
    const operation = {action: "updateAttrViewCells", avID: "db", cellUpdates: [{keyID: "status", rowID: "row-400", data: {}}]} as IOperation;
    const windows: Record<string, IAVVirtualData> = {all: {renderedStart: 350, renderedEnd: 449, topSpacerHeight: 12600}};
    const data = {view: {...h.data, rows: [...h.data.rows.slice(0, 50), ...h.data.rows.slice(401)]}} as unknown as IAV;
    const pending = h.api.prepareSubItemsRefresh(h.block, h.protyle, operation);
    h.state.prepareSubItemsViewport(h.block, data, windows);
    assert.equal(windows.all.renderedStart, 0);
    assert.equal(windows.all.renderedEnd, 99);
    h.body.querySelector = selector => selector.includes("row-400") ? null : {getBoundingClientRect: () => ({top: 64})};
    pending.restoreViewport();
    assert.equal(h.protyle.contentElement.scrollTop, 9928);
    h.api.prepareSubItemsRefresh(h.block, h.protyle, operation);
    const located = {renderedStart: 10, renderedEnd: 149, topSpacerHeight: 360, locate: true};
    windows.all = located;
    h.state.prepareSubItemsViewport(h.block, {...data, target: {status: "visible", itemID: "row-490"}} as IAV, windows);
    assert.equal(windows.all, located);
    h.locateRequests.set(h.block, {itemID: "row-490"});
    assert.equal(h.api.prepareSubItemsRefresh(h.block, h.protyle, operation), undefined);
});
