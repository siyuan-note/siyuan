import * as assert from "node:assert/strict";
import test from "node:test";
import {scrollSettingContent} from "./dragScroll";

const runScroll = (options: Partial<WheelEvent> = {}) => {
    const element = {scrollTop: 100, scrollLeft: 10, clientHeight: 300, clientWidth: 500} as HTMLElement;
    let prevented = false;
    let stopped = false;
    const event = {
        deltaX: 2.5, deltaY: 12.5, deltaMode: 0,
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; },
        ...options,
    } as WheelEvent;
    scrollSettingContent(element, event);
    return {top: element.scrollTop, left: element.scrollLeft, prevented, stopped};
};

test("drag area forwards fractional trackpad movement and consumes the wheel event", () => {
    assert.deepEqual(runScroll(), {top: 112.5, left: 12.5, prevented: true, stopped: true});
});

test("drag area preserves zoom gestures", () => {
    for (const modifier of [{ctrlKey: true}, {metaKey: true}]) {
        assert.deepEqual(runScroll(modifier), {top: 100, left: 10, prevented: false, stopped: false});
    }
});

test("drag area converts page units and shift scrolling", () => {
    assert.deepEqual(runScroll({deltaMode: 2, deltaX: 0, deltaY: -1}),
        {top: -200, left: 10, prevented: true, stopped: true});
    assert.deepEqual(runScroll({shiftKey: true, deltaX: 0, deltaY: 20}),
        {top: 100, left: 30, prevented: true, stopped: true});
});

test("drag area converts line units using the content line height", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
    Object.defineProperty(globalThis, "getComputedStyle", {
        configurable: true,
        value: () => ({lineHeight: "24px", fontSize: "16px"}),
    });
    try {
        assert.deepEqual(runScroll({deltaMode: 1, deltaX: 0, deltaY: 3}),
            {top: 172, left: 10, prevented: true, stopped: true});
    } finally {
        if (original) {
            Object.defineProperty(globalThis, "getComputedStyle", original);
        } else {
            Reflect.deleteProperty(globalThis, "getComputedStyle");
        }
    }
});
