import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as sass from "sass";

const browserCases = async (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const queueModule = {exports: {} as any};
    new Function("exports", sources.queue)(queueModule.exports);
    const quotes = {} as typeof import("./agentQuote");
    new Function("exports", "require", sources.quotes)(quotes, () => ({}));
    const dependencies = {
        quotePreview: quotes.quotePreview,
        module: {exports: undefined as any},
        window: {siyuan: {languages: {
            agentQueuedMessages: "Queued messages (${count})", agentQueueMessage: "Queue message",
            agentSendQueuedMessages: "Send queued messages", agentSend: "Send", cancel: "Cancel",
        }, config: {keymap: {general: {agentSend: {custom: ""}}}}}},
        updateHotkeyAfterTip: () => "",
    };
    new Function(...Object.keys(dependencies), sources.chat)(...Object.values(dependencies));
    for (const mobile of [false, true]) {
        for (const theme of [sources.daylight, sources.midnight]) {
            const style = document.createElement("style");
            style.textContent = theme + (mobile ? sources.mobileCSS : sources.desktopCSS);
            document.head.append(style);
            const chat = new dependencies.module.exports();
            const container = document.createElement("div");
            container.style.width = "300px";
            container.style.fontSize = "32px";
            document.body.append(container);
            const queueElement = document.createElement("div");
            queueElement.className = "agent-chat__queue";
            container.append(queueElement);
            let running = true;
            let local = true;
            let resumed = false;
            Object.assign(chat, {
                host: {mobile}, sessionId: "first", queueElement,
                queuedMessages: new queueModule.exports.AgentMessageQueue(),
                composerHost: document.createElement("div"), sendBtn: document.createElement("button"),
                imageUploadButton: document.createElement("button"),
                composer: {isUploading: () => false}, hasComposerInput: () => true,
                modelOptions: [{id: "model"}], isCurrentSessionRunning: () => running,
                sessionRuns: {get: () => local ? {} : undefined},
                sendQueuedMessage: (resume: boolean) => { resumed = resume; },
            });
            for (let index = 0; index < 20; index++) {
                chat.queuedMessages.add("first", {id: String(index), sessionID: "first",
                    data: index === 0 ? {text: "Reply to ⟦quote⟧", references: [{id: "quote", messageID: "previous", title: "<img src=x onerror=alert(1)>"}]} :
                        {text: "Long queued message ".repeat(20)}});
            }
            chat.updateSendButtonState();
            check.equal(chat.composerHost.classList.contains("agent-chat__composer-host--disabled"), false);
            check.equal(chat.sendBtn.disabled, false);
            check.equal(chat.sendBtn.getAttribute("aria-label"), "Queue message");
            check.equal(queueElement.querySelector("button").disabled, true);
            check.equal(queueElement.querySelector("img"), null);
            check.equal(queueElement.querySelector(".b3-list-item__text").textContent, "Reply to “<img src=x onerror=alert(1)>”");
            check.ok(queueElement.scrollHeight > queueElement.clientHeight);
            check.ok(queueElement.scrollWidth <= queueElement.clientWidth + 1);
            const firstRow = queueElement.children[1];
            chat.updateSendButtonState();
            check.equal(queueElement.children[1], firstRow);
            (firstRow.querySelector("button") as HTMLButtonElement).click();
            check.equal(chat.queuedMessages.get("first").length, 19);
            local = false;
            chat.updateSendButtonState();
            check.equal(chat.sendBtn.disabled, true);
            check.equal(chat.composerHost.classList.contains("agent-chat__composer-host--disabled"), false);
            running = false;
            chat.updateSendButtonState();
            (queueElement.querySelector("button") as HTMLButtonElement).click();
            check.equal(resumed, true);
            chat.modelOptions = [];
            chat.updateSendButtonState();
            check.equal(chat.composerHost.classList.contains("agent-chat__composer-host--disabled"), true);
            style.remove();
            container.remove();
        }
    }
    return "Queue DOM cases passed";
};

test("queued-message controls preserve drafts, cancellation and narrow desktop/mobile layouts", {timeout: 30000}, async () => {
    const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
        ScriptTarget.Latest, true);
    const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "AgentChat");
    assert.ok(declaration && isClassDeclaration(declaration));
    const names = new Set(["renderQueuedMessages", "updateSendButtonState"]);
    const methods = declaration.members.filter(item => names.has(item.name?.getText(source))).map(item => item.getText(source));
    assert.equal(methods.length, names.size);
    const compile = (content: string) => transpileModule(content, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const sources = {
        chat: compile(`class Chat { ${methods.join("\n")} } module.exports = Chat;`),
        queue: compile(readFileSync("src/layout/dock/agent/AgentMessageQueue.ts", "utf8")),
        quotes: compile(readFileSync("src/layout/dock/agent/agentQuote.ts", "utf8")),
        desktopCSS: sass.compile("src/assets/scss/base.scss", {logger: sass.Logger.silent}).css,
        mobileCSS: sass.compile("src/assets/scss/mobile.scss", {logger: sass.Logger.silent}).css,
        daylight: readFileSync("appearance/themes/daylight/theme.css", "utf8"),
        midnight: readFileSync("appearance/themes/midnight/theme.css", "utf8"),
    };
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-agent-queue-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(sources) + ").catch(error => { throw new Error(error.stack); })")}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache")};
    delete env.ELECTRON_RUN_AS_NODE;
    const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
        ? ["--ozone-platform=headless", script] : [script];
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Queue DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-agent-queue-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
