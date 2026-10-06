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

test("unlock restores an absent default view attribute", () => {
    const element = carrier();
    api.setReadonlyAVView(element, "reading");
    element.setAttribute(viewAttribute, "reading");
    assert.equal(api.clearReadonlyAVState(element), true);
    assert.equal(element.getAttribute(viewAttribute), null);
});
