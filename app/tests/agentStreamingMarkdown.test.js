const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    return Object.fromEntries([
        "layout/dock/agent/AgentStreamingMarkdown",
        "layout/dock/agent/AgentMarkdownBlocks",
        "layout/dock/agent/AgentMarkdownParser",
        "layout/dock/agent/AgentMarkdownWorker",
        "layout/dock/agent/AgentChat",
        "layout/dock/agent/AgentMessageRenderer",
        "layout/dock/agent/AgentScrollState",
        "layout/dock/agent/AgentReasoning",
        "protyle/render/setLute",
        "protyle/util/inlineElementBoundary",
        "util/escape",
    ].map(name => [name, ts.transpileModule(readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText.replaceAll("import.meta.url", "location.href")]));
};

const runCases = async (sources, css, luteScript) => {
    const check = require("node:assert/strict");
    const resolve = require("node:path").posix;
    const cache = {};
    const counts = {parse: 0, postRender: 0, copy: 0};
    let parsedLength = 0;
    let parserMilliseconds = 0;
    let parseCost = 0;
    let throwParse = false;
    let activeClock;
    let nextID = 0;
    let preference = false;
    const openedLinks = [];
    const stub = {
        Constants: {PROTYLE_CDN: "/stage/protyle", SIYUAN_VERSION: "test"},
        Model: class { connect() {} },
        genUUID: () => String(++nextID),
        AgentSessionRuns: class {},
        SessionStore: {newSessionId: () => String(++nextID)},
        isAgentStreamingMarkdownEnabled: () => preference,
        AGENT_STREAMING_MARKDOWN_CHANGED_EVENT: "agent-streaming-setting-test",
        AGENT_STREAMING_MARKDOWN_KEY: "agent-streaming-setting-test",
        AI_CONFIG_CHANGED_EVENT: "agent-config-test",
        openLink: (_app, href) => openedLinks.push(href),
        processSiYuanUri: (_app, href) => {
            if (href.startsWith("siyuan://")) {
                openedLinks.push(href);
                return true;
            }
            return false;
        },
    };
    const load = name => {
        if (!sources[name]) {
            return stub;
        }
        if (!cache[name]) {
            cache[name] = {};
            new Function("require", "exports", sources[name])(dependency =>
                load(resolve.normalize(resolve.dirname(name) + "/" + dependency)), cache[name]);
        }
        return cache[name];
    };
    const style = document.createElement("style");
    style.textContent = css + ":root { --b3-font-size: 14px; --b3-font-size-editor: 14px; --b3-font-family-protyle: sans-serif; }";
    document.head.appendChild(style);
    const luteModule = load("protyle/render/setLute");
    const createLute = luteModule.getAgentLute;
    const reference = createLute({emojiSite: "/emojis", emojis: {}, sanitize: true});
    luteModule.getAgentLute = options => {
        const lute = createLute(options);
        const parse = lute.ProtylePreviewStr;
        lute.ProtylePreviewStr = (name, text) => {
            counts.parse++;
            parsedLength += text.length;
            activeClock?.spend(parseCost);
            if (throwParse) {
                throw new Error("Preview failed");
            }
            const start = performance.now();
            const result = parse.call(lute, name, text);
            parserMilliseconds += performance.now() - start;
            return result;
        };
        return lute;
    };
    const {AgentStreamingMarkdown, AGENT_MARKDOWN_INTERVAL} =
        load("layout/dock/agent/AgentStreamingMarkdown");
    const {AgentMarkdownParser} = load("layout/dock/agent/AgentMarkdownParser");
    const messages = load("layout/dock/agent/AgentMessageRenderer");
    messages.postRender = () => counts.postRender++;
    const {AgentChat} = load("layout/dock/agent/AgentChat");
    window.siyuan = {languages: {agentChat: "Agent"}, storage: {}};
    for (const method of ["initUI", "bindEvents", "checkConfigChanged"]) {
        AgentChat.prototype[method] = () => {};
    }
    const createClock = () => {
        let now = 0;
        let id = 0;
        const jobs = new Map();
        const clock = {
            jobs,
            now: () => now,
            spend: duration => { now += duration; },
            schedule: (callback, delay) => {
                jobs.set(++id, {callback, due: now + delay});
                return id;
            },
            cancel: id => jobs.delete(id),
            advance: duration => {
                const end = now + duration;
                while (true) {
                    const next = [...jobs].filter(([, job]) => job.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
                    if (!next) {
                        break;
                    }
                    now = Math.max(now, next[1].due);
                    jobs.delete(next[0]);
                    next[1].callback();
                }
                now = Math.max(now, end);
            },
        };
        activeClock = clock;
        return clock;
    };
    const normalize = html => {
        const template = document.createElement("template");
        template.innerHTML = html;
        template.content.querySelectorAll("[id], [updated]").forEach(element => {
            element.removeAttribute("id");
            element.removeAttribute("updated");
        });
        return template.innerHTML;
    };
    const fixture = () => {
        const clock = createClock();
        const body = document.createElement("div");
        body.className = "agent-chat__body b3-typography agent-chat__body--streaming";
        document.body.appendChild(body);
        let updates = 0;
        const renderer = new AgentStreamingMarkdown(body, () => updates++, clock);
        return {clock, body, renderer, get updates() { return updates; }};
    };

    // 实际 Lute 和浏览器 DOM：高频追加不重置定时器，并复用未变化的内容块。
    let f = fixture();
    let content = "# Heading\n\n**Bold** start";
    const startParses = counts.parse;
    f.renderer.update(content);
    f.clock.advance(0);
    check.equal(f.body.querySelector("strong").textContent, "Bold");
    const heading = f.body.querySelector("h1");
    const range = document.createRange();
    range.selectNodeContents(heading);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    for (let i = 0; i < 99; i++) {
        content += "x";
        f.renderer.update(content);
        f.clock.advance(1);
        check.equal(f.clock.jobs.size, 1);
    }
    check.equal(counts.parse - startParses, 1);
    f.clock.advance(1);
    check.equal(counts.parse - startParses, 2);
    check.equal(f.body.querySelector("h1"), heading);
    check.equal(window.getSelection().toString(), "Heading");
    check.equal(f.updates, 2);
    check.match(f.body.textContent.trimEnd(), /x{99}$/);
    window.getSelection().removeAllRanges();
    f.renderer.cancel();

    // 持续流式期间保持 Lute 语法，不以空行切分可能尚未闭合的结构。
    const samples = [
        "# Heading\n\n**bold** and *italic* and ~~deleted~~\n\nEnd",
        "```typescript\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter",
        "````md\n```typescript\nconst a = 1;\n```\n````\n",
        "- one\n  - nested\n\n    continuation\n- two\n\nAfter",
        "> quote\n>\n> - item\n>   continuation\n\nAfter",
        "[link](https://example.com/a_(b)) and ![image](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\n",
        "中文 **粗体** 😀\r\n\r\n第二段",
    ];
    for (const sample of samples) {
        f = fixture();
        for (let i = 1; i <= sample.length; i++) {
            const partial = sample.slice(0, i);
            f.renderer.update(partial);
            f.clock.advance(AGENT_MARKDOWN_INTERVAL);
            check.equal(normalize(f.body.innerHTML), normalize(reference.ProtylePreviewStr("", partial)), partial);
        }
        f.renderer.cancel();
    }
    f = fixture();
    content = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    for (let i = 1; i <= content.length; i++) {
        f.renderer.update(content.slice(0, i));
        f.clock.advance(AGENT_MARKDOWN_INTERVAL);
    }
    check.equal(f.body.querySelectorAll(".table > div > table tbody tr").length, 1);
    check.equal(f.body.querySelector("td").textContent, "1");
    f.renderer.cancel();

    // 重型渲染占位显示源码，流式期不运行代码高亮、公式和图表。
    f = fixture();
    f.renderer.update("$$\nx^2\n$$\n\nInline $a$\n\n```mermaid\ngraph LR; A-->B;\n```\n");
    f.clock.advance(0);
    check.match(f.body.textContent, /x\^2/);
    check.match(f.body.textContent, /graph LR; A-->B;/);
    check.equal(f.body.querySelector("[spin], [data-subtype=math], [data-subtype=mermaid]"), null);
    check.equal(counts.postRender, 0);

    // 未完成 HTML 和 URL 不应在生成过程中变成可执行属性。
    f = fixture();
    content = '<img src="x" onerror="window.__agentUnsafe=1">\n\n[bad](javascript:alert(1))\n\n<script>window.__agentUnsafe=1</script>';
    for (let i = 1; i <= content.length; i++) {
        f.renderer.update(content.slice(0, i));
        f.clock.advance(AGENT_MARKDOWN_INTERVAL);
        check.equal(f.body.querySelector("script, [onerror], [onload], a[href^='javascript:']"), null);
    }
    check.equal(window.__agentUnsafe, undefined);

    f = fixture();
    let navigations = 0;
    messages.bindAgentMessageEvents(f.body, {}, () => navigations++);
    messages.bindAgentMessageEvents(f.body, {}, () => navigations++);
    f.renderer.update("[external](https://example.com) [internal](siyuan://blocks/20240101000000-abcdefg)");
    f.clock.advance(0);
    for (const link of f.body.querySelectorAll("a")) {
        const click = new MouseEvent("click", {bubbles: true, cancelable: true});
        link.dispatchEvent(click);
        check.equal(click.defaultPrevented, true);
    }
    check.equal(navigations, 2);
    check.deepEqual(openedLinks, ["https://example.com", "siyuan://blocks/20240101000000-abcdefg"]);

    // 长回复缓存完成的段落组；后续只解析尾部，仍然显示格式而不是切回源码。
    f = fixture();
    const prefix = "# Keep\n\n" + "Done **bold** paragraph\n\n".repeat(120);
    f.renderer.update(prefix);
    f.clock.advance(2000);
    const kept = f.body.querySelector("h1");
    const beforeLongLength = parsedLength;
    const tail = "Next **formatted** paragraph\n\n".repeat(1800);
    f.renderer.update(prefix + tail);
    f.clock.advance(5000);
    check.equal(f.body.querySelector("h1"), kept);
    check.equal(f.body.querySelectorAll("strong").length, 1920);
    check.equal(normalize(f.body.innerHTML), normalize(reference.ProtylePreviewStr("", prefix + tail)));
    check.ok(parsedLength - beforeLongLength < tail.length + 4096);
    const first = f.body.firstChild;
    first.isEqualNode = () => { throw new Error("Committed DOM must not be traversed"); };
    const beforeSuffix = parsedLength;
    f.renderer.update(prefix + tail + "**last**");
    f.clock.advance(2000);
    check.match(f.body.textContent.trimEnd(), /last$/);
    check.ok(parsedLength - beforeSuffix < 4096);
    f.renderer.cancel();

    // 超预算只降低刷新频率，后续输入依然解析并格式化。
    for (const cost of [20, 60]) {
        f = fixture();
        parseCost = cost;
        const before = counts.parse;
        f.renderer.update("**one**");
        f.clock.advance(0);
        f.renderer.update("**one** two");
        f.clock.advance(99);
        check.equal(counts.parse, before + 1);
        f.clock.advance(500);
        f.renderer.update("**one** two three");
        f.clock.advance(500);
        check.equal(counts.parse - before, 3);
        check.match(f.body.textContent.trimEnd(), /three$/);
        check.equal(f.body.querySelector("strong").textContent, "one");
    }
    parseCost = 0;
    f = fixture();
    f.renderer.update("**kept**");
    f.clock.advance(0);
    throwParse = true;
    f.renderer.update("**kept** **failed**");
    f.clock.advance(AGENT_MARKDOWN_INTERVAL);
    throwParse = false;
    check.equal(f.body.textContent.trim(), "kept");
    const beforeFailure = counts.parse;
    f.clock.advance(5000);
    check.equal(counts.parse, beforeFailure);
    f.renderer.update("**kept** **failed** continues");
    f.clock.advance(1000);
    check.equal(counts.parse, beforeFailure + 1);
    check.equal(f.body.querySelectorAll("strong").length, 2);

    f = fixture();
    const manyNodes = "x\n\n".repeat(4500);
    f.renderer.update(manyNodes);
    f.clock.advance(2000);
    check.equal(f.body.querySelectorAll("p").length, 4500);
    f = fixture();
    const denseNodes = "**x** ".repeat(2100);
    f.renderer.update(denseNodes);
    f.clock.advance(0);
    check.equal(f.body.querySelectorAll("strong").length, 2100);

    // flush 不额外解析，cancel 使已经排队的旧回调失效。
    f = fixture();
    const beforeFlush = counts.parse;
    f.renderer.update("**pending**");
    const stale = [...f.clock.jobs.values()][0].callback;
    f.renderer.flush();
    check.equal(f.body.textContent, "");
    stale();
    check.equal(counts.parse, beforeFlush);
    check.equal(f.updates, 0);
    check.equal(f.clock.jobs.size, 0);

    // AgentChat 集成：沿用真实方法，隔离网络、编辑器与持久化，验证默认关闭及所有收尾路径。
    const chatFixture = enabled => {
        preference = enabled;
        const chat = new AgentChat({}, {element: document.createElement("div")});
        chat.settingDialogObserver.disconnect();
        const messages = document.createElement("div");
        document.body.appendChild(messages);
        Object.assign(chat, {
            host: {}, entries: [], currentAIElement: null, currentContent: "", fullContent: "",
            currentToolCalls: [], currentThinkingSteps: [], pendingConfirms: [], renderedToolNames: {},
            currentThinkingText: "", currentThinkingEntryId: "", currentAssistantEntryId: "", currentRoundID: "",
            sessionId: "session", sessionRuns: {get: () => undefined}, sessionErrors: new Map(),
            messagesContainer: messages, streamingMarkdownEnabled: enabled, layoutVisible: true,
            lute: reference, userScrolledUp: true, requestStartTime: 0,
            scrollCalls: [], updateTokenDisplay: () => {}, rebuildNavMarkers: () => {},
            finishActiveThinking: () => {}, flushThinkingStep: () => {}, clearThinking: () => {},
            observeStickTarget: () => {}, updateRegenerateButtons: () => {}, updateHostRunStatus: () => {},
            updateSendButtonState: () => {}, applyPermissionMode: () => {}, recoverInterruptedTurn: async () => {},
            saveSession: async () => undefined, reloadFromDisk: async () => {},
            sendBtn: document.createElement("button"), stopBtn: document.createElement("button"),
            addCopyButton: () => counts.copy++,
            scrollToBottom: function (force = false) { this.scrollCalls.push(force); },
        });
        return chat;
    };
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    const chatOff = chatFixture(false);
    const beforeOff = counts.parse;
    chatOff.appendToken("# Heading\n\n**text**");
    chatOff.flushTokenUpdate();
    check.equal(chatOff.currentAIElement.querySelector(".agent-chat__body").textContent, chatOff.currentContent);
    check.equal(chatOff.currentAIElement.querySelector("strong"), null);
    check.equal(counts.parse, beforeOff);
    check.equal(chatOff.streamingMarkdown, undefined);

    // 开关在生成过程中生效：关闭时立即显示原文，旧计时器不能把 Markdown 写回来。
    const toggling = chatFixture(true);
    toggling.appendToken("**enabled**");
    await tick();
    check.equal(toggling.currentAIElement.querySelector("strong").textContent, "enabled");
    toggling.appendToken(" pending");
    preference = false;
    toggling.checkStreamingMarkdownChanged();
    await tick();
    const toggleBody = toggling.currentAIElement.querySelector(".agent-chat__body");
    check.equal(toggleBody.textContent, "**enabled** pending");
    check.equal(toggleBody.querySelector("strong"), null);
    preference = true;
    toggling.checkStreamingMarkdownChanged();
    await tick();
    check.equal(toggleBody.querySelector("strong").textContent, "enabled");
    toggling.cancelTokenUpdate();

    for (const finish of ["done", "stop", "error", "config", "round"]) {
        const chat = chatFixture(true);
        const beforePost = counts.postRender;
        const message = "# Title\n\n**complete**\n\n```ts\nconst n = 1;";
        chat.appendToken(message);
        await tick();
        check.equal(chat.currentAIElement.querySelector("strong").textContent, "complete");
        check.equal(counts.postRender, beforePost);
        const element = chat.currentAIElement;
        chat.appendToken("\n```\n\nDone");
        const finalContent = chat.currentContent;
        const parses = counts.parse;
        if (finish === "done") {
            await chat.finishResponse(false);
        } else if (finish === "stop") {
            await chat.stopGeneration();
        } else if (finish === "round") {
            chat.finishVisibleRound();
        } else if (finish === "config") {
            await chat.appendConfigurableError("Configuration error");
        } else {
            chat.appendError("Interrupted");
        }
        await tick();
        const body = element.querySelector(".agent-chat__body");
        check.equal(normalize(body.innerHTML), normalize(reference.ProtylePreviewStr("", finalContent)), finish);
        check.equal(body.classList.contains("agent-chat__body--streaming"), false);
        check.equal(body.classList.contains("agent-chat__body--streaming-markdown"), false);
        check.equal(counts.postRender, beforePost + 1);
        check.equal(counts.parse, parses);
        check.equal(chat.streamingMarkdown, undefined);
        if (finish !== "error" && finish !== "config") {
            check.equal(chat.scrollCalls.some(Boolean), false);
        }
    }

    const longChat = chatFixture(true);
    const longMessage = "# Final\n\n" + "long paragraph ".repeat(2400) + "\n\n**Last**";
    longChat.appendToken(longMessage);
    await tick();
    const longBody = longChat.currentAIElement.querySelector(".agent-chat__body");
    check.equal(longBody.querySelector("h1").textContent, "Final");
    check.equal(longBody.querySelector("strong").textContent, "Last");
    await longChat.finishResponse(false);
    check.equal(normalize(longBody.innerHTML), normalize(reference.ProtylePreviewStr("", longMessage)));
    check.equal(longBody.querySelector("strong").textContent, "Last");

    const switching = chatFixture(true);
    const run = {};
    switching.appendToken("# First\n\n**partial**");
    switching.prepareSessionRunForDetach(run);
    switching.captureSessionRunView(run);
    const firstBody = run.viewState.currentAIElement.querySelector(".agent-chat__body");
    switching.currentAIElement = null;
    switching.currentContent = "";
    switching.appendToken("# Second");
    await tick();
    check.match(switching.messagesContainer.textContent, /Second/);
    check.doesNotMatch(firstBody.textContent, /Second/);
    switching.restoreSessionRunState(run);
    switching.appendToken(" more");
    await tick();
    check.match(switching.messagesContainer.textContent, /partial more/);
    check.doesNotMatch(switching.messagesContainer.textContent, /Second/);
    switching.cancelTokenUpdate();

    const hidden = chatFixture(true);
    hidden.layoutVisible = false;
    const beforeHidden = counts.parse;
    hidden.appendToken("**hidden**");
    await tick();
    check.equal(counts.parse, beforeHidden);
    hidden.layoutVisible = true;
    hidden.updateStreamingMarkdown(hidden.currentAIElement.querySelector(".agent-chat__body"));
    await tick();
    check.equal(hidden.currentAIElement.querySelector("strong").textContent, "hidden");
    hidden.cancelTokenUpdate();

    // 刷新只允许贴底状态跟随新内容，手动上滚时不排队写入滚动位置。
    const scrolled = chatFixture(true);
    let requestedScrolls = 0;
    scrolled.beginProgrammaticScroll = () => ++requestedScrolls;
    scrolled.finishProgrammaticScroll = () => {};
    scrolled.scrollToBottom = AgentChat.prototype.scrollToBottom;
    scrolled.scrollToBottom();
    check.equal(requestedScrolls, 0);
    scrolled.userScrolledUp = false;
    scrolled.scrollToBottom();
    check.equal(requestedScrolls, 1);

    // 真实解析、DOM 写入和布局采样；先清理其他夹具，避免把整页历史测试的排版计入当前消息。
    document.body.replaceChildren();
    const block = "# Section\n\n**bold** and *italic* with `code`\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n\n";
    f = fixture();
    f.body.style.cssText = "width: 420px; font: 14px/1.6 sans-serif";
    const output = block.repeat(Math.ceil(100000 / block.length)).slice(0, 100000);
    const times = [];
    const parseTimes = [];
    const layoutTimes = [];
    const beforeBench = counts.parse;
    const beforeLength = parsedLength;
    const parserStart = parserMilliseconds;
    const observer = new MutationObserver(() => {});
    observer.observe(f.body, {childList: true});
    let insertions = 0;
    for (let end = 16; end <= output.length + 15; end += 16) {
        f.renderer.update(output.slice(0, Math.min(end, output.length)));
        const start = performance.now();
        const before = counts.parse;
        f.clock.advance(2);
        if (counts.parse !== before) {
            parseTimes.push(performance.now() - start);
            const layoutStart = performance.now();
            void f.body.offsetHeight;
            layoutTimes.push(performance.now() - layoutStart);
            times.push(performance.now() - start);
        }
        insertions += observer.takeRecords().reduce((sum, record) => sum + record.addedNodes.length, 0);
    }
    f.clock.advance(1000);
    observer.disconnect();
    check.ok(counts.parse - beforeBench < 250);
    check.ok(parsedLength - beforeLength < output.length * 4);
    check.equal(normalize(f.body.innerHTML), normalize(reference.ProtylePreviewStr("", output)));
    check.equal(f.body.querySelector(".agent-chat__streaming-tail"), null);
    check.equal(f.clock.jobs.size, 0);
    times.sort((a, b) => a - b);
    parseTimes.sort((a, b) => a - b);
    layoutTimes.sort((a, b) => a - b);
    const benchmark = {
        characters: output.length, chunks: Math.ceil(output.length / 16),
        parses: counts.parse - beforeBench, parsedCharacters: parsedLength - beforeLength,
        topLevelInsertions: insertions, medianMs: times[Math.floor(times.length / 2)],
        p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times[times.length - 1],
        renderP95Ms: parseTimes[Math.floor(parseTimes.length * 0.95)],
        extraLayoutP95Ms: layoutTimes[Math.floor(layoutTimes.length * 0.95)],
        parserTotalMs: parserMilliseconds - parserStart,
        renderTotalMs: times.reduce((sum, value) => sum + value, 0),
    };
    f.renderer.cancel();

    // 真实时间预算下测同一份 10 万字符输出，持续格式化，不断言机器相关耗时。
    f.body.remove();
    const body = document.createElement("div");
    body.className = "agent-chat__body b3-typography agent-chat__body--streaming";
    body.style.width = "420px";
    document.body.appendChild(body);
    const clock = createClock();
    clock.now = () => performance.now();
    const measured = new AgentStreamingMarkdown(body, () => {}, clock);
    const adaptiveTimes = [];
    const beforeAdaptive = counts.parse;
    for (let end = 800; end <= output.length; end += 800) {
        measured.update(output.slice(0, end));
        const before = counts.parse;
        const start = performance.now();
        clock.advance(1000);
        if (counts.parse !== before) {
            adaptiveTimes.push(performance.now() - start);
        }
        check.equal(body.querySelector(".agent-chat__streaming-tail"), null);
    }
    check.equal(clock.jobs.size, 0);
    adaptiveTimes.sort((a, b) => a - b);
    benchmark.adaptive = {
        parses: counts.parse - beforeAdaptive,
        medianMs: adaptiveTimes[Math.floor(adaptiveTimes.length / 2)],
        p95Ms: adaptiveTimes[Math.floor(adaptiveTimes.length * 0.95)],
        maxMs: adaptiveTimes[adaptiveTimes.length - 1],
    };
    measured.cancel();
    const longSamples = {
        code: "```typescript\n" + "const value = 42;\n".repeat(3000),
        table: "| A | B |\n| --- | --- |\n" + "| **one** | two |\n".repeat(2400),
        list: "- **item** with `code`\n".repeat(2400),
        paragraph: "**text** [link](https://example.com) ".repeat(1500),
    };
    benchmark.shapes = {};
    for (const [name, sample] of Object.entries(longSamples)) {
        body.replaceChildren();
        body.className = "agent-chat__body b3-typography agent-chat__body--streaming";
        const clock = createClock();
        clock.now = () => performance.now();
        const renderer = new AgentStreamingMarkdown(body, () => {}, clock);
        const before = counts.parse;
        const times = [];
        for (let end = 800; end < sample.length + 800; end += 800) {
            const length = Math.min(end, sample.length);
            renderer.update(sample.slice(0, length));
            const parseCount = counts.parse;
            const start = performance.now();
            clock.advance(1000);
            if (parseCount !== counts.parse) {
                times.push(performance.now() - start);
            }
            check.equal(body.querySelector(".agent-chat__streaming-tail"), null);
        }
        check.equal(clock.jobs.size, 0);
        times.sort((a, b) => a - b);
        benchmark.shapes[name] = {characters: sample.length, parses: counts.parse - before,
            p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times[times.length - 1]};
        renderer.cancel();
    }
    // 实际浏览器 Worker 加载实际 Lute；模块在内存转译，不构建或替换应用产物。
    body.remove();
    const workerModules = Object.fromEntries(["protyle/render/setLute", "protyle/util/inlineElementBoundary",
        "layout/dock/agent/AgentMarkdownWorker"]
        .map(name => [name, sources[name]]));
    const bootstrap = modules => {
        const cache = {};
        const load = name => {
            if (!modules[name]) return {};
            if (!cache[name]) {
                cache[name] = {};
                new Function("require", "exports", modules[name])(dependency => {
                    const parts = (name.slice(0, name.lastIndexOf("/")) + "/" + dependency).split("/");
                    const normalized = [];
                    for (const part of parts) {
                        if (part === "..") normalized.pop();
                        else if (part !== ".") normalized.push(part);
                    }
                    return load(normalized.join("/"));
                }, cache[name]);
            }
            return cache[name];
        };
        load("layout/dock/agent/AgentMarkdownWorker");
    };
    const workerURL = URL.createObjectURL(new Blob([
        `(${bootstrap.toString()})(${JSON.stringify(workerModules)});`,
    ], {type: "application/javascript"}));
    const luteURL = URL.createObjectURL(new Blob([luteScript], {type: "application/javascript"}));
    const script = document.createElement("script");
    script.id = "protyleLuteScript";
    script.type = "application/x-test";
    script.src = luteURL;
    document.head.appendChild(script);
    const workers = [];
    let requests = 0;
    let workerParsedLength = 0;
    const workerFactory = () => {
        const worker = new Worker(workerURL);
        workers.push(worker);
        const postMessage = worker.postMessage.bind(worker);
        worker.postMessage = message => {
            requests++;
            workerParsedLength += message.markdown.length;
            postMessage(message);
        };
        return worker;
    };
    const waitFor = async condition => {
        const deadline = performance.now() + 15000;
        while (!condition()) {
            check.ok(performance.now() < deadline, "Worker did not finish");
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };
    try {
        // 桌面本地内核的 Lute script 是内联脚本，同样应启用 Worker，而非静默走主线程。
        const base = document.createElement("base");
        base.href = "http://127.0.0.1:6806/stage/build/app/";
        document.head.prepend(base);
        script.removeAttribute("src");
        let inlineRequest;
        const inlineParser = new AgentMarkdownParser(() => ({
            postMessage: request => { inlineRequest = request; }, terminate: () => {},
        }));
        inlineParser.parse("**inline Lute**", () => {});
        check.equal(inlineRequest.luteURL, "http://127.0.0.1:6806/stage/protyle/js/lute/lute.min.js?v=test");
        inlineParser.cancel();
        script.src = luteURL;
        base.remove();

        // 短预览也在后台解析，脚本加载等待不参与降频预算。
        f = fixture();
        f.renderer.parser.workerFactory = workerFactory;
        const beforeShort = counts.parse;
        f.renderer.update("**short**");
        f.clock.advance(0);
        check.equal(f.renderer.parsing, true);
        await waitFor(() => !f.renderer.parsing);
        check.equal(counts.parse, beforeShort);
        check.equal(f.body.querySelector("strong").textContent, "short");
        f.renderer.cancel();
        f.body.remove();
        f = fixture();
        const startup = {postMessage: () => {}, terminate: () => {}};
        f.renderer.parser.workerFactory = () => startup;
        f.renderer.update("**short**");
        f.clock.advance(5000);
        startup.onmessage({data: {html: "<p><strong>short</strong></p>", duration: 2}});
        check.equal(f.renderer.interval, 100);
        f.renderer.cancel();
        f.body.remove();

        // 正在解析时只保留最新输入；取消后的旧 Worker 结果不得写回或触发主线程解析。
        f = fixture();
        f.renderer.parser.workerFactory = workerFactory;
        let source = "```ts\n" + "const a = 1;\n".repeat(800);
        f.renderer.update(source);
        f.clock.advance(0);
        check.equal(f.renderer.parsing, true);
        const firstRequest = requests;
        for (let i = 0; i < 60; i++) {
            source += "const b = 2;\n";
            f.renderer.update(source);
            f.clock.advance(1);
        }
        check.equal(requests, firstRequest);
        check.equal(f.clock.jobs.size, 0);
        await waitFor(() => !f.renderer.parsing);
        const code = f.body.querySelector("code");
        const codeText = code.firstChild;
        f.clock.advance(2000);
        await waitFor(() => !f.renderer.parsing);
        check.equal(requests, firstRequest + 1);
        check.equal(f.renderer.renderedLength, source.length);
        check.equal(f.body.querySelector("code"), code);
        check.equal(code.firstChild, codeText);
        check.equal(normalize(f.body.innerHTML), normalize(reference.ProtylePreviewStr("", source)));
        f.renderer.update(source + "more");
        f.clock.advance(2000);
        const staleWorkerResult = workers[workers.length - 1].onmessage;
        const beforeCancel = f.body.innerHTML;
        f.renderer.cancel();
        staleWorkerResult({data: {html: "<p>stale</p>"}});
        await new Promise(resolve => setTimeout(resolve, 20));
        check.equal(f.body.innerHTML, beforeCancel);
        check.equal(f.clock.jobs.size, 0);
        f.body.remove();

        // 10 万字符完整经过实际 Worker，完成组不会随着消息增长被重新发送给解析器。
        f = fixture();
        f.renderer.parser.workerFactory = workerFactory;
        const beforeStream = requests;
        const beforeStreamLength = workerParsedLength;
        for (let end = 800; end <= output.length; end += 800) {
            f.renderer.update(output.slice(0, end));
            while (f.renderer.renderedLength !== end) {
                f.clock.advance(2000);
                await waitFor(() => !f.renderer.parsing);
            }
        }
        check.equal(normalize(f.body.innerHTML), normalize(reference.ProtylePreviewStr("", output)));
        check.ok(workerParsedLength - beforeStreamLength < output.length * 4);
        benchmark.workerStream = {characters: output.length, parses: requests - beforeStream,
            parsedCharacters: workerParsedLength - beforeStreamLength};
        f.renderer.cancel();
        f.body.remove();

        // AgentChat 收尾发生在 Worker 尚未返回时，完整原文仍只由最终渲染器写入一次。
        const originalParse = AgentMarkdownParser.prototype.parse;
        for (const finish of ["done", "stop", "error", "config", "round"]) {
            let fake;
            let terminated = false;
            AgentMarkdownParser.prototype.parse = function (source, done) {
                this.workerFactory = () => {
                    fake = {postMessage: () => {}, terminate: () => { terminated = true; }};
                    return fake;
                };
                return originalParse.call(this, source, done);
            };
            try {
                const chat = chatFixture(true);
                const message = "# Pending\n\n**worker**";
                chat.appendToken(message);
                await waitFor(() => !!fake);
                const stale = fake.onmessage;
                const body = chat.currentAIElement.querySelector(".agent-chat__body");
                const before = counts.postRender;
                if (finish === "done") await chat.finishResponse(false);
                else if (finish === "stop") await chat.stopGeneration();
                else if (finish === "round") chat.finishVisibleRound();
                else if (finish === "config") await chat.appendConfigurableError("Configuration error");
                else chat.appendError("Interrupted");
                stale({data: {html: "<p>stale</p>"}});
                check.equal(terminated, true, finish);
                check.equal(normalize(body.innerHTML), normalize(reference.ProtylePreviewStr("", message)), finish);
                check.equal(counts.postRender, before + 1, finish);
                check.equal(chat.streamingMarkdown, undefined, finish);
                chat.messagesContainer.remove();
            } finally {
                AgentMarkdownParser.prototype.parse = originalParse;
            }
        }

        // Worker 不可创建或加载失败时仍用 Lute 格式化；取消同时释放后台线程。
        for (const mode of ["create", "load", "message"]) {
            let terminated = false;
            const fake = {postMessage: () => {}, terminate: () => { terminated = true; }};
            const parser = new AgentMarkdownParser(() => {
                if (mode === "create") throw new Error("Worker unavailable");
                return fake;
            });
            let result;
            parser.parse(source, html => { result = html; });
            if (mode !== "create") {
                const onError = mode === "load" ? fake.onerror : fake.onmessageerror;
                onError(new Event("error", {cancelable: true}));
                check.equal(terminated, true);
            }
            check.equal(normalize(result), normalize(reference.ProtylePreviewStr("", source)));
            parser.cancel();
        }

        // 大尾部场景测量实际后台解析和前台 DOM 应用，报告耗时，不用机器相关阈值决定通过。
        benchmark.workerShapes = {};
        for (const [name, sample] of Object.entries(longSamples)) {
            const body = document.createElement("div");
            body.className = "agent-chat__body b3-typography agent-chat__body--streaming";
            body.style.width = "420px";
            document.body.appendChild(body);
            const latencies = [];
            const applyTimes = [];
            let sent = 0;
            let received = 0;
            const renderer = new AgentStreamingMarkdown(body, () => {
                void body.offsetHeight;
                latencies.push(performance.now() - sent);
                applyTimes.push(performance.now() - received);
            });
            renderer.parser.workerFactory = () => {
                const worker = workerFactory();
                worker.addEventListener("message", () => { received = performance.now(); });
                return worker;
            };
            const before = requests;
            for (const fraction of [0.5, 0.75, 1]) {
                const partial = sample.slice(0, Math.floor(sample.length * fraction));
                sent = performance.now();
                renderer.update(partial);
                await waitFor(() => renderer.renderedLength === partial.length);
                check.equal(body.querySelector(".agent-chat__streaming-tail"), null);
            }
            const referenceBody = document.createElement("template");
            referenceBody.innerHTML = reference.ProtylePreviewStr("", sample);
            renderer.preparePreview(referenceBody.content);
            check.equal(body.innerHTML, referenceBody.innerHTML, name);
            check.equal(requests - before, 3, name);
            benchmark.workerShapes[name] = {characters: sample.length,
                maxResponseMs: Math.max(...latencies), maxDOMApplyMs: Math.max(...applyTimes)};
            renderer.cancel();
            body.remove();
        }
    } finally {
        workers.forEach(worker => worker.terminate());
        script.remove();
        URL.revokeObjectURL(workerURL);
        URL.revokeObjectURL(luteURL);
    }
    return {ok: true, benchmark};
};

const run = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, backgroundThrottling: false,
    }});
    let code = 0;
    try {
        // 测试只使用内存 HTML 和本地 Lute，禁止测试夹具中的图片或链接发起外部请求。
        win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
            callback({cancel: /^https?:/.test(details.url)});
        });
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname,
            "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        const css = ["component/_typography.scss", "business/_ai_agent.scss"].map(file =>
            require("sass").compile(path.join(__dirname, "../src/assets/scss", file)).css).join("\n");
        const result = await win.webContents.executeJavaScript(`(async () => { try {
            return await (${runCases.toString()})(${JSON.stringify(sources())}, ${JSON.stringify(css)}, ${JSON.stringify(readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"))});
        } catch (error) { return {error: error.stack}; } })()`);
        assert.equal(result.ok, true, result.error);
        console.log("Agent streaming Markdown cases passed " + JSON.stringify(result.benchmark));
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    run().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("agent streaming Markdown caches completed groups and preserves the final renderer", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async t => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-agent-markdown-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 115000});
            assert.match(stdout, /Agent streaming Markdown cases passed/);
            t.diagnostic(stdout.trim());
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-agent-markdown-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
