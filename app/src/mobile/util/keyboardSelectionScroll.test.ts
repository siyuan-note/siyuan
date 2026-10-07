import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createKeyboardSelectionScroll, type IKeyboardSelectionScrollState} from "./keyboardSelectionScroll";

class ScrollContainer extends EventTarget {
    public scrollTop = 180;
    public scrollLeft = 12;
    public stops: ScrollToOptions[] = [];

    scroll(options: ScrollToOptions) {
        this.stops.push(options);
    }
}

const setup = (smooth = false) => {
    const container = new ScrollContainer();
    const node = {} as Node;
    const state: IKeyboardSelectionScrollState = {
        container: container as unknown as HTMLElement,
        anchorNode: node, anchorOffset: 0, focusNode: node, focusOffset: 0,
        viewportTop: 200, viewportBottom: 320,
    };
    const timers = new Map<number, {callback: () => void, delay: number}>();
    let nextTimer = 0;
    const calls: HTMLElement[] = [];
    const controller = createKeyboardSelectionScroll({
        delay: 300,
        scroll: element => { calls.push(element); return smooth; },
        onCancel() {},
        setTimer: (callback, delay) => { timers.set(++nextTimer, {callback, delay}); return nextTimer; },
        clearTimer: timer => { timers.delete(timer); },
    });
    const flush = () => {
        const tasks = [...timers.entries()].filter(([, task]) => task.delay === 300);
        tasks.forEach(([id, task]) => { timers.delete(id); task.callback(); });
    };
    return {container, state, controller, timers, calls, flush};
};

test("toolbar refreshes do not restart or repeat selection positioning", () => {
    const s = setup();
    s.controller.request(s.state);
    const original = [...s.timers.keys()];
    s.controller.request({...s.state});
    assert.deepEqual([...s.timers.keys()], original);
    s.flush();
    s.controller.request({...s.state});
    assert.equal(s.calls.length, 1);
    assert.equal(s.timers.size, 0);
});

test("a swipe cancels pending positioning and repeated selection events cannot pull the viewport back", () => {
    const s = setup();
    s.controller.request(s.state);
    s.container.dispatchEvent(new Event("touchstart"));
    s.controller.request({...s.state});
    s.container.dispatchEvent(new Event("touchmove"));
    s.container.scrollTop = 350;
    s.container.dispatchEvent(new Event("scroll"));
    s.container.dispatchEvent(new Event("touchend"));
    s.controller.request({...s.state});
    s.flush();
    assert.equal(s.calls.length, 0);
    assert.equal(s.container.scrollTop, 350);
    assert.equal(s.timers.size, 0);
    s.controller.request({...s.state, focusOffset: 1});
    s.flush();
    assert.equal(s.calls.length, 1, "a later caret move still positions the selection");
});

test("tapping a new caret defers positioning until the touch ends", () => {
    const s = setup();
    s.controller.request(s.state);
    s.container.dispatchEvent(new Event("touchstart"));
    s.controller.request({...s.state, focusOffset: 1});
    s.flush();
    assert.equal(s.calls.length, 0);
    s.container.dispatchEvent(new Event("touchend"));
    s.flush();
    assert.equal(s.calls.length, 1);
});

test("viewport refreshes during a swipe do not schedule positioning after release", () => {
    for (const end of ["touchend", "touchcancel"]) {
        const s = setup();
        s.controller.request(s.state);
        s.container.dispatchEvent(new Event("touchstart"));
        const next = {...s.state, viewportBottom: 300};
        s.controller.request(next);
        s.container.dispatchEvent(new Event("touchmove"));
        s.controller.request(next, true);
        s.container.dispatchEvent(new Event(end));
        s.controller.request(next);
        s.flush();
        assert.equal(s.calls.length, 0);
        assert.equal(s.timers.size, 0);
    }
});

test("wheel and scrollbar interaction cancel pending positioning", () => {
    for (const type of ["wheel", "pointerdown"]) {
        const s = setup();
        s.controller.request(s.state);
        const event = new Event(type);
        Object.assign(event, {pointerType: "mouse"});
        s.container.dispatchEvent(event);
        s.controller.request({...s.state});
        s.flush();
        assert.equal(s.calls.length, 0, type);
    }
});

test("dragging a selection endpoint still positions the changed selection after release", () => {
    const s = setup();
    s.controller.request(s.state);
    s.container.dispatchEvent(new Event("touchstart"));
    s.container.dispatchEvent(new Event("touchmove"));
    s.controller.request({...s.state, focusOffset: 1});
    s.flush();
    assert.equal(s.calls.length, 0);
    s.container.dispatchEvent(new Event("touchend"));
    s.flush();
    assert.equal(s.calls.length, 1);
});

test("layout adjustments and other programmatic scrolls preserve pending caret positioning", () => {
    const s = setup();
    s.controller.request(s.state);
    s.container.dispatchEvent(new Event("scroll"));
    s.flush();
    assert.equal(s.calls.length, 1);
});

test("committed input and keyboard viewport changes can position an unchanged caret", () => {
    const s = setup();
    s.controller.request(s.state);
    s.flush();
    s.controller.request({...s.state}, true);
    s.flush();
    s.controller.request({...s.state, viewportBottom: 260});
    s.flush();
    assert.equal(s.calls.length, 3);
});

test("manual interaction stops an ongoing smooth scroll while preserving horizontal position", () => {
    for (const type of ["touchstart", "wheel", "pointerdown"]) {
        const s = setup(true);
        s.controller.request(s.state);
        s.flush();
        const event = new Event(type);
        Object.assign(event, {pointerType: "mouse"});
        s.container.dispatchEvent(event);
        assert.deepEqual(s.container.stops, [{top: 180, left: 12, behavior: "auto"}]);
        assert.equal(s.timers.size, 0);
    }
});

test("automatic scroll events do not cancel a newer caret request", () => {
    const s = setup(true);
    s.controller.request(s.state);
    s.flush();
    s.controller.request({...s.state, focusOffset: 1});
    s.container.dispatchEvent(new Event("scroll"));
    s.flush();
    assert.equal(s.calls.length, 2);
    s.container.dispatchEvent(new Event("scrollend"));
    assert.equal(s.timers.size, 0);
});

test("switching or hiding editors cancels tasks and releases listeners on the previous editor", () => {
    const s = setup(true);
    s.controller.request(s.state);
    s.flush();
    const other = new ScrollContainer();
    const next = {...s.state, container: other as unknown as HTMLElement};
    s.controller.request(next);
    assert.equal(s.container.stops.length, 1);
    s.container.dispatchEvent(new Event("touchstart"));
    s.flush();
    assert.equal(s.calls[1], other);
    s.controller.reset();
    assert.equal(s.timers.size, 0);
    s.controller.request(s.state);
    other.dispatchEvent(new Event("touchstart"));
    s.flush();
    assert.equal(s.calls[2], s.container);
    s.controller.reset();
});
