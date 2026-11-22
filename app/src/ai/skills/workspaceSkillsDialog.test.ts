import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {escapeHtml} from "../../util/escape";

test("the desktop workspace skills dialog keeps its native header and discard guard", async () => {
    const source = readFileSync("src/ai/skills/manager.ts", "utf8");
    const code = source.slice(source.indexOf("    const dialog = mobile ?"), source.indexOf("    const run = async"));
    const control = {addEventListener() {}, classList: {toggle() {}}, setAttribute() {}};
    const root = {querySelector: () => control, querySelectorAll: (): never[] => []};
    const element = {querySelector: () => root};
    let markup = "";
    let destroyed = 0;
    let confirms = 0;
    let discard = false;
    const state = {dirty: true, path: "", text: "draft"};
    const context = {
        Dialog: class {
            public element = element;
            constructor(options: {title: string}) { markup = options.title; }
            public destroy() { destroyed++; }
        },
        lang: {agentWorkspaceSkills: "Workspace skills & files", agentSkillManager: "Skill manager", back: 'Go "back"'},
        content: "", onDestroy() {}, window: {addEventListener() {}}, escapeHtml, mobile: false,
        state, busy: false, closed: false, confirming: false, prompting: false,
        selected: undefined as undefined, localFiles: false,
        confirmSkillAction: async () => { confirms++; return discard; },
    };
    const dialog = runInNewContext(transpileModule(code + "\ndialog;", {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText, context) as {destroy: () => void};
    assert.equal(markup, "Workspace skills &amp; files");

    dialog.destroy();
    dialog.destroy();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirms, 1);
    assert.equal(destroyed, 0);
    assert.equal(state.text, "draft");
    discard = true;
    dialog.destroy();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirms, 2);
    assert.equal(destroyed, 1);
});
