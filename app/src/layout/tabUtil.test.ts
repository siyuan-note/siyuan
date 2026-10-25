import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadTabUtil = (headerTop: number) => {
    const source = readFileSync(join(__dirname, "tabUtil.ts"), "utf8");
    const code = transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const created: string[] = [];
    const spacerStyle = {} as Record<string, string>;
    const spacer = {style: spacerStyle, parentElement: {parentElement: {style: {}}} as unknown as HTMLElement};
    (spacer as unknown as {parentElement: {clientHeight: number}}).parentElement.clientHeight = 29;
    const headerElement = {
        classList: {contains: (): boolean => false, remove: (): void => undefined},
        getBoundingClientRect: (): DOMRect => ({top: headerTop, left: 0, right: 900, width: 900}) as DOMRect,
        style: {paddingLeft: "", visibility: ""},
        lastElementChild: {style: {marginRight: ""}},
        querySelector: (selector: string): unknown => {
            created.push(selector);
            return spacer;
        },
    };
    const item = {
        headersElement: {parentElement: headerElement},
        element: {
            classList: {add: (): void => undefined, remove: (): void => undefined},
            querySelector: (): unknown => ({style: {backgroundColor: ""}}),
        },
    };
    const saved = new Map<string, PropertyDescriptor | undefined>();
    for (const key of ["window", "document", "getComputedStyle"]) {
        saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    Object.assign(globalThis, {
        window: {siyuan: {layout: {layout: {element: {
            getBoundingClientRect: (): {left: number, right: number} => ({left: 0, right: 900}),
        }}}}},
        document: {getElementById: (): null => null, querySelector: (): {clientWidth: number} => ({clientWidth: 120}),
            body: {}},
        getComputedStyle: (): {getPropertyValue: () => string} => ({getPropertyValue: (): string => "8px"}),
    });
    const exports = {} as typeof import("./tabUtil");
    const modules: Record<string, unknown> = {
        "./getAll": {getAllWnds: (_layout: unknown, wnds: unknown[]) => wnds.push(item)},
        "../util/functions": {isWindow: () => true},
    };
    new Function("exports", "require", code)(exports, (name: string) => modules[name] || {});
    const restore = () => saved.forEach((descriptor, key) => descriptor ?
        Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
    return {setTabPosition: exports.setTabPosition, spacerStyle, headerElement, spacer, created, restore};
};

test("tab drag spacer stretches with the row instead of pinning a pixel height", () => {
    const f = loadTabUtil(0);
    try {
        f.setTabPosition();
        assert.equal(f.spacerStyle.alignSelf, "stretch", "the spacer fills the row height through flex stretching");
        assert.equal(f.spacerStyle.height, "",
            "a pinned pixel height cannot shrink after the interface density changes");
        assert.equal(f.spacerStyle.WebkitAppRegion, "drag");
        // 再次执行（对应界面密度、覆盖层高度变化后的重算）仍然不写死高度。
        f.setTabPosition();
        assert.equal(f.spacerStyle.height, "");
        assert.equal(f.spacerStyle.alignSelf, "stretch");
    } finally {
        f.restore();
    }
});

test("tab drag spacer releases its stretching when the header leaves the top row", () => {
    const f = loadTabUtil(40);
    try {
        f.setTabPosition();
        assert.equal(f.spacerStyle.alignSelf, "");
        assert.equal(f.spacerStyle.height, "");
        assert.equal(f.spacerStyle.WebkitAppRegion, "");
    } finally {
        f.restore();
    }
});

test("padding-only updates leave the drag spacer untouched", () => {
    const f = loadTabUtil(0);
    try {
        f.setTabPosition(true);
        assert.equal(f.created.length, 0, "padding-only layout does not resize the drag spacer");
        assert.equal(f.spacerStyle.alignSelf, undefined);
    } finally {
        f.restore();
    }
});
