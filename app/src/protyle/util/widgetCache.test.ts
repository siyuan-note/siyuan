import * as assert from "node:assert/strict";
import test from "node:test";
import {addWidgetCacheVersion} from "./widgetCache";

test("addWidgetCacheVersion versions local widget URLs", () => {
    assert.equal(addWidgetCacheVersion("/widgets/example/", "3.8.0"),
        "/widgets/example/?siyuan-version=3.8.0");
    assert.equal(addWidgetCacheVersion("/widgets/example/?mode=compact#chart", "3.8.0"),
        "/widgets/example/?mode=compact&siyuan-version=3.8.0#chart");
    assert.equal(addWidgetCacheVersion("/widgets/example/?siyuan-version=3.7.3", "3.8.0"),
        "/widgets/example/?siyuan-version=3.8.0");
});

test("addWidgetCacheVersion ignores non-widget URLs", () => {
    assert.equal(addWidgetCacheVersion("https://example.com/widget", "3.8.0"),
        "https://example.com/widget");
    assert.equal(addWidgetCacheVersion("/widgets/../plugins/example/", "3.8.0"),
        "/widgets/../plugins/example/");
});
