import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getMobileSheetDragAction, getMobileSheetHeight} from "./mobileSheetGesture";

test("half and full heights are limited by the available viewport", () => {
    assert.equal(getMobileSheetHeight(800, 750, false), 400);
    assert.equal(getMobileSheetHeight(800, 300, false), 300);
    assert.equal(getMobileSheetHeight(800, 750, true), 750);
    assert.equal(getMobileSheetHeight(800, -20, true), 0);
});

test("vertical grip gestures select a direction on release", () => {
    assert.equal(getMobileSheetDragAction(-40, 300, 400, true), "expand");
    assert.equal(getMobileSheetDragAction(40, 300, 800, true), "close");
    assert.equal(getMobileSheetDragAction(21, 30, 400, true), "close");
    assert.equal(getMobileSheetDragAction(21, 300, 400, true), undefined);
    assert.equal(getMobileSheetDragAction(-200, 300, 400, false), undefined);
    assert.equal(getMobileSheetDragAction(100, 300, 400, false), "close");
    assert.equal(getMobileSheetDragAction(2, 1, 0, false), undefined);
});
