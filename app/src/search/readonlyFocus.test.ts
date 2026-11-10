import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("locking a focusable search preview retains shortcut focus without stealing another panel's focus", () => {
    const source = readFileSync("src/protyle/util/onGet.ts", "utf8");
    const code = transpileModule(source.slice(source.indexOf("export const disabledProtyle = "),
        source.indexOf("/** 解除编辑器禁用 */")).replace("export const", "const"), {}).outputText;
    for (const focused of [false, true]) {
        for (const focusable of [false, true]) {
            const content = {};
            const body = {};
            const document = {activeElement: focused ? content : body};
            let focusCalls = 0;
            const element = {
                contains: (node: unknown) => node === content,
                hasAttribute: () => focusable,
                focus: (options: FocusOptions) => { assert.equal(options.preventScroll, true); focusCalls++; },
            };
            const protyle = {element, disabled: false, wysiwyg: {element: {querySelectorAll: (): unknown[] => []}}};
            runInNewContext(code + "\ndisabledProtyle(protyle);", {
                protyle, document,
                window: {siyuan: {mobile: {}, menus: {menu: {remove() {}}}}},
                hideElements() {}, syncRelatedAVEditor() {}, refreshCalendarReadonly() {}, hideTooltip() {},
                updateMobileTitleReadonly() {},
                disabledWYSIWYG: () => { document.activeElement = body; },
            });
            assert.equal(focusCalls, focused && focusable ? 1 : 0);
        }
    }
});

test("global readonly changes reload only the focused editor with focus restoration", () => {
    const source = readFileSync("src/config/tabs/editorRuntime.ts", "utf8");
    for (const changed of [false, true]) {
        const focused = {};
        const other = {};
        const calls: Array<{protyle: unknown, focus: boolean}> = [];
        let runtime: any;
        const editor = (node: unknown) => ({protyle: {
            element: {contains: (active: unknown) => active === node},
            wysiwyg: {element: {getAttribute: () => "true"}},
            contentElement: {getAttribute: () => "true"},
        }});
        const editors = [editor(focused), editor(other)];
        const modules = {
            createSectionRuntime: (options: unknown) => { runtime = options; return {}; },
            createConfigNamespaceApi: () => ({}), getAllEditor: () => editors,
            Constants: {}, setTitleAutoDirection() {},
            reloadProtyle: (protyle: unknown, focus: boolean) => calls.push({protyle, focus}),
        };
        runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
            exports: {}, require: () => modules,
            document: {activeElement: focused, getElementById: (): null => null},
        });
        runtime.reactions.find((reaction: {name: string}) => reaction.name === "editor-layout")
            .apply({readOnly: false}, {readOnly: changed});
        assert.deepEqual(calls, [{protyle: editors[0].protyle, focus: changed},
            {protyle: editors[1].protyle, focus: false}]);
    }
});
