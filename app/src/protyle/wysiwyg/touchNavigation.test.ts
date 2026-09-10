import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/wysiwyg/touchNavigation.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    const exports: any = {};
    let time = 0;
    const targets: unknown[] = [];
    const points: unknown[] = [];
    const listeners = new Map<string, (event: any) => void>();
    const element = {addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener)};
    runInNewContext(compiled, {
        exports,
        require: () => ({Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460}}),
        Date: {now: () => time},
    });
    exports.bindTouchNavigation(element, (target: unknown, point: unknown) => {
        targets.push(target);
        points.push(point);
    });
    const target = {closest: () => element};
    const send = (type: string, options: any = {}) => {
        const touch = {identifier: 1, clientX: 100, clientY: 100, ...options.point};
        listeners.get(type)({
            target,
            defaultPrevented: false,
            touches: type === "touchend" ? [] : [touch],
            changedTouches: [touch],
            ...options,
        });
    };
    return {send, targets, points, target, advance: () => time += 500};
};

test("native touch taps record each paragraph without requiring a click", () => {
    const f = fixture();
    f.send("touchstart");
    f.send("touchend");
    f.send("touchstart");
    f.send("touchend");
    assert.deepEqual(f.targets, [f.target, f.target]);
    assert.equal(JSON.stringify(f.points), JSON.stringify([{x: 100, y: 100}, {x: 100, y: 100}]));
});

test("scrolling away and back, cancellation and long presses do not record navigation", () => {
    const f = fixture();
    f.send("touchstart");
    f.send("touchmove", {point: {clientY: 110}});
    f.send("touchend");
    f.send("touchstart");
    f.send("touchcancel");
    f.send("touchend");
    f.send("touchstart");
    f.advance();
    f.send("touchend");
    assert.deepEqual(f.targets, []);
});

test("multi-touch and gestures handled by other controls do not record navigation", () => {
    const f = fixture();
    f.send("touchstart");
    f.send("touchstart", {touches: [{identifier: 1}, {identifier: 2}]});
    f.send("touchend");
    f.send("touchstart", {defaultPrevented: true});
    f.send("touchend");
    f.send("touchstart");
    f.send("touchend", {defaultPrevented: true});
    assert.deepEqual(f.targets, []);
});
