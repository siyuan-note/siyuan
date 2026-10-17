import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [false, true]) {
    test(`full block indicator switch uses standard boolean settings (mobile=${mobile})`, () => {
        const source = createSourceFile("editorTab.ts", parse(readFileSync("src/config/tabs/editorTab.ts", "utf8"),
            {BROWSER: true, MOBILE: mobile}, false, true), ScriptTarget.ES2021, true);
        const registration = source.statements.find(node => node.getText(source).startsWith("const registerEditorBehaviorGroup ="));
        assert.ok(registration);
        const rows: Array<{kind: string; id: string; spec: {
            title: string; desc: string; readConfig?: () => boolean; save?: (value: boolean) => Promise<void>;
        }}> = [];
        const exports: {register?: (tab: unknown) => void} = {};
        runInNewContext(transpileModule(registration.getText(source), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText + "\nexports.register = registerEditorBehaviorGroup;", {
            exports,
            window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)}),
                config: {keymap: {general: {editReadonly: {custom: ""}}}}}},
            isMobile: () => mobile, isBrowser: () => true,
            updateHotkeyTip: String,
            CODE_TAB_SPACE_VALUES: [0, 2, 4, 6, 8], getCodeTabSpacesLabel: String,
        });
        exports.register({group: (name: string) => {
            assert.equal(name, "behavior");
            return new Proxy({}, {get: (_, kind: string) => (id: string, spec: typeof rows[number]["spec"]) => {
                rows.push({kind, id, spec});
            }});
        }});
        const index = rows.findIndex(row => row.id === "editor.blockGutterMode");
        assert.ok(index > 0);
        assert.equal(rows[index - 1].id, "editor.displayBookmarkIcon");
        assert.equal(rows[index].kind, "switch");
        const spec = rows[index].spec;
        assert.equal(spec.title, "blockGutterMode");
        assert.equal(spec.desc, "blockGutterModeTip");
        assert.equal(spec.readConfig, undefined, "the switch reads the boolean configuration directly");
        assert.equal(spec.save, undefined, "the switch uses the standard editor configuration writer");
    });
}
