import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ScriptTarget} from "typescript";

test("mobile skill naming awaits an explicit API success without discarding a failed draft", async () => {
    const source = readFileSync("src/ai/skills/manager.ts", "utf8");
    const body = source.slice(source.indexOf("    const inputName ="), source.indexOf("    source.addEventListener", source.indexOf("    const inputName =")));
    let options: {awaitConfirm: boolean; onConfirm: (name: string, dialog: unknown) => Promise<boolean>};
    let succeeds = false;
    let destroyed = 0;
    let reloaded = 0;
    const input = {setCustomValidity() {}, reportValidity() {}, addEventListener() {}};
    const dialog = {element: {querySelector: () => input}, destroy: () => destroyed++};
    const context = {busy: false, closed: false, confirming: false, prompting: false, mobile: true,
        update() {}, selected: {path: "skills/SKILL.md"}, selectedRevision: "revision",
        getSkillDirectory: () => "skills", lang: {}, isMobile: () => true,
        getFileRenameTarget: (_path: string, name: string) => name, isValidSkillName: () => true,
        mobileInputDialog: (value: typeof options) => { options = value; return dialog; },
        api: async () => succeeds ? {} : undefined,
        reload: async () => { reloaded++; }, showMessage() {}, escapeHtml: String,
        inputName: undefined as (action: string) => void};
    runInNewContext(transpileModule(body + "\nthis.inputName = inputName;", {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText, context);
    context.inputName("newFile");
    assert.equal(options.awaitConfirm, true);
    assert.equal(await options.onConfirm("draft.yaml", dialog), false);
    assert.equal(destroyed, 0);
    assert.equal(reloaded, 0);
    succeeds = true;
    assert.equal(await options.onConfirm("draft.yaml", dialog), true);
    assert.equal(destroyed, 0, "the shared pending adapter owns successful close");
    assert.equal(reloaded, 1);
});
