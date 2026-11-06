import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {afterEach, test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {copyBlockSelection} from "../../util/blockClipboard";

const source = transpileModule(readFileSync("src/protyle/render/av/view.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText + "\nexports.copyViewMirror = copyViewMirror;";
const globals = new Map(["document", "window", "navigator"].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => globals.forEach((descriptor, key) => {
    if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, key);
    }
}));

const setup = (platform: string, attributes: Array<[string, string]>, fails = false) => {
    const values = new Map(attributes);
    const savedRange = {startContainer: {isConnected: true}, endContainer: {isConnected: true},
        cloneRange: () => savedRange};
    let currentRange: unknown = savedRange;
    let selected: unknown;
    let focused = false;
    const cursor = {focus: () => { focused = true; currentRange = null; }};
    const copyRange = {selectNodeContents: (element: unknown) => { selected = element; }};
    const copied: Array<Map<string, string>> = [];
    const block = {
        matches: (selector: string) => selector === '[data-type="NodeAttributeView"]',
        querySelector: (selector: string) => selector === ".av__cursor" ? cursor : null,
        getAttribute: (key: string) => values.get(key) ?? null,
        setAttribute: (key: string, value: string) => values.set(key, value),
        removeAttribute: (key: string) => values.delete(key),
    };
    const document = {
        createRange: () => copyRange,
        execCommand: (command: string) => {
            assert.equal(command, "copy");
            if (fails) {
                throw new Error("clipboard unavailable");
            }
            if (focused && selected === cursor && currentRange === copyRange) {
                copied.push(new Map(values));
            }
        },
    };
    const window = {getSelection: () => ({rangeCount: 1, getRangeAt: () => savedRange,
        removeAllRanges: () => { currentRange = null; },
        addRange: (range: unknown) => { currentRange = range; }})};
    const navigator = {userAgent: platform === "iPhone" ? "iPhone" : platform,
        platform, maxTouchPoints: platform === "Win32" ? 0 : 5};
    Object.entries({document, window, navigator}).forEach(([key, value]) =>
        Object.defineProperty(globalThis, key, {configurable: true, value}));
    const exports = {} as {copyViewMirror: (element: unknown, viewID: string) => void};
    runInNewContext(source, {exports, document, window, require: () => ({
        copyBlockSelection,
        Constants: {CUSTOM_SY_AV_VISIBLE_VIEWS: "visible", CUSTOM_SY_AV_VIEW: "view"},
        isNotEditBlock: () => true,
        focusBlock: () => { currentRange = savedRange; },
    })});
    return {copy: () => exports.copyViewMirror(block, "selected"), values, copied,
        current: () => currentRange, savedRange};
};

for (const platform of ["iPhone", "MacIntel", "Linux armv8l", "Win32"]) {
    for (const attributes of [[], [["view", "original"], ["visible", "original,other"]]] as Array<Array<[string, string]>>) {
        test(`view mirror copy uses the database cursor and restores attributes on ${platform} (${attributes.length ? "configured" : "default"})`, () => {
            const state = setup(platform, attributes);
            state.copy();
            assert.equal(state.copied.length, 1, "native copy must receive a non-collapsed database cursor selection");
            assert.deepEqual(state.copied[0], new Map([["view", "selected"], ["visible", "selected"]]));
            assert.deepEqual(state.values, new Map(attributes));
            assert.equal(state.current(), state.savedRange);
        });
    }
}

test("view mirror copy restores view attributes and selection when the clipboard throws", () => {
    const attributes: Array<[string, string]> = [["view", "original"], ["visible", "original,other"]];
    const state = setup("iPhone", attributes, true);
    assert.throws(state.copy, /clipboard unavailable/);
    assert.deepEqual(state.values, new Map(attributes));
    assert.equal(state.current(), state.savedRange);
});
