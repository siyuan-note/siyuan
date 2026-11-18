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
        const rows: Array<{kind: string; id: string; options: {title: string; desc: string; save?: unknown;
            afterMount?: (root: object) => void; keywords?: string[]}}> = [];
        const exports = {} as {register: (tab: object) => void};
        runInNewContext(transpileModule(declaration.getText(source), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText +
            "\nexports.register = registerEditorBehaviorGroup;", {
            exports, CSS: {escape: (id: string) => id}, isMobile: () => mobile, isBrowser: () => true, updateHotkeyTip: () => "",
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
        const iconsRow = rows[rows.indexOf(row) + 1];
        if (mobile) {
            assert.equal(rows.some(item => item.id === "editor.hideGlobalBreadcrumbIcons"), false);
            return;
        }
        assert.equal(iconsRow.id, "editor.hideGlobalBreadcrumbIcons");
        assert.equal(iconsRow.kind, "switch");
        assert.equal(iconsRow.options.save, undefined);
        assert.equal(row.options.keywords?.includes("hideGlobalBreadcrumbIcons"), true);

        const globalSwitch = new EventTarget() as EventTarget & {checked: boolean};
        globalSwitch.checked = false;
        let hidden: boolean;
        row.options.afterMount?.({querySelector: (selector: string) => selector === "#editor.globalBreadcrumb" ? globalSwitch : {
            closest: () => ({classList: {toggle: (_name: string, value: boolean) => { hidden = value; }}}),
        }});
        assert.equal(hidden, true);
        globalSwitch.checked = true;
        globalSwitch.dispatchEvent(new Event("change"));
        assert.equal(hidden, false);
        globalSwitch.checked = false;
        globalSwitch.dispatchEvent(new Event("change"));
        assert.equal(hidden, true);
    });
}

test("global breadcrumb changes invalidate existing editor paths immediately", () => {
    const source = readFileSync("src/config/tabs/editorRuntime.ts", "utf8");
    assert.match(source, /old\.globalBreadcrumb !== next\.globalBreadcrumb \|\|/);
    assert.match(source, /next\.globalBreadcrumb && old\.hideGlobalBreadcrumbIcons !== next\.hideGlobalBreadcrumbIcons\)\) \{\s*protyle\.breadcrumb\?\.render\(protyle, true\)/);
    const protyle = readFileSync("src/protyle/index.ts", "utf8");
    for (const command of ["renamenotebook", "rename", "moveDoc"]) {
        const handler = protyle.split(`case "${command}":`)[1].split(/\n\s*case /)[0];
        assert.match(handler, /globalBreadcrumb/);
        assert.match(handler, /this\.protyle\.breadcrumb\?\.render\(this\.protyle, true\)/);
    }
});
