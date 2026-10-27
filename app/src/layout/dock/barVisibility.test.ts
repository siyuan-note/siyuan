import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {shouldShowDockBar, shouldShowDockSplit} from "./barVisibility";

const loadBarVisibility = (layout: unknown, hideStatusBar = false) => {
    const source = readFileSync(resolve(process.cwd(), "src/layout/dock/barVisibility.ts"), "utf8");
    const compiled = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const exports = {} as typeof import("./barVisibility");
    const rootProperties: Record<string, string> = {};
    runInNewContext(compiled, {
        exports,
        document: {
            documentElement: {style: {setProperty: (name: string, value: string) => {
                rootProperties[name] = value;
            }}},
            querySelectorAll: (): HTMLElement[] => [],
        },
        window: {siyuan: {layout, config: {appearance: {hideStatusBar}}}},
    });
    return {bar: exports, rootProperties};
};

describe("dock padding", () => {
    it("skips windows without a main dock layout and layouts still being initialized", () => {
        for (const layout of [undefined, {}, {layout: {children: []}},
            {layout: {children: [{element: {style: {}}}]}},
            {layout: {children: [{element: {style: {}}}]}, leftDock: {elements: []}, rightDock: {elements: []}}]) {
            const {bar, rootProperties} = loadBarVisibility(layout);
            assert.doesNotThrow(bar.adjustDockPadding);
            assert.doesNotThrow(bar.syncDockBarVisibility);
            assert.equal(rootProperties["--b3-dock-right-width"], "0px");
        }
    });

    it("updates and clears main layout margins as dock and status bars change visibility", () => {
        const style = {marginLeft: "", marginRight: "", marginBottom: ""};
        let leftHidden = true;
        let rightHidden = false;
        const layout = {
            layout: {children: [{element: {style}}]},
            leftDock: {elements: [{parentElement: {classList: {contains: () => leftHidden}}}]},
            rightDock: {elements: [{parentElement: {classList: {contains: () => rightHidden}}}]},
        };
        loadBarVisibility(layout, true).bar.adjustDockPadding();
        assert.deepEqual(style, {marginLeft: "var(--b3-layout-space)", marginRight: "",
            marginBottom: "var(--b3-layout-space)"});
        leftHidden = false;
        rightHidden = true;
        loadBarVisibility(layout).bar.adjustDockPadding();
        assert.deepEqual(style, {marginLeft: "", marginRight: "var(--b3-layout-space)", marginBottom: ""});
        rightHidden = false;
        loadBarVisibility(layout).bar.adjustDockPadding();
        assert.deepEqual(style, {marginLeft: "", marginRight: "", marginBottom: ""});
    });

    it("preserves hidden-dock padding while a temporary dock bar overlays the editor", () => {
        const style = {marginLeft: "", marginRight: "", marginBottom: ""};
        const floatingBar = {classList: {contains: (name: string) => name === "dock--float"}};
        const layout = {
            layout: {children: [{element: {style}}]},
            leftDock: {elements: [{parentElement: floatingBar}]},
            rightDock: {elements: [{parentElement: floatingBar}]},
        };
        loadBarVisibility(layout).bar.adjustDockPadding();
        assert.deepEqual(style, {marginLeft: "var(--b3-layout-space)", marginRight: "var(--b3-layout-space)", marginBottom: ""});
    });
});

describe("dock bar visibility", () => {
    it("shows a non-empty dock bar when dock bars are enabled", () => {
        assert.equal(shouldShowDockBar(false, true), true);
    });

    it("hides an empty dock bar", () => {
        assert.equal(shouldShowDockBar(false, false), false);
    });

    it("keeps dock bars hidden without an expanded floating panel when they are globally disabled", () => {
        assert.equal(shouldShowDockBar(true, true), false);
        assert.equal(shouldShowDockBar(true, false), false);
    });

    it("temporarily shows non-empty dock bars for a floating panel or edge hover", () => {
        assert.equal(shouldShowDockBar(true, true, true), true);
        assert.equal(shouldShowDockBar(true, false, true), false);
        assert.equal(shouldShowDockBar(false, true, true), true);
    });
});

describe("dock split visibility", () => {
    it("shows the split when both adjacent sections contain visible entries", () => {
        assert.equal(shouldShowDockSplit(true, true), true);
    });

    it("hides the split when either adjacent section is empty", () => {
        assert.equal(shouldShowDockSplit(false, true), false);
        assert.equal(shouldShowDockSplit(true, false), false);
        assert.equal(shouldShowDockSplit(false, false), false);
    });
});
