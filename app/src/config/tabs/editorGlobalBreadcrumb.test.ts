import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, ScriptTarget, transpileModule} from "typescript";

for (const mobile of [false, true]) {
    test(`global breadcrumb uses the shared editor behavior switch (mobile=${mobile})`, () => {
        const text = require("ifdef-loader/preprocessor").parse(readFileSync("src/config/tabs/editorTab.ts", "utf8"),
            {MOBILE: mobile, BROWSER: true}, false, true);
        const source = createSourceFile("editorTab.ts", text, ScriptTarget.ES2021, true);
        const declaration = source.statements.find(node => node.getText(source).startsWith("const registerEditorBehaviorGroup ="));
        assert.ok(declaration);
        const rows: Array<{kind: string; id: string; options: {title: string; desc: string; save?: unknown}}> = [];
        const exports = {} as {register: (tab: object) => void};
        runInNewContext(transpileModule(declaration.getText(source), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText +
            "\nexports.register = registerEditorBehaviorGroup;", {
            exports, isMobile: () => mobile, isBrowser: () => true, updateHotkeyTip: () => "",
            CODE_TAB_SPACE_VALUES: [], window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)}),
                config: {keymap: {general: {editReadonly: {custom: ""}}}}}},
        });
        exports.register({group: (id: string) => {
            assert.equal(id, "behavior");
            return new Proxy({}, {get: (_, kind: string) => (id: string, options: typeof rows[number]["options"]) => {
                rows.push({kind, id, options});
            }});
        }});
        const row = rows.find(item => item.id === "editor.globalBreadcrumb");
        assert.ok(row);
        assert.equal(row.kind, "switch");
        assert.equal(row.options.title, "globalBreadcrumb");
        assert.equal(row.options.desc, "globalBreadcrumbTip");
        assert.equal(row.options.save, undefined);
    });
}

test("global breadcrumb changes invalidate existing editor paths immediately", () => {
    const source = readFileSync("src/config/tabs/editorRuntime.ts", "utf8");
    assert.match(source, /old\.globalBreadcrumb !== next\.globalBreadcrumb\) protyle\.breadcrumb\?\.render\(protyle, true\)/);
    const protyle = readFileSync("src/protyle/index.ts", "utf8");
    for (const command of ["renamenotebook", "rename", "moveDoc"]) {
        const handler = protyle.split(`case "${command}":`)[1].split(/\n\s*case /)[0];
        assert.match(handler, /globalBreadcrumb/);
        assert.match(handler, /this\.protyle\.breadcrumb\?\.render\(this\.protyle, true\)/);
    }
});
