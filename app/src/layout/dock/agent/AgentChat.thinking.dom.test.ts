import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const noop = () => {};
    const escapeHtml = (value: string) => {
        const span = document.createElement("span");
        span.textContent = value;
        return span.innerHTML;
    };
    const load = (source: string) => {
        const module = {exports: {} as Record<string, any>};
        new Function("require", "module", "exports", source)(() => ({escapeHtml}), module, module.exports);
        return module.exports;
    };
    const history = load(sources.history);
    const renderer = load(sources.renderer);
    const thinking = load(sources.thinking);
    let id = 0;
    const timers: Array<() => void> = [];
    const dependencies = {
        module: {exports: undefined as any},
        window: {siyuan: {languages: {}}, setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; }},
        SessionStore: {newSessionId: () => `entry-${++id}`},
        escapeHtml,
        renderToolsLineHTML: renderer.renderToolsLineHTML,
        getAgentThinkingToolGroups: history.getAgentThinkingToolGroups,
        hasAgentThinkingStepDetails: history.hasAgentThinkingStepDetails,
        updateThinkingBody: thinking.updateThinkingBody,
        bindThinkingCardToggle: thinking.bindThinkingCardToggle,
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: noop,
        postRender: noop,
        console: {error: (...args: unknown[]) => { throw new Error(args.join(" ")); }},
    };
    new Function(...Object.keys(dependencies), sources.chat)(...Object.values(dependencies));
    const createChat = (mobile = false) => {
        const chat = new dependencies.module.exports();
        const container = document.createElement("div");
        document.body.appendChild(container);
        Object.assign(chat, {
            messagesContainer: container,
            host: {mobile},
            sessionId: "first",
            currentThinkingText: "",
            currentThinkingReasoning: "",
            currentThinkingReasoningContent: "",
            currentThinkingSteps: [],
            currentThinkingEntryId: "",
            currentThinkingDuration: 0,
            currentRoundID: "",
            currentToolCalls: [],
            renderedToolCalls: new WeakMap(),
            currentToolLine: null,
            lastStepToolCount: 0,
            entries: [],
            pendingConfirms: [],
            pendingReasoningUpdate: false,
            requestStartTime: 0,
            hasInterveningCard: false,
            lute: {ProtylePreviewStr: (_: string, text: string) => escapeHtml(text)},
            insertBeforeAI: (el: Element) => chat.messagesContainer.appendChild(el),
            scrollToBottom: noop,
            observeStickTarget: noop,
            anchorThinkingCard: noop,
            startThinkingTimer: noop,
            finishVisibleRound: noop,
            formatThinkingHeader: () => "Thought",
            appendToolResult: noop,
            appendConfirm: noop,
            flushTokenUpdate: noop,
            cancelTokenUpdate: noop,
            applyPermissionMode: noop,
            updateTokenDisplay: noop,
            rebuildNavMarkers: noop,
            slimToolCallsForPersistence: (calls: unknown[]) => calls,
        });
        return chat;
    };
    const call = (chat: any, callID: string | undefined, name = "block") =>
        chat.handleSSEEvent({type: "tool_call", callID, name, arguments: {}});
    const result = (chat: any, callID: string | undefined, name = "block") =>
        chat.handleSSEEvent({type: "tool_result", callID, name, result: "done"});
    const chips = (chat: any): HTMLElement[] => Array.from(chat.messagesContainer.querySelectorAll(".agent-chat__thinking-tool"));
    const shape = (body: Element) => Array.from(body.children).map(element =>
        element.classList.contains("agent-chat__thinking-tools-line")
            ? Array.from(element.querySelectorAll(".agent-chat__thinking-tool")).map(chip => chip.textContent)
            : element.textContent);
    const compareReload = (chat: any) => {
        chat.flushReasoningUpdate();
        chat.collectCurrentThinkingStep();
        const live = Array.from(chat.messagesContainer.querySelectorAll(".agent-chat__thinking-body")).map(shape);
        const reloaded = createChat(chat.host.mobile);
        for (const entry of chat.entries) {
            if (entry.type === "thinking") {
                reloaded.renderMergedThinkingCard(entry.steps);
            }
        }
        reloaded.renderMergedThinkingCard(chat.currentThinkingSteps);
        const saved = Array.from(reloaded.messagesContainer.querySelectorAll(".agent-chat__thinking-body")).map(shape);
        check.deepEqual(live, saved, "live and reloaded thinking details must match");
        return live;
    };

    for (const mobile of [false, true]) {
        const chat = createChat(mobile);
        chat.appendThinking("processing", "round-1");
        await call(chat, "a");
        await call(chat, "b");
        chat.appendThinking("processing", "round-2");
        await call(chat, "c", "search");
        check.deepEqual(compareReload(chat), [[["block", "block"], ["search"]]]);

        const reasoned = createChat(mobile);
        reasoned.appendThinking("processing", "round-1");
        reasoned.appendReasoning("Inspect <first>");
        await call(reasoned, "a");
        await call(reasoned, "b");
        reasoned.appendThinking("processing", "round-2");
        reasoned.appendReasoning("Inspect second");
        await call(reasoned, "c", "search");
        check.deepEqual(compareReload(reasoned), [["Inspect <first>", ["block", "block"], "Inspect second", ["search"]]]);

        const interrupted = createChat(mobile);
        interrupted.appendThinking("processing", "round-1");
        await call(interrupted, "a");
        interrupted.hasInterveningCard = true;
        interrupted.appendThinking("processing", "round-2");
        await call(interrupted, "b");
        check.deepEqual(compareReload(interrupted), [[["block"]], [["block"]]]);
    }

    const concurrent = createChat();
    concurrent.appendThinking("processing", "round-1");
    await call(concurrent, "a");
    await call(concurrent, "b");
    const [first, second] = chips(concurrent);
    await result(concurrent, "b");
    timers.splice(0).forEach(callback => callback());
    check.equal(first.classList.contains("agent-chat__thinking-tool--running"), true);
    check.equal(second.classList.contains("agent-chat__thinking-tool--running"), false);
    await result(concurrent, "a");
    const originalState = concurrent.captureRunViewState();
    concurrent.captureRunView(originalState);
    concurrent.sessionId = "second";
    concurrent.renderedToolCalls = new WeakMap();
    concurrent.currentToolLine = null;
    concurrent.currentToolCalls = [];
    concurrent.currentThinkingText = "";
    concurrent.appendThinking("processing", "other-round");
    await call(concurrent, "a");
    timers.splice(0).forEach(callback => callback());
    check.equal(first.classList.contains("agent-chat__thinking-tool--running"), false);
    check.equal(chips(concurrent)[0].classList.contains("agent-chat__thinking-tool--running"), true);
    concurrent.sessionId = "first";
    concurrent.restoreRunView(originalState, noop);
    await call(concurrent, "c");
    check.deepEqual(compareReload(concurrent), [[["block", "block", "block"]]]);

    const legacy = createChat();
    legacy.appendThinking("processing", "");
    await call(legacy, undefined);
    await call(legacy, undefined);
    await legacy.handleSSEEvent({type: "confirm", name: "block", arguments: {}, confirmID: "confirm"});
    check.equal(chips(legacy)[0].classList.contains("agent-chat__thinking-tool--running"), true);
    check.equal(chips(legacy)[1].classList.contains("agent-chat__thinking-tool--running"), false);
    await result(legacy, undefined);
    timers.splice(0).forEach(callback => callback());
    check.equal(chips(legacy)[0].classList.contains("agent-chat__thinking-tool--running"), false);
    legacy.appendThinking("processing", "");
    await call(legacy, undefined);
    check.deepEqual(compareReload(legacy), [[["block", "block"], ["block"]]]);

    const active = createChat();
    active.appendThinking("processing", "round");
    const stale = active.messagesContainer.firstElementChild.cloneNode(true);
    active.messagesContainer.prepend(stale);
    active.appendReasoning("latest only");
    active.flushReasoningUpdate();
    await call(active, "a");
    check.equal(stale.querySelector(".agent-chat__thinking-body").textContent, "");
    check.deepEqual(shape(active.messagesContainer.lastElementChild.querySelector(".agent-chat__thinking-body")),
        ["latest only", ["block"]]);
    return "Thinking card DOM cases passed";
};

test("thinking tools preserve round grouping, duplicate calls and running state in desktop and mobile views", {
    timeout: 30000,
}, async () => {
    const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
        ScriptTarget.Latest, true);
    const declaration = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "AgentChat");
    assert.ok(declaration && isClassDeclaration(declaration));
    const names = new Set(["handleSSEEvent", "getActiveThinkingCard", "appendToolCall", "setToolCallRunning",
        "finishToolCall", "appendThinking", "appendReasoning", "flushReasoningUpdate", "collectCurrentThinkingStep",
        "renderMergedThinkingCard", "captureRunViewState", "captureRunView", "restoreRunView"]);
    const methods = declaration.members.filter(item => names.has(item.name?.getText(source))).map(item => item.getText(source));
    assert.equal(methods.length, names.size);
    const compile = (content: string) => transpileModule(content, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const sources = {
        chat: compile(`class Chat { ${methods.join("\n")} } module.exports = Chat;`),
        history: compile(readFileSync("src/layout/dock/agent/AgentHistory.ts", "utf8")),
        renderer: compile(readFileSync("src/layout/dock/agent/AgentMessageRenderer.ts", "utf8")),
        thinking: compile(readFileSync("src/ai/thinkingCard.ts", "utf8")),
    };
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-thinking-tools-test-"));
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
        assert.match(result.stdout, /Thinking card DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-thinking-tools-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
