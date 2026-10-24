import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, ScriptTarget, transpileModule} from "typescript";

for (const mobile of [false, true]) {
    test(`embed breadcrumb settings use standard switches in the shared embeds group (mobile=${mobile})`, () => {
        const text = require("ifdef-loader/preprocessor").parse(readFileSync("src/config/tabs/editorTab.ts", "utf8"),
            {MOBILE: mobile, BROWSER: true}, false, true);
        const source = createSourceFile("editorTab.ts", text, ScriptTarget.ES2021, true);
        const declaration = source.statements.find(node => node.getText(source).startsWith("const registerEditorEmbedsGroup ="));
        assert.ok(declaration);
        const rows: Array<{kind: string; id: string; options: {title: string; desc: string; save?: unknown}}> = [];
        const exports = {} as {register: (tab: object) => void};
        runInNewContext(transpileModule(declaration.getText(source), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText +
            "\nexports.register = registerEditorEmbedsGroup;", {
            exports, window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
        });
        exports.register({group: (id: string) => {
            assert.equal(id, "embeds");
            return new Proxy({}, {get: (_, kind: string) => (id: string, options: typeof rows[number]["options"]) => {
                rows.push({kind, id, options});
            }});
        }});
        for (const [index, key] of ["embedBlockBreadcrumb", "embedBlockBreadcrumbParentPath"].entries()) {
            const row = rows[index + 1];
            assert.equal(row.id, `editor.${key}`);
            assert.equal(row.kind, "switch");
            assert.equal(row.options.title, key);
            assert.equal(row.options.desc, key + "Tip");
            assert.equal(row.options.save, undefined, "standard editor configuration persistence is shared across platforms");
        }
    });
}
