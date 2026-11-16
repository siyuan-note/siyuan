import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import * as sass from "sass";

const browserCases = async (chatSource: string, styles: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    const exported = {Chat: undefined as any};
    new Function("exported", chatSource)(exported);
    for (const css of styles) {
        const style = document.createElement("style"); style.textContent = css; document.head.append(style);
        for (const kind of ["confirm", "question"]) {
            const container = document.createElement("div");
            container.style.cssText = "height:160px;overflow:auto";
            document.body.append(container);
            const draft = document.createElement("input"); draft.value = "Unsent draft"; container.append(draft);
            const card = document.createElement("div");
            card.className = `agent-chat__msg agent-chat__msg--${kind}`;
            card.innerHTML = `<div class="agent-chat__${kind}-card"><button>Approve</button></div>`;
            container.append(card);
            let approvals = 0, scrolls = 0;
            card.querySelector("button").addEventListener("click", () => { approvals++; });
            const scroll = card.scrollIntoView.bind(card);
            card.scrollIntoView = options => { scrolls++; scroll(options); };
            const chat = Object.assign(new exported.Chat(), {
                programmaticScrollGeneration: 0,
                beginProgrammaticScroll: () => ++chat.programmaticScrollGeneration,
                finishProgrammaticScroll: () => {},
            });
            draft.focus();
            chat.highlightNotificationCard(card);
            check.equal(document.activeElement, card);
            check.equal(draft.value, "Unsent draft");
            check.equal(approvals, 0);
            check.equal(getComputedStyle(card.firstElementChild).animationName, "agent-msg-jump");
            requestAnimationFrame(() => { chat.programmaticScrollGeneration++; });
            await new Promise(resolve => setTimeout(resolve, 100));
            check.ok(scrolls > 0, "navigation supersedes dock restoration after layout settles");
            chat.programmaticScrollGeneration++;
            const before = scrolls;
            await new Promise(resolve => setTimeout(resolve, 80));
            check.equal(scrolls, before, "user scrolling cancels target anchoring");
            check.equal(approvals, 0);
            container.remove();
        }
        style.remove();
    }
    return "Notification focus DOM cases passed";
};

test("notification targets focus and highlight cards without submitting drafts or approvals", {timeout: 30000}, async () => {
    const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"), ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => isClassDeclaration(node) && node.name?.text === "AgentChat");
    assert.ok(declaration && isClassDeclaration(declaration));
    const method = declaration.members.find(node => node.name?.getText(source) === "highlightNotificationCard");
    assert.ok(method);
    const chat = transpileModule(`class Chat { ${method.getText(source)} } exported.Chat = Chat;`, {
        compilerOptions: {target: ScriptTarget.ES2022},
    }).outputText;
    const css = sass.compile("src/assets/scss/base.scss", {logger: sass.Logger.silent}).css;
    const styles = ["daylight", "midnight"].map(theme => readFileSync(`appearance/themes/${theme}/theme.css`, "utf8") + css);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-agent-notification-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(chat) + "," + JSON.stringify(styles) + ")")}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache")};
    delete env.ELECTRON_RUN_AS_NODE;
    const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
        ["--ozone-platform=headless", script] : [script];
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, args, {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Notification focus DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-agent-notification-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
