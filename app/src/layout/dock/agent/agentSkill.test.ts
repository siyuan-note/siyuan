import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    window.siyuan = {languages: {emptyContent: "Empty"}, zIndex: 1} as unknown as typeof window.siyuan;
    const requests: Array<(response: {data: Array<{name: string; description: string}>}) => void> = [];
    const insertItems: IHintData[] = [{id: "bold", value: "strong", html: "Bold"}];
    let inserted = "";
    let marked = "";
    const dependencies = {
        hintSlash: () => insertItems,
        fetchPost: (_url: string, _data: unknown, callback: typeof requests[number]) => requests.push(callback),
        escapeHtml: (text: string) => {
            const element = document.createElement("div");
            element.textContent = text;
            return element.innerHTML;
        },
        Constants: {BLOCK_HINT_KEYS: ["((", "[["], INLINE_TYPE: ["strong"], ZWSP: "\u200b"},
        hideElements: () => {}, getUndoFocusContext: (): undefined => undefined, focusByRange: () => {},
        hasClosestBlock: (node: Node) => (node instanceof Element ? node : node.parentElement).closest("[data-node-id]"),
        insertHTML: (html: string) => { inserted = html; },
    };
    const api = new Function(...Object.keys(dependencies), source +
        "\nreturn {hintSkill, mountLiteSlashMenu, normalizeAgentSkills, expandAgentSkillSelection, " +
        "AGENT_SKILL_SELECTOR, Hint, isBuiltinSlashHint};")(...Object.values(dependencies));
    const element = document.createElement("div");
    element.className = "protyle-hint fn__none";
    document.body.appendChild(element);
    const panel = document.createElement("div");
    panel.id = "keyboardToolbar";
    document.body.appendChild(panel);
    const hint = {
        element, source: "hint", enableExtend: true, enableSlash: true, splitChar: "/",
        genHTML: (items: IHintData[], _protyle?: IProtyle, reset = false) => {
            if (reset && items.length === 0) {
                element.classList.add("fn__none");
                return;
            }
            element.innerHTML = api.Hint.prototype.getHTMLByData.call(hint, items);
            element.classList.remove("fn__none");
        },
        genLoading: () => {
            element.textContent = "Loading";
            element.classList.remove("fn__none");
        },
    };
    const editor = document.createElement("div");
    editor.innerHTML = '<div data-node-id="paragraph" data-type="NodeParagraph"><div contenteditable="true">text</div></div>';
    document.body.appendChild(editor);
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector("[contenteditable]"));
    const protyle = {lite: true, hint, wysiwyg: {element: editor},
        toolbar: {range, setInlineMark: (_p: IProtyle, value: string) => { marked = value; }},
        options: {hint: {extend: [{key: "/", hint: api.hintSkill}]}}} as unknown as IProtyle;
    const skills = {data: [{name: "test111", description: "test skill"}]};
    let unmount = api.mountLiteSlashMenu(protyle, panel);
    check.ok(panel.querySelector('[data-id="bold"]'), "insert commands are usable before skills arrive");
    requests.shift()(skills);
    check.equal(panel.querySelectorAll(".keyboard__slash-item").length, 2);
    check.ok(panel.querySelector('[data-id="bold"]'), "skills do not replace insert commands");
    check.equal(panel.querySelector(".keyboard__slash-item").getAttribute("data-id"), "bold");
    const skillValue = decodeURIComponent(panel.querySelector<HTMLElement>('[data-id=""][data-value]').dataset.value);
    check.match(skillValue, /contenteditable="false"/);
    check.equal(api.isBuiltinSlashHint(api.hintSkill, skillValue, protyle), false);
    check.equal(api.isBuiltinSlashHint(api.hintSkill, "strong", protyle), true);
    unmount();
    // 面板先卸载，候选填充随后发生，命令来源仍须保留。
    api.Hint.prototype.fill.call(hint, "strong", protyle, false);
    check.equal(marked, "strong");
    check.equal(inserted, "");
    api.Hint.prototype.fill.call(hint, skillValue, protyle, false);
    check.equal(inserted, skillValue);
    unmount = api.mountLiteSlashMenu(protyle, panel);
    requests.shift()({data: []});
    check.equal(panel.querySelectorAll(".keyboard__slash-item").length, 1);
    unmount();
    unmount = api.mountLiteSlashMenu(protyle, panel);
    unmount();
    requests.shift()(skills);
    check.equal(element.classList.contains("fn__none"), true);
    hint.enableExtend = true;
    api.hintSkill("", protyle);
    requests.shift()(skills);
    check.equal(element.querySelectorAll(".b3-list-item").length, 1);
    check.equal(element.textContent.includes("Bold"), false, "typed slash remains a skill query");
    check.equal(api.isBuiltinSlashHint(api.hintSkill, "strong", protyle), false);

    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetHTMLTag2TextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const prepare = (content = skillValue) => {
        editor.innerHTML = lute.SpinBlockDOM('<div data-node-id="20260921000000-skill01" data-type="NodeParagraph">' +
            '<div contenteditable="true">before ' + content + " after</div></div>");
        api.normalizeAgentSkills(editor);
        const skill = editor.querySelector<HTMLElement>(api.AGENT_SKILL_SELECTOR);
        check.ok(skill, "Lute retains skill identity: " + editor.innerHTML);
        check.equal(skill.contentEditable, "false");
        editor.querySelector<HTMLElement>('[contenteditable="true"]').focus();
        return skill;
    };
    const select = (start: Node, offset: number, end = start, endOffset = offset) => {
        const selection = getSelection();
        const selected = document.createRange();
        selected.setStart(start, offset);
        selected.setEnd(end, endOffset);
        selection.removeAllRanges();
        selection.addRange(selected);
        return selected;
    };
    for (const command of ["delete", "forwardDelete"]) {
        const skill = prepare();
        const index = Array.from(skill.parentNode.childNodes).indexOf(skill);
        select(skill.parentNode, command === "delete" ? index + 1 : index);
        document.execCommand(command);
        check.equal(editor.querySelector(api.AGENT_SKILL_SELECTOR), null, command + " removes the whole skill");
        check.ok(editor.textContent.includes("before"));
        check.ok(editor.textContent.includes("after"));
        document.execCommand("undo");
        api.normalizeAgentSkills(editor);
        check.equal(editor.querySelector(api.AGENT_SKILL_SELECTOR)?.textContent, "test111");
        document.execCommand("redo");
        check.equal(editor.querySelector(api.AGENT_SKILL_SELECTOR), null);
    }
    let skill = prepare(skillValue.replace(' contenteditable="false"', ""));
    const partial = select(skill.firstChild, 2, skill.firstChild, 5);
    api.expandAgentSkillSelection(partial);
    check.equal(partial.toString(), "test111");
    document.execCommand("insertText", false, "replacement");
    check.equal(editor.querySelector(api.AGENT_SKILL_SELECTOR), null);
    check.ok(editor.textContent.includes("replacement"));
    skill = prepare();
    api.expandAgentSkillSelection(select(skill.firstChild, 2));
    document.execCommand("insertText", false, "suffix");
    check.equal(skill.textContent, "test111");
    check.ok(editor.textContent.includes("test111suffix"));
    return "Agent skill cases passed";
};

test("agent mobile commands coexist with skills and skill names remain atomic", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, file), "utf8");
    const composer = createSourceFile("composer.ts", read("AgentComposer.ts"), ScriptTarget.Latest, true);
    const selected = new Set(["skillHintRequestIDs", "skillSlashCommands", "prepareAgentHint", "hintSkill"]);
    const composerSource = composer.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => selected.has(declaration.name.getText(composer))))
        .map(statement => statement.getText(composer)).join("\n");
    const hint = createSourceFile("hint.ts", read("../../../protyle/hint/index.ts"), ScriptTarget.Latest, true);
    const hintSource = hint.statements.find(isClassDeclaration).members.filter(member => isMethodDeclaration(member) &&
        ["fill", "getHTMLByData"].includes(member.name.getText(hint))).map(member => member.getText(hint)).join("\n");
    const source = transpileModule([read("../../../protyle/hint/builtinSlash.ts"),
        read("../../../protyle/hint/blockHintRange.ts"), read("agentHintState.ts"),
        read("agentSkill.ts"), read("../../../mobile/util/liteSlashMenu.ts"), composerSource,
        "class Hint {" + hintSource + "}"].join("\n").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-agent-skill-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(
            ${JSON.stringify(path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js"))}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
            browserCases.toString() + ")(" + JSON.stringify(source) + ")")}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Agent skill cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-agent-skill-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
