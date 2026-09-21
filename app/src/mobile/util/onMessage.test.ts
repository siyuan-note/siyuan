import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/mobile/util/onMessage.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const createStatusHarness = () => {
    const statusElement = {style: {bottom: ""}, innerHTML: ""};
    const state = {keyboardOpen: false, hideStatusBar: false};
    const timers = new Map<number, {callback: () => void, delay: number}>();
    let timerID = 0;
    const moduleExports = {} as {onMessage: (app: unknown, data: unknown) => void};
    runInNewContext(compiled, {
        exports: moduleExports,
        document: {
            querySelector: (selector: string) => selector === "#status" ? statusElement : {
                classList: {contains: () => !state.keyboardOpen},
            },
        },
        window: {
            siyuan: {config: {appearance: state}},
            setTimeout: (callback: () => void, delay: number) => {
                timers.set(++timerID, {callback, delay});
                return timerID;
            },
        },
        clearTimeout: (id: number) => timers.delete(id),
        require: () => ({sanitizeKernelHTML: (value: string) => value}),
    });
    return {statusElement, state, timers, send: (data: unknown) => moduleExports.onMessage({}, data)};
};

test("mobile status messages appear at the bottom and hide after the timeout", () => {
    const {statusElement, timers, send} = createStatusHarness();
    send({cmd: "statusbar", msg: "Index updated"});
    assert.equal(statusElement.style.bottom, "0");
    assert.equal(statusElement.innerHTML, "Index updated");
    assert.equal(timers.size, 1);
    const timer = timers.values().next().value;
    assert.equal(timer.delay, 12000);
    timer.callback();
    assert.equal(statusElement.style.bottom, "");
});

test("mobile background progress stays at the bottom until tasks finish", () => {
    const {statusElement, timers, send} = createStatusHarness();
    send({cmd: "statusbar", msg: "Index updated"});
    send({cmd: "backgroundtask", data: {tasks: [{action: "Indexing"}]}});
    assert.equal(statusElement.style.bottom, "0");
    assert.match(statusElement.innerHTML, /Indexing/);
    assert.match(statusElement.innerHTML, /fn__progress/);
    assert.equal(timers.size, 0);
    send({cmd: "backgroundtask", data: {tasks: []}});
    assert.equal(statusElement.style.bottom, "");
});

test("mobile status messages and progress respect keyboard and visibility settings", () => {
    for (const reason of ["keyboardOpen", "hideStatusBar"] as const) {
        const {statusElement, state, timers, send} = createStatusHarness();
        state[reason] = true;
        send({cmd: "statusbar", msg: "Index updated"});
        send({cmd: "backgroundtask", data: {tasks: [{action: "Indexing"}]}});
        assert.equal(statusElement.style.bottom, "");
        assert.equal(statusElement.innerHTML, "");
        assert.equal(timers.size, 0);
    }
});
