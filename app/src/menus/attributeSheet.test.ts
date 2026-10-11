import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [true, false]) {
    for (const focusName of ["bookmark", "name", "memo", "alias", "av", "custom"]) {
        test(`${mobile ? "mobile" : "desktop"} attribute panel focus (${focusName})`, () => {
            const calls: string[] = [];
            const fields = ["bookmark", "name", "memo"].map(name => ({
                value: "",
                getAttribute: () => name,
                focus: () => calls.push(`focus:${name}`),
                addEventListener() {},
            }));
            const element = {
                contains: () => false,
                setAttribute() {},
                addEventListener() {},
                dispatchEvent: (event: {detail: string}) => calls.push(`tab:${event.detail}`),
                querySelector: (selector: string) => fields.find(field => selector.includes(`"${field.getAttribute()}"`)),
                querySelectorAll: (selector: string) => selector.includes("custom-attr") ? [] : fields,
            };
            const dependencies: Record<string, unknown> = {
                "../util/functions": {isMobile: () => mobile},
                "../constants": {Constants: {}},
                "../dialog": {Dialog: class {
                    element = element;
                    constructor() { calls.push("dialog"); }
                    destroy() {}
                }},
                "./aliasInput": {bindAliasInput: () => ({focus: () => calls.push("focus:alias")})},
                "../mobile/util/keyboardToolbar": {activeBlur: (force: boolean) => {
                    assert.equal(force, true);
                    calls.push("hide-keyboard");
                }},
                "../mobile/util/bindBottomSheetDialog": {bindBottomSheetDialog: () => {
                    calls.push("sheet");
                    return () => {};
                }},
            };
            const source = parse(readFileSync("src/menus/commonMenuItem.ts", "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true, "commonMenuItem.ts");
            const code = transpileModule(source, {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
            }).outputText;
            const exports: {openFileAttr?: (attrs: object, focusName: string, protyle: object) => void} = {};
            runInNewContext(code, {
                exports, require: (name: string) => dependencies[name] || {},
                document: {activeElement: {blur: () => calls.push("blur")}},
                getSelection: () => ({rangeCount: 0}),
                window: {siyuan: {languages: {}, config: {editor: {spellcheck: false}}}},
                CustomEvent: class {detail: string; constructor(_type: string, options: {detail: string}) {
                    this.detail = options.detail;
                }},
            });
            exports.openFileAttr({id: "doc"}, focusName, {});
            const tab = focusName === "av" ? ["tab:NodeAttributeView", "blur"] :
                focusName === "custom" ? ["tab:custom"] : [];
            assert.deepEqual(calls, mobile ? ["blur", "hide-keyboard", "dialog", "sheet", ...tab] :
                ["dialog", ...(["av", "custom"].includes(focusName) ? tab : [`focus:${focusName}`])]);
        });
    }
}

for (const mobile of [true, false]) {
    for (const kernelReadonly of [true, false]) {
        test(`${mobile ? "mobile" : "desktop"} readonly attributes block writes and initial focus (${kernelReadonly})`, () => {
            const calls: string[] = [];
            const containers = ["attr", "custom", "NodeAttributeView"].map(type => ({dataset: {type, readonly: ""}}));
            const fields = ["bookmark", "name", "memo", "custom-test"].map(name => ({
                value: "", readOnly: false, dataset: {name},
                getAttribute: () => name,
                focus: () => calls.push("focus"),
                change: (): void => undefined,
                addEventListener(_type: string, callback: () => void) { this.change = callback; },
            }));
            let click: (event: object) => void;
            const element = {
                contains: () => false, setAttribute() {},
                addEventListener: (_type: string, callback: typeof click) => { click = callback; },
                querySelector: (selector: string) => fields.find(field => selector.includes(`"${field.dataset.name}"`)),
                querySelectorAll: (selector: string) => selector === ".custom-attr" ? containers :
                    selector.includes("custom-attr") ? [fields[3]] : fields,
            };
            const dependencies: Record<string, unknown> = {
                "../util/functions": {isMobile: () => mobile},
                "../constants": {Constants: {}},
                "../dialog": {Dialog: class {element = element; destroy() {}}},
                "./aliasInput": {bindAliasInput: (_element: unknown, _value: string, options: {readonly: boolean}) => {
                    assert.equal(options.readonly, true);
                    return {focus: () => calls.push("alias-focus")};
                }},
                "../util/fetch": {fetchPost: () => calls.push("write")},
                "../mobile/util/keyboardToolbar": {activeBlur() {}},
                "../mobile/util/bindBottomSheetDialog": {bindBottomSheetDialog: () => () => {}},
            };
            const source = parse(readFileSync("src/menus/commonMenuItem.ts", "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true, "commonMenuItem.ts");
            const code = transpileModule(source, {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
            }).outputText;
            const exports: {openFileAttr?: (attrs: object, focusName: string, protyle: object) => void} = {};
            runInNewContext(code, {
                exports, require: (name: string) => dependencies[name] || {},
                document: {activeElement: {blur() {}}},
                getSelection: () => ({rangeCount: 0}),
                window: {siyuan: {languages: {}, config: {readonly: kernelReadonly, editor: {spellcheck: false}}}},
            });
            exports.openFileAttr({id: "doc", "custom-test": "value"}, "alias", {disabled: !kernelReadonly});
            assert.ok(containers.every(container => container.dataset.readonly === "true"));
            assert.ok(fields.every(field => field.readOnly));
            fields.forEach(field => field.change());
            for (const action of ["remove", "bookmark", "addCustom"]) {
                click({target: {dataset: {action}}, preventDefault() {}, stopPropagation() {}});
            }
            assert.deepEqual(calls, []);
        });
    }
}
