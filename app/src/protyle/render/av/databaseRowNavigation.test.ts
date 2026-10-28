import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";
import type {IDatabaseRowOpenData} from "./openDatabaseRow";

const data: IDatabaseRowOpenData = {
    avID: "database", databaseBlockID: "carrier", notebookID: "notebook", itemID: "current",
    valueID: "current-value", title: "Current", isDetached: true,
    navigation: {viewID: "view", query: "filter", groupID: "group", calendarRange: {start: 1, end: 10, timeZone: "UTC"},
        temporarySort: {column: "created", order: "DESC"}},
};
const row = (id: string, detached = true) => ({id, cells: [{id: id + "-value", valueType: "block",
    value: {type: "block", isDetached: detached, block: {id: detached ? undefined : id + "-block", content: id}}}]});

const load = (fetch: (request: Record<string, any>) => unknown, stored?: IAV) =>
    loadModule<typeof import("./databaseRowNavigation")>("src/protyle/render/av/databaseRowNavigation.ts", {
        require: (name: string) => {
        if (name === "../../../util/fetch") {
            return {fetchSyncPost: async (url: string, request: Record<string, any>) => {
                assert.equal(url, "/api/av/renderAttributeView");
                assert.equal(request.blockID, "carrier");
                assert.equal(request.viewID, "view");
                assert.equal(request.query, "filter");
                assert.equal(request.createIfNotExist, false);
                assert.equal(request.calendarRange.timeZone, "UTC");
                assert.equal(request.temporarySort.column, "created");
                assert.equal(request.temporarySort.order, "DESC");
                return fetch(request);
            }};
        }
        if (name === "./renderData") { return {isAVRenderData: (value: IAV) => !!value?.view}; }
        if (name === "./virtualScroll") { return {getAVData: () => stored}; }
        if (name === "./readonlyState") { return {getReadonlyAVSort: () => data.navigation.temporarySort}; }
        return {};
    }}, ScriptTarget.ES2021);

test("row navigation uses the located window beyond the source page and preserves bound row identity", async () => {
    const api = load(request => {
        assert.equal(request.targetItemID, "current");
        return {code: 0, data: {view: {rows: [row("previous", false), row("current"), row("next")], rowCount: 500},
            target: {status: "visible", index: 249, offset: 248}}};
    });
    const [previous, next] = await api.getDatabaseRowNeighbors(data);
    assert.equal(previous.itemID, "previous");
    assert.equal(previous.boundBlockID, "previous-block");
    assert.equal(previous.isDetached, false);
    assert.equal(next.itemID, "next");
    assert.equal(next.isDetached, true);
    assert.equal(next.valueID, "next-value");
});

test("group boundaries skip hidden and empty groups and fetch only the previous group's last row", async () => {
    let requests = 0;
    const api = load(request => {
        requests++;
        if (request.groupPaging) {
            assert.equal(request.targetItemID, undefined);
            assert.equal(request.groupPaging.before.page, 301);
            assert.equal(request.groupPaging.before.pageSize, 1);
            return {code: 0, data: {view: {groups: [{id: "before", rows: [row("last")]}]}}};
        }
        return {code: 0, data: {view: {groups: [
            {id: "before", rows: [row("first")], rowCount: 301},
            {id: "hidden", rows: [row("hidden")], rowCount: 1, groupHidden: 2},
            {id: "group", rows: [row("current")], rowCount: 1},
            {id: "empty", rows: [], rowCount: 0},
            {id: "after", cards: [{id: "next", values: row("next").cells}], cardCount: 10},
        ]}, target: {status: "visible", groupID: "group"}}};
    });
    const [previous, next] = await api.getDatabaseRowNeighbors(data);
    assert.equal(previous.itemID, "last");
    assert.equal(previous.navigation.groupID, "before");
    assert.equal(next.itemID, "next");
    assert.equal(next.navigation.groupID, "after");
    assert.equal(requests, 2);
});

test("first and last rows stop without wrapping and unavailable rows cannot navigate", async () => {
    for (const status of ["visible", "filtered", "itemNotFound", "groupHidden"]) {
        const api = load(() => ({code: 0, data: {view: {rows: [row("current")], rowCount: 1}, target: {status}}}));
        assert.ok((await api.getDatabaseRowNeighbors(data)).every(item => !item));
    }
    for (const response of [{code: -1}, {code: 0, data: {error: "viewNotFound"}}]) {
        assert.equal((await load(() => response).getDatabaseRowNeighbors(data)).length, 0);
    }
});

test("navigation context captures the source view and search without enabling live navigation in history", () => {
    const stored = {id: "database", viewID: "view", view: {calendarRange: data.navigation.calendarRange}} as IAV;
    const block = {querySelector: (selector: string) => selector.includes("av-search") ? {textContent: " filter "} :
        {closest: () => ({dataset: {groupId: "group"}})}};
    const source = {wysiwyg: {element: {querySelector: () => block}}, options: {}} as unknown as IProtyle;
    const api = load(() => { throw new Error("No request expected"); }, stored);
    const context = api.getDatabaseRowNavigation(source, data);
    assert.equal(context.viewID, "view");
    assert.equal(context.query, "filter");
    assert.equal(context.groupID, "group");
    assert.equal(context.temporarySort, undefined);
    source.disabled = true;
    assert.equal(api.getDatabaseRowNavigation(source, data).temporarySort, data.navigation.temporarySort);
    source.options.history = {created: "archive"};
    assert.equal(api.getDatabaseRowNavigation(source, data), undefined);
});
