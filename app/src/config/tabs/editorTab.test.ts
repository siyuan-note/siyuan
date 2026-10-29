import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

test("database field layout setting follows tabs and stays available when document panels are hidden", () => {
    const source = readFileSync("src/config/tabs/editorTab.ts", "utf8");
    const code = transpileModule(source.slice(source.indexOf("const bindDatabaseAttrSettingsVisibility ="),
        source.indexOf("const registerEditorListsGroup =")) + source.slice(source.indexOf("const registerEditorDatabaseGroup ="),
        source.indexOf("const registerEditorCodeGroup =")), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const register = new Function("window", "CSS", code + "\nreturn registerEditorDatabaseGroup;")(
        {siyuan: {languages: new Proxy({}, {get: (_target, key) => key})}}, {escape: (value: string) => value});
    const controls: {id: string, options?: {value: number}[], afterMount?: (root: unknown) => void}[] = [];
    const group = new Proxy({}, {get: () => (id: string, options: object) => controls.push({id, ...options})});
    register({group: (id: string) => {assert.equal(id, "database"); return group;}});
    const index = controls.findIndex(item => item.id === "editor.databaseAttrLayout");
    assert.equal(controls[index - 1].id, "editor.databaseAttrUseTabs");
    assert.deepEqual(Array.from(controls[index].options, item => item.value), [0, 1, 2]);
    const hidden = new Set<string>();
    const listeners: (() => void)[] = [];
    const show = {checked: false, addEventListener: (_event: string, listener: () => void) => listeners.push(listener)};
    const root = {querySelector: (selector: string) => selector === "#editor.databaseAttrShow" ? show : {
        closest: () => ({classList: {toggle: (_name: string, value: boolean) => {
            if (value) hidden.add(selector); else hidden.delete(selector);
        }}}),
    }};
    controls.find(item => item.id === "editor.databaseAttrShow").afterMount(root);
    assert.equal(hidden.has("#editor.databaseAttrUseTabs"), true);
    assert.equal(hidden.has("#editor.databaseAttrLayout"), false);
    show.checked = true;
    listeners[0]();
    assert.equal(hidden.size, 0);
});
