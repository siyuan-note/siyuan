import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {Tab} from "./Tab";

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

for (const type of ["closeOthers", "closeAll"] as const) {
    for (const outcome of ["immediate", "pending", "blocked", "failed", "mixed"] as const) {
        test(`${type} records only successful closes when closing is ${outcome}`, async () => {
            const source = readFileSync(join(__dirname, "tabUtil.ts"), "utf8");
            const code = transpileModule(source, {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
            }).outputText;
            class Editor {
                editor = {protyle: {block: {rootID: "loaded-document"}}};
            }
            const requests: {url: string, data: {rootIDs: string[]}}[] = [];
            const modules: Record<string, unknown> = {
                "../editor": {Editor},
                "../util/fetch": {fetchPost: (url: string, data: {rootIDs: string[]}) => requests.push({url, data})},
            };
            const exports = {} as typeof import("./tabUtil");
            new Function("exports", "require", code)(exports, (name: string) => modules[name] || {});
            const calls: {id: string, batch: boolean, animate: boolean}[] = [];
            const pending: (() => void)[] = [];
            let focusedID = "current";
            let switches = 0;
            const wnd = {
                children: [] as Tab[],
                removeTab(id: string, batch: boolean, animate = true): boolean | Promise<boolean> {
                    calls.push({id, batch, animate});
                    // Bound the regression: the old loop retries forever without this guard.
                    assert.ok(calls.length <= 3, "a pending or blocked tab must not be retried in the same batch");
                    if (outcome === "mixed" && id === "lazy") return Promise.resolve(false);
                    const remove = () => {
                        const index = this.children.findIndex((item: Tab) => item.id === id);
                        this.children.splice(index, 1);
                        return true;
                    };
                    if (outcome === "immediate" || outcome === "mixed") {
                        return remove();
                    } else if (outcome === "pending") {
                        return new Promise(resolve => pending.push(() => resolve(remove())));
                    } else if (outcome === "failed") {
                        return Promise.resolve(false);
                    }
                    return false;
                },
                switchTab(head: HTMLElement) {
                    switches++;
                    focusedID = this.children.find((item: Tab) => item.headElement === head)?.id;
                },
            };
            const makeTab = (id: string, pinned = false, lazy = false) => ({
                id,
                parent: wnd,
                model: lazy ? undefined : new Editor(),
                headElement: {
                    classList: {contains: (name: string) => (name === "item--pin" && pinned) ||
                        (name === "item--focus" && id === focusedID)},
                    getAttribute: () => JSON.stringify({instance: "Editor", rootId: "lazy-document"}),
                    parentElement: {querySelector: () => ({})},
                },
            }) as unknown as Tab;
            const current = makeTab("current");
            const loaded = makeTab("loaded");
            const lazy = makeTab("lazy", false, true);
            const pinned = makeTab("pinned", true);
            const hidden = {id: "without-header", parent: wnd} as unknown as Tab;
            wnd.children = [loaded, current, pinned, lazy, hidden];

            const closing = exports.closeTabByType(current, type);

            const expected = type === "closeOthers" ? ["loaded", "lazy"] : ["loaded", "current", "lazy"];
            assert.deepEqual(calls.map(call => call.id), expected);
            assert.ok(calls.every(call => call.batch && call.animate === (type === "closeAll")));
            assert.deepEqual(requests, [], "no history update before close acknowledgement");
            if (outcome !== "immediate" && outcome !== "mixed") {
                assert.equal(wnd.children.length, 5, "pending and blocked tabs remain open");
            }
            if (outcome === "pending") focusedID = "pinned";
            pending.forEach(remove => remove());
            await closing;
            assert.deepEqual(requests, outcome === "blocked" || outcome === "failed" ? [] : [{
                url: "/api/storage/batchUpdateRecentDocCloseTime",
                data: {rootIDs: outcome === "mixed" ? (type === "closeOthers" ? ["loaded-document"] :
                    ["loaded-document", "loaded-document"]) : type === "closeOthers" ?
                    ["loaded-document", "lazy-document"] : ["loaded-document", "loaded-document", "lazy-document"]},
            }]);
            assert.deepEqual(wnd.children.map(item => item.id), outcome === "blocked" || outcome === "failed" ?
                ["loaded", "current", "pinned", "lazy", "without-header"] :
                outcome === "mixed" ? (type === "closeOthers" ? ["current", "pinned", "lazy", "without-header"] :
                    ["pinned", "lazy", "without-header"]) :
                type === "closeOthers" ? ["current", "pinned", "without-header"] : ["pinned", "without-header"]);
            assert.equal(switches, type === "closeAll" && (outcome === "immediate" || outcome === "mixed") ? 1 : 0,
                "late completion must preserve a newer focus");
        });
    }
}
