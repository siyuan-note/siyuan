import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getTabTask, hasTabsTasks} from "./tabsRender";

const group = (enabled: string, markers: Array<string | null>) => {
    const tabs = {
        getAttribute: () => enabled,
        children: [] as Element[],
    };
    tabs.children = markers.map(marker => ({
        parentElement: tabs,
        classList: {contains: () => true},
        getAttribute: () => marker,
        hasAttribute: () => marker !== null,
    }) as unknown as Element);
    return tabs as unknown as Element;
};

test("group tasks default to incomplete and preserve explicit item states", () => {
    const tabs = group("true", [null, " ", "X", "x", "/"]);
    assert.equal(hasTabsTasks(tabs), true);
    assert.deepEqual(Array.from(tabs.children).map(getTabTask), [" ", " ", "X", "x", "/"]);
    assert.equal(hasTabsTasks(group("true", [])), true);
});

test("legacy mixed groups retain ordinary items and task markers", () => {
    const tabs = group(null, [null, "X", "/"]);
    assert.equal(hasTabsTasks(tabs), true);
    assert.deepEqual(Array.from(tabs.children).map(getTabTask), [null, "X", "/"]);
    assert.equal(hasTabsTasks(group(null, [null])), false);
    assert.equal(getTabTask(group("false", [null]).children[0]), null);
});
