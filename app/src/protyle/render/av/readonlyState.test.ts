import * as assert from "node:assert/strict";
import {before, test} from "node:test";

let api: typeof import("./readonlyState");
let viewAttribute: string;
before(async () => {
    Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: "test"});
    api = await import("./readonlyState");
    viewAttribute = (await import("../../../constants")).Constants.CUSTOM_SY_AV_VIEW;
});

const carrier = (viewID?: string) => {
    const attributes = new Map<string, string>();
    if (viewID !== undefined) {
        attributes.set(viewAttribute, viewID);
    }
    return {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        toggleAttribute: (name: string, enabled: boolean) => enabled ? attributes.set(name, "") : attributes.delete(name),
    } as unknown as HTMLElement;
};

test("locked database reading state is isolated by carrier and view and clears on unlock", () => {
    const first = carrier("default");
    const second = carrier("default");
    api.setReadonlyAVView(first, "reading");
    first.setAttribute(viewAttribute, "reading");
    api.setReadonlyAVFolds(first, "reading", {a: true});
    api.setReadonlyAVFolds(first, "reading", {b: false});
    assert.equal(api.getReadonlyAVView(first), "reading");
    assert.equal(api.getReadonlyAVView(second), "");
    const data = (viewID: string) => ({viewID, view: {
        groups: [{id: "a", groupFolded: false}, {id: "b", groupFolded: true}],
    }}) as IAV;
    const reading = data("reading");
    api.applyReadonlyAVFolds(first, reading);
    assert.deepEqual(reading.view.groups.map(group => group.groupFolded), [true, false]);
    const otherView = data("default");
    api.applyReadonlyAVFolds(first, otherView);
    assert.deepEqual(otherView.view.groups.map(group => group.groupFolded), [false, true]);
    assert.equal(api.clearReadonlyAVState(first), true);
    assert.equal(first.getAttribute(viewAttribute), "default");
    assert.equal(api.getReadonlyAVView(first), "");
    const restored = data("reading");
    api.applyReadonlyAVFolds(first, restored);
    assert.deepEqual(restored.view.groups.map(group => group.groupFolded), [false, true]);
    assert.equal(api.clearReadonlyAVState(first), false);
});

test("temporary sorting is isolated by carrier and view, copied, reset and cleared on unlock", () => {
    const first = carrier("default");
    const second = carrier("default");
    const sort: IAVSort = {column: "created", order: "DESC"};
    api.setReadonlyAVSort(first, "default", sort);
    sort.order = "ASC";
    assert.equal(api.getReadonlyAVSort(first, "default").order, "DESC");
    const copy = api.getReadonlyAVSort(first, "default");
    copy.column = "changed";
    assert.equal(api.getReadonlyAVSort(first, "default").column, "created");
    assert.equal(api.getReadonlyAVSort(first, "other"), undefined);
    assert.equal(api.getReadonlyAVSort(second, "default"), undefined);
    api.setReadonlyAVSort(first, "other", {column: "updated", order: "ASC"});
    api.setReadonlyAVSort(first, "default");
    assert.equal(api.getReadonlyAVSort(first, "default"), undefined);
    assert.equal(api.getReadonlyAVSort(first, "other").column, "updated");
    api.clearReadonlyAVState(first);
    assert.equal(api.getReadonlyAVSort(first, "other"), undefined);
});

test("temporary sorting is sent only for locked live views and drops stale fields", () => {
    Object.assign(globalThis, {window: {siyuan: {isPublish: false}}});
    const element = carrier("view");
    const protyle = {disabled: true, options: {action: []}} as IProtyle;
    api.setReadonlyAVSort(element, "view", {column: "created", order: "DESC"});
    assert.equal(api.getReadonlyAVSortRequest(element, protyle).column, "created");
    assert.equal(api.getReadonlyAVSortRequest(element, {...protyle, disabled: false}), undefined);
    assert.equal(api.getReadonlyAVSortRequest(element, {...protyle, options: {action: [], history: {created: "1"}}} as IProtyle), undefined);
    assert.equal(api.getReadonlyAVSortRequest(element, {...protyle, options: {action: [], history: {snapshot: "snapshot"}}} as IProtyle), undefined);
    window.siyuan.isPublish = true;
    assert.equal(api.getReadonlyAVSortRequest(element, protyle), undefined);
    window.siyuan.isPublish = false;
    api.reconcileReadonlyAVSort(element, {viewID: "view", view: {sorts: []}} as IAV);
    assert.equal(api.getReadonlyAVSortRequest(element, protyle), undefined);
});

test("unlock restores an absent default view attribute", () => {
    const element = carrier();
    api.setReadonlyAVView(element, "reading");
    element.setAttribute(viewAttribute, "reading");
    assert.equal(api.clearReadonlyAVState(element), true);
    assert.equal(element.getAttribute(viewAttribute), null);
});
