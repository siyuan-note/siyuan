import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = (os = "ios", publish = false, send?: (payload: any) => Promise<object>, native = true) => {
    const listeners = new Map<string, (event: any) => void>();
    const timers = new Map<number, {callback: () => void, delay: number}>();
    const requests: any[] = [];
    let timer = 0;
    class Element {
        tagName = "DIV";
        closest() { return this; }
    }
    const exports: any = {};
    const source = transpileModule(readFileSync(join(__dirname, "keyboardDiagnostic.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const dependencies: Record<string, object> = {
        "../constants": {Constants: {SIYUAN_VERSION: "test"}},
        "../protyle/util/compatibility": {isInIOS: () => os === "ios" && native},
        "../protyle/util/hotKey": {matchHotKey: (binding: string, event: any) =>
            event.metaKey && binding === (event.keyCode === 70 ? "F" : event.keyCode === 80 ? "P" : "")},
        "./keymapBindings": {getKeymapBindings: (key: string) => [key]},
        "./fetch": {fetchSyncPost: async (url: string, payload: object, headers: object, process: boolean) => {
            assert.equal(url, "/api/system/appendKeyboardLog");
            assert.equal(process, false);
            requests.push(JSON.parse(JSON.stringify(payload)));
            return send ? send(payload) : {code: 0};
        }},
        "./fetchTimeout": {withFetchTimeout: (request: () => Promise<object>) => request()},
    };
    runInNewContext(source, {
        exports, require: (name: string) => dependencies[name], HTMLElement: Element, AbortController,
        clearTimeout: (id: number) => timers.delete(id), queueMicrotask,
        document: {body: {}}, navigator: {platform: "MacIntel", userAgent: "SiYuan iPad"},
        window: {
            siyuan: {isPublish: publish, config: {system: {os}, keymap: {general: {search: "F", globalSearch: "P"}}}},
            setTimeout: (callback: () => void, delay: number) => { timers.set(++timer, {callback, delay}); return timer; },
            addEventListener: (type: string, listener: (event: any) => void, capture: boolean) => {
                assert.equal(capture, true);
                listeners.set(type, listener);
            },
        },
    });
    const event = (values: object = {}) => ({type: "keydown", key: "p", code: "KeyP", keyCode: 80,
        metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false,
        isTrusted: true, defaultPrevented: false, cancelBubble: false, target: new Element(), ...values});
    const settle = () => {
        for (const [id, task] of timers) {
            if (task.delay === 0) {
                timers.delete(id);
                task.callback();
            }
        }
    };
    return {subject: exports, listeners, requests, event, timers, settle};
};

test("keyboard diagnostics only initialize once in the iOS app", async () => {
    for (const [os, publish] of [["windows", false], ["ios", true]] as const) {
        const value = fixture(os, publish);
        value.subject.initKeyboardDiagnostics("desktop");
        await value.subject.flushKeyboardDiagnostics();
        assert.equal(value.listeners.size, 0);
        assert.equal(value.requests.length, 0);
    }
    const browser = fixture("ios", false, undefined, false);
    browser.subject.initKeyboardDiagnostics("desktop");
    assert.equal(browser.listeners.size, 0);
    const value = fixture();
    value.subject.initKeyboardDiagnostics("mobile");
    value.subject.initKeyboardDiagnostics("mobile");
    await value.subject.flushKeyboardDiagnostics();
    assert.equal(value.requests[0].entries.length, 1);
    assert.equal(value.requests[0].entries[0].environment.frontend, "mobile");
});

test("captures composing and missing-modifier events without recording composition text", async () => {
    const value = fixture();
    value.subject.initKeyboardDiagnostics("desktop");
    const composing = value.event({key: "private-pinyin", code: "Unknown", keyCode: 229,
        metaKey: false, isComposing: true});
    value.listeners.get("compositionstart")({data: "private-document"});
    value.listeners.get("keydown")(composing);
    value.subject.logKeyboardDiagnostic("editor-stop", composing, "composing");
    composing.cancelBubble = true;
    await Promise.resolve();
    value.settle();
    const ordinary = value.event({metaKey: false});
    value.listeners.get("keydown")(ordinary);
    await Promise.resolve();
    value.settle();
    value.listeners.get("compositionend")({data: "private-document"});
    await value.subject.flushKeyboardDiagnostics();
    const entries = value.requests.flatMap(item => item.entries);
    const capture = entries.find(item => item.stage === "capture");
    const stopped = entries.find(item => item.stage === "editor-stop");
    const settled = entries.find(item => item.stage === "settled");
    assert.equal(capture.keyboard.keyCode, 229);
    assert.equal(capture.keyboard.composing, true);
    assert.equal(capture.keyboard.key, "Other");
    assert.equal(stopped.event, capture.event);
    assert.equal(settled.keyboard.cancelBubble, true);
    assert.equal(entries.filter(item => item.stage === "capture").length, 2);
    assert.equal(JSON.stringify(value.requests).includes("private-"), false);
});

test("retains event correlation across asynchronous search and flushes queued batches", async () => {
    const value = fixture();
    value.subject.initKeyboardDiagnostics("desktop");
    value.listeners.get("keydown")(value.event());
    const trace = value.subject.createKeyboardSearchTrace("globalSearch");
    trace("command-enter");
    await Promise.resolve();
    const duringDispatch = value.subject.createKeyboardSearchTrace("globalSearch");
    duringDispatch("command-enter");
    value.settle();
    trace("dialog-created");
    for (let index = 0; index < 60; index++) {
        value.listeners.get("compositionstart")({data: ""});
    }
    await value.subject.flushKeyboardDiagnostics();
    const entries = value.requests.flatMap(item => item.entries);
    assert.equal(value.requests.length, 2);
    assert.ok(value.requests.every(item => item.entries.length <= 50));
    const capture = entries.find(item => item.stage === "capture");
    assert.equal(capture.keyboard.matchGlobalSearch, true);
    assert.ok(entries.filter(item => item.stage === "command-enter").every(item => item.event === capture.event));
    assert.equal(entries.find(item => item.stage === "dialog-created").event, capture.event);
    assert.ok(entries.every((item, index) => item.seq === index + 1));
});

test("bounds memory, total records and failed requests without rejecting the export flush", async () => {
    const value = fixture("ios", false, async () => { throw new Error("offline"); });
    value.subject.initKeyboardDiagnostics("desktop");
    for (let index = 0; index < 1500; index++) {
        value.listeners.get("compositionstart")({data: ""});
    }
    for (let index = 0; index < 4; index++) {
        await value.subject.flushKeyboardDiagnostics();
    }
    assert.equal(value.requests.length, 3);
    assert.equal(value.requests[0].entries[0].seq, 801);
    assert.ok(value.requests.every(item => item.entries.every((entry: any) => entry.seq <= 1000)));
});
