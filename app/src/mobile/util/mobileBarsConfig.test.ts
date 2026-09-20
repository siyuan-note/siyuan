import {test} from "node:test";
import * as assert from "node:assert/strict";
import {resolveMobileSidebarConfig} from "./mobileBarsConfig";

test("sidebar access defaults and stored configurations always retain an entry", () => {
    assert.deepEqual(resolveMobileSidebarConfig(), {sidebarSwipe: true, sidebarButtons: false});
    assert.deepEqual(resolveMobileSidebarConfig({sidebarButtons: true}), {sidebarSwipe: true, sidebarButtons: true});
    assert.deepEqual(resolveMobileSidebarConfig({sidebarSwipe: false}), {sidebarSwipe: false, sidebarButtons: true});
    assert.deepEqual(resolveMobileSidebarConfig({sidebarButtons: false}), {sidebarSwipe: true, sidebarButtons: false});
    assert.deepEqual(resolveMobileSidebarConfig({sidebarSwipe: false, sidebarButtons: false}), {
        sidebarSwipe: false,
        sidebarButtons: true,
    });
});
