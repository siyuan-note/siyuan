import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {escapeHtml, escapeHtmlTextAndAttr} from "../../util/escape";

test("the desktop workspace skills header closes through the discard guard", async () => {
    const source = readFileSync("src/ai/skills/manager.ts", "utf8");
    const code = source.slice(source.indexOf("    const dialog = mobile ?"), source.indexOf("    const run = async"));
    const listeners = new Map<string, (event?: Event) => void>();
    const attributes = new Map<string, string>();
    const control = {addEventListener() {}, classList: {toggle() {}}, setAttribute() {}};
    const root = {querySelector: () => control, querySelectorAll: (): never[] => []};
    const title = {id: "", closest: (selector: string) => selector === ".b3-dialog__header" ? {id: "dialog-title-1"} :
        {setAttribute: (name: string, value: string) => attributes.set(name, value)}};
    const back = {addEventListener: (name: string, listener: (event?: Event) => void) => listeners.set(name, listener)};
    const element = {querySelector: (selector: string) => ({
        ".skill-manager": root, "[data-type=workspace-skills-title]": title, "[data-type=workspace-skills-back]": back,
    })[selector]};
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
        content: "", onDestroy() {}, window: {addEventListener() {}}, escapeHtmlTextAndAttr, escapeHtml, mobile: false,
        state, busy: false, closed: false, confirming: false, prompting: false,
        selected: undefined as undefined, localFiles: false,
        confirmSkillAction: async () => { confirms++; return discard; },
    };
    runInNewContext(transpileModule(code, {compilerOptions: {target: ScriptTarget.ES2020}}).outputText, context);
    assert.match(markup, /<button type="button"[^>]*aria-label="Go &quot;back&quot;"/);
    assert.match(markup, /#iconLeft/);
    assert.match(markup, /Workspace skills &amp; files/);
    assert.doesNotMatch(markup, /Skill manager/);
    assert.equal(attributes.get("aria-labelledby"), title.id);
    assert.equal(title.id, "dialog-title-1-text");
    let reachedDragHandler = true;
    listeners.get("mousedown")({stopPropagation: () => { reachedDragHandler = false; }} as Event);
    assert.equal(reachedDragHandler, false);

    listeners.get("click")();
    listeners.get("click")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirms, 1);
    assert.equal(destroyed, 0);
    assert.equal(state.text, "draft");
    discard = true;
    listeners.get("click")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirms, 2);
    assert.equal(destroyed, 1);
});
