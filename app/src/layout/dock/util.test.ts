import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeAriaLabel} from "../../util/escape";

const compile = (path: string) => transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const hidden of [false, true]) {
    test(`dock toggle tip describes the next action at startup, after clicks and shortcut toggles (hidden=${hidden})`, () => {
        const buttonAttributes = new Map<string, string>();
        const iconAttributes = new Map([["xlink:href", hidden ? "#iconDock" : "#iconHideDock"]]);
        const button = {id: "barDock", firstElementChild: {firstElementChild: null as unknown},
            setAttribute: (name: string, value: string) => buttonAttributes.set(name, value)};
        const icon = {
            getAttribute: (name: string) => iconAttributes.get(name),
            setAttribute: (name: string, value: string) => iconAttributes.set(name, value),
            closest: (selector: string) => selector === "#barDock" ? button : null,
        };
        button.firstElementChild.firstElementChild = icon;
        let click: (event: unknown) => void;
        const status = {innerHTML: "", addEventListener: (_name: string, handler: typeof click) => { click = handler; }};
        const uiLayout = {hideDock: hidden};
        const key = {custom: "Alt+D"};
        const dock = {isFloating: () => false};
        const siyuan = {config: {uiLayout, readonly: false, appearance: {hideStatusBar: false}, keymap: {general: {toggleDock: key}}},
            languages: {showDockBar: "Show dock bars", hideDockBar: "Hide dock bars"},
            layout: {leftDock: dock, rightDock: dock, bottomDock: dock}};
        const util = {} as typeof import("./util");
        const dependencies = {updateHotkeyTip: (value: string) => value,
            syncDockBarVisibility() {}, resizeTabs() {}, setTabPosition() {}};
        runInNewContext(compile("src/layout/dock/util.ts"), {
            exports: util, window: {siyuan}, require: () => dependencies,
        });
        const exports = {} as typeof import("../status");
        runInNewContext(compile("src/layout/status.ts"), {
            exports, window: {siyuan},
            document: {getElementById: () => status, querySelector: () => status},
            require: (name: string) => name === "./dock/util" ? util : {escapeAriaLabel, applyStatusBarEntryVisibility() {}},
        });
        exports.initStatus();
        const action = (isHidden: boolean) => isHidden ? "Show dock bars" : "Hide dock bars";
        assert.ok(status.innerHTML.includes(`aria-label="${action(hidden)} Alt+D"`));
        click({target: button, stopPropagation() {}});
        assert.equal(uiLayout.hideDock, !hidden);
        assert.equal(buttonAttributes.get("aria-label"), `${action(!hidden)} Alt+D`);
        util.toggleDockBar(icon as unknown as Element);
        assert.equal(uiLayout.hideDock, hidden);
        assert.equal(buttonAttributes.get("aria-label"), `${action(hidden)} Alt+D`);
        key.custom = "";
        util.toggleDockBar(icon as unknown as Element);
        assert.equal(buttonAttributes.get("aria-label"), action(!hidden));
    });
}
