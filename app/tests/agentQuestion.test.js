const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sources = () => {
    const ts = require("typescript");
    return Object.fromEntries([
        "layout/dock/agent/AgentChat",
        "layout/dock/agent/AgentHistory",
        "layout/dock/agent/AgentMessageRenderer",
        "util/escape",
    ].map(name => [name, ts.transpileModule(readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText]));
};

const runCases = async sources => {
    const check = require("node:assert/strict");
    const resolve = require("node:path").posix;
    const cache = {};
    let session;
    const stub = {Model: class {}, SessionStore: {load: async () => session}};
    const load = name => {
        if (!sources[name]) {
            return stub;
        }
        if (!cache[name]) {
            const exports = {};
            cache[name] = exports;
            new Function("exports", "require", sources[name])(exports,
                request => load(resolve.normalize(resolve.join(resolve.dirname(name), request))));
        }
        return cache[name];
    };
    window.siyuan = {languages: {}};
    const {AgentChat} = load("layout/dock/agent/AgentChat");
    const cases = [
        {answers: ["plain answer"], customValue: "plain answer"},
        {answers: ["create a plugin named \"Me\""], customValue: "create a plugin named \"Me\""},
        {answers: ["line1\nline2"], customValue: "line1line2"},
        {answers: ["Option", "C:\\temp\\new"], customValue: "C:\\temp\\new", multiple: true},
        {options: ["C:\\temp\\new"], answers: ["C:\\temp\\new"], customValue: ""},
        {options: ["Use \"Me\" & <tools>"], answers: ["Use \"Me\" & <tools>"], customValue: ""},
        {answers: ["Option", "Other option"], customValue: "", multiple: true},
        {answers: ["Option"], custom: false},
        {answers: undefined, customValue: ""},
    ];
    for (const mobile of [false, true]) {
        for (const sample of cases) {
            const options = sample.options || ["Option", "Other option"];
            session = {id: "session", entries: [
                {id: "before", type: "user", content: "Before question"},
                {id: "question", type: "question", questionID: "question-id",
                    questions: [{question: "Choose", options: options.map(label => ({label})),
                        multiple: sample.multiple, custom: sample.custom}],
                    status: sample.answers ? "submitted" : "pending", answers: sample.answers},
                {id: "after", type: "assistant", content: "After question"},
            ]};
            const original = JSON.stringify(session);
            const chat = Object.create(AgentChat.prototype);
            Object.assign(chat, {
                host: {mobile}, sessionId: session.id, sessionErrors: new Map(),
                messagesContainer: document.createElement("div"),
                isScrolledToBottom: () => true,
            });
            for (const method of ["cancelTokenUpdate", "observeStickTarget", "destroyEditingComposer",
                "updateMetaFromSession", "rebuildNavMarkers", "scrollToBottom", "removeMirrorPlaceholder"]) {
                chat[method] = () => {};
            }
            chat.appendUserMessage = chat.appendPersistedAssistant = (content, timestamp, id) => {
                const el = document.createElement("div");
                el.setAttribute("data-message-id", id);
                el.textContent = content;
                chat.messagesContainer.appendChild(el);
            };
            chat.messagesContainer.textContent = "Previous visible reply";
            for (let reload = 0; reload < 2; reload++) {
                await chat.reloadFromDisk(true);
                check.deepEqual(Array.from(chat.messagesContainer.children, el => el.dataset.messageId),
                    ["before", "question", "after"]);
                check.equal(chat.messagesContainer.lastElementChild.textContent, "After question");
                const card = chat.messagesContainer.querySelector("[data-message-id=question]");
                const inputs = Array.from(card.querySelectorAll("input[type=radio], input[type=checkbox]"));
                check.deepEqual(inputs.map(input => input.value), options);
                check.deepEqual(inputs.map(input => input.checked), options.map(option => !!sample.answers?.includes(option)));
                check.ok(Array.from(card.querySelectorAll("input")).every(input => input.disabled));
                check.equal(card.querySelector(".agent-chat__question-custom")?.value, sample.customValue);
                check.equal(card.querySelector(".agent-chat__confirm-done").textContent,
                    sample.answers ? "Submitted" : "Awaiting answer");
                check.equal(JSON.stringify(session), original);
            }
        }
    }
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        const failure = await win.webContents.executeJavaScript(`Promise.resolve().then(() =>
            (${runCases.toString()})(${JSON.stringify(sources())})).then(() => null, error => error.stack || String(error))`);
        assert.equal(failure, null);
        console.log("Agent question reload cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("reloads desktop and mobile agent questions with literal answers and preserves later messages", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-agent-question-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Agent question reload cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-agent-question-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
