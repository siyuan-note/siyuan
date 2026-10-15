import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isMethodDeclaration, isNewExpression, isVariableDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type * as GreetingModule from "./AgentWelcomeGreeting";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/AgentWelcomeGreeting.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const load = (storage: Record<string, unknown> | undefined = {}, fail?: "sync" | "async") => {
    const writes: Array<[string, unknown]> = [];
    const exports = {} as typeof GreetingModule;
    const siyuan = {storage};
    runInNewContext(compiled, {
        exports,
        window: {siyuan},
        require: () => ({setStorageVal: (key: string, value: unknown) => {
            writes.push([key, value]);
            if (fail === "sync") throw new Error("storage unavailable");
            if (fail === "async") return Promise.reject(new Error("storage unavailable"));
        }}),
    });
    return {...exports, writes, siyuan};
};
const date = (hour = 12, minute = 0) => new Date(2026, 9, 8, hour, minute);
const week = 7 * 24 * 60 * 60 * 1000;

test("greeting time groups follow every device-local boundary", () => {
    const {getAgentGreetingGroup: group} = load();
    for (const [hour, minute, expected] of [
        [0, 0, "Late"], [4, 59, "Late"], [5, 0, "Morning"], [10, 59, "Morning"],
        [11, 0, "Day"], [17, 59, "Day"], [18, 0, "Evening"], [22, 59, "Evening"], [23, 0, "Late"],
    ] as const) {
        const now = date(hour, minute);
        assert.equal(group(now, now.getTime() - 1), expected);
    }
});

test("first and seven-day return take precedence and reject invalid timestamps", () => {
    const {getAgentGreetingGroup: group} = load();
    const now = date();
    for (const value of [undefined, null, "123", {}, NaN, Infinity, -1, 0, now.getTime() + 1]) {
        assert.equal(group(now, value), "First");
    }
    assert.equal(group(now, now.getTime() - week + 1), "Day");
    assert.equal(group(now, now.getTime() - week), "Return");
    assert.equal(group(now, now.getTime() - week - 1), "Return");
});

test("all groups select only valid keys and exclude the previous variant", () => {
    const {pickAgentGreeting: pick} = load();
    for (const group of ["First", "Return", "Morning", "Day", "Evening", "Late"] as const) {
        const count = group === "First" || group === "Return" ? 2 : 5;
        const selected = new Set<string>();
        for (let i = 0; i < count; i++) selected.add(pick(group, undefined, () => i / count));
        assert.equal(selected.size, count);
        for (const previous of selected) {
            for (const value of [0, 0.2, 0.5, 0.999999]) {
                const next = pick(group, previous, () => value);
                assert.notEqual(next, previous);
                assert.ok(selected.has(next));
            }
        }
    }
});

test("hidden construction writes nothing; actual open captures the old time before writing", () => {
    const env = load();
    const greeting = new env.AgentWelcomeGreeting();
    assert.equal(greeting.getKey("new"), "");
    assert.equal(greeting.setVisible(false, true), false);
    assert.equal(env.writes.length, 0);
    assert.equal(greeting.setVisible(true, true, date()), true);
    assert.equal(env.writes[0][0], env.AGENT_LAST_OPEN_KEY);
    assert.equal(env.writes[0][1], date().getTime());
    assert.match(greeting.getKey("new", date()), /^agentWelcomeFirst[12]$/);
    assert.equal(env.writes.length, 2);
    assert.equal(greeting.setVisible(true, true, date(18)), false);
    assert.equal(env.writes.length, 2);
});

test("rerenders stay stable; new conversations use current local time without recording another open", () => {
    const env = load();
    const greeting = new env.AgentWelcomeGreeting();
    greeting.setVisible(true, true, date(5));
    const first = greeting.getKey("first", date(5));
    assert.equal(greeting.getKey("first", date(18)), first);
    assert.equal(env.writes.length, 2);
    const second = greeting.getKey("second", date(18));
    assert.match(second, /^agentWelcomeEvening[1-5]$/);
    assert.notEqual(greeting.getKey("third", date(18)), second);
    assert.equal(env.writes.filter(([key]) => key === env.AGENT_LAST_OPEN_KEY).length, 1);
});

test("reopening blank chat uses return override and persists nonrepeat across instances", () => {
    const env = load();
    const greeting = new env.AgentWelcomeGreeting();
    greeting.setVisible(true, true, date());
    greeting.getKey("new", date());
    greeting.setVisible(false, true, date());
    const later = new Date(date().getTime() + week);
    greeting.setVisible(true, true, later);
    assert.match(greeting.getKey("new", later), /^agentWelcomeReturn[12]$/);
    greeting.setVisible(false, true, later);
    greeting.setVisible(true, true, later);
    const previous = greeting.getKey("new", later);
    assert.match(previous, /^agentWelcomeDay[1-5]$/);
    const next = new env.AgentWelcomeGreeting();
    next.setVisible(true, true, later);
    assert.notEqual(next.getKey("next", later), previous);
});

test("opening history records a visit but does not leave a first/return override for new chats", () => {
    const env = load();
    const greeting = new env.AgentWelcomeGreeting();
    assert.equal(greeting.setVisible(true, false, date()), false);
    assert.match(greeting.getKey("new", date(23)), /^agentWelcomeLate[1-5]$/);
});

test("hidden session deletion and late initialization do not select unseen greetings", () => {
    const env = load({"siyuan-agent-last-open": date().getTime() - 1});
    const greeting = new env.AgentWelcomeGreeting();
    greeting.setVisible(true, true, date());
    const shown = greeting.getKey("first", date());
    greeting.setVisible(false, true, date());
    const writes = env.writes.length;
    assert.equal(greeting.getKey("first", date()), shown);
    assert.equal(greeting.getKey("replacement", date()), "");
    assert.equal(env.writes.length, writes);
    greeting.setVisible(true, true, date());
    assert.notEqual(greeting.getKey("replacement", date()), shown);
    const uninitialized = new env.AgentWelcomeGreeting();
    uninitialized.setVisible(true, true, date());
    uninitialized.setVisible(false, true, date());
    const beforeInit = env.writes.length;
    assert.equal(uninitialized.getKey("late-init", date()), "");
    assert.equal(env.writes.length, beforeInit);
});

test("AgentChat welcome rerenders retain the greeting across model configuration changes", () => {
    const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
        ScriptTarget.Latest, true);
    let body: string;
    const visit = (node: import("typescript").Node) => {
        if (isMethodDeclaration(node) && node.name.getText(source) === "showWelcome") body = node.body.getText(source);
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(body);
    const env = load();
    const greeting = new env.AgentWelcomeGreeting();
    greeting.setVisible(true, true, date());
    const keys: string[] = [];
    const models: boolean[] = [];
    const show = runInNewContext(transpileModule(`(function () ${body})`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {renderWelcomeHTML: (hasModel: boolean, key: string) => {
        keys.push(key);
        models.push(hasModel);
        return key;
    }});
    const chat = {
        welcomeGreeting: greeting, sessionId: "new", modelOptions: [] as Array<{id: string}>,
        destroyEditingComposer() {},
        messagesContainer: {
            innerHTML: "", querySelector: (): HTMLElement | null => null, querySelectorAll: (): HTMLElement[] => [],
        },
    };
    show.call(chat);
    chat.modelOptions = [{id: "configured"}];
    show.call(chat);
    chat.modelOptions = [];
    show.call(chat);
    assert.deepEqual(models, [false, true, false]);
    assert.equal(new Set(keys).size, 1);
    assert.match(keys[0], /^agentWelcomeFirst[12]$/);
    assert.equal(env.writes.length, 2);
});

test("missing and failing storage do not interrupt greetings or allow consecutive repeats", async () => {
    for (const failure of [undefined, "sync", "async"] as const) {
        const env = load(undefined, failure);
        if (failure === undefined) env.siyuan.storage = undefined;
        const greeting = new env.AgentWelcomeGreeting();
        greeting.setVisible(true, true, date());
        const first = greeting.getKey("new", date());
        assert.match(first, /^agentWelcomeFirst[12]$/);
        assert.notEqual(greeting.getKey("next", date()), first);
        await Promise.resolve();
    }
});

test("desktop observer ignores edge-adjacent hidden panels and repeated layout notifications", () => {
    const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
        ScriptTarget.Latest, true);
    let observerArguments: string;
    const visit = (node: import("typescript").Node) => {
        if (isNewExpression(node) && node.expression.getText(source) === "IntersectionObserver") {
            observerArguments = node.arguments.map(argument => argument.getText(source)).join(",");
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(observerArguments);
    const factory = transpileModule(`(function () { return [${observerArguments}]; })`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const env = load();
    const greeting = new env.AgentWelcomeGreeting();
    const rendered: string[] = [];
    const chat = {
        setWelcomeVisible: (visible: boolean) => {
            if (greeting.setVisible(visible, true)) rendered.push(greeting.getKey("new"));
        },
    };
    const [observe, options] = runInNewContext(factory).call(chat);
    assert.equal(options.threshold, 0.01);
    const notify = (ratio: number, width = 100) => observe([{
        isIntersecting: true, intersectionRatio: ratio, intersectionRect: {width, height: 100},
    }]);
    notify(0);
    notify(1, 0);
    assert.equal(env.writes.length, 0);
    notify(0.02);
    assert.equal(rendered.length, 1);
    notify(1);
    notify(0.5);
    assert.equal(rendered.length, 1);
    assert.equal(env.writes.length, 2);
    notify(0);
    notify(1);
    assert.equal(rendered.length, 2);
    assert.equal(env.writes.filter(([key]) => key === env.AGENT_LAST_OPEN_KEY).length, 2);
    const mobile = readFileSync("src/mobile/agent/MobileAgentChat.ts", "utf8");
    assert.match(mobile, /detachedRoot\.appendChild\(rootElement\)/);
    assert.match(mobile, /new AgentChat\(currentApp/);
    assert.match(source.text, /this\.welcomeObserver\?\.disconnect\(\)/);
});

test("mobile records only committed opens, preserving canceled swipes and model rerenders", () => {
    const source = createSourceFile("MobileAgentChat.ts", readFileSync("src/mobile/agent/MobileAgentChat.ts", "utf8"),
        ScriptTarget.Latest, true);
    let initializer: string;
    const visit = (node: import("typescript").Node) => {
        if (isVariableDeclaration(node) && node.name.getText(source) === "observeWelcomeVisibility") {
            initializer = node.initializer.getText(source);
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(initializer);
    const env = load();
    const greeting = new env.AgentWelcomeGreeting();
    let callback: () => void;
    let observerCount = 0;
    let disconnected = 0;
    let swiping = false;
    let hidden = false;
    const rootElement = {isConnected: true};
    const sidebar = {style: {transform: ""}, classList: {contains: () => swiping}};
    const panel = {closest: () => sidebar, classList: {contains: () => hidden}};
    const observe = runInNewContext(transpileModule(`(${initializer})`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {
        agentChat: {setWelcomeVisible: (visible: boolean) => {
            if (greeting.setVisible(visible, true, date())) greeting.getKey("new", date());
        }},
        rootElement, welcomeObserver: undefined, welcomePanel: undefined, welcomeSidebar: undefined,
        MOBILE_SIDEBAR_SWIPING_CLASS: "side-panel--swiping",
        MutationObserver: class {
            constructor(cb: () => void) { callback = cb; observerCount++; }
            observe() {}
            disconnect() { disconnected++; }
        },
    });
    observe(panel);
    swiping = true;
    sidebar.style.transform = "translateX(-30px)";
    callback();
    sidebar.style.transform = "translateX(0px)";
    callback();
    assert.equal(env.writes.length, 0);
    swiping = false;
    sidebar.style.transform = "";
    callback();
    assert.equal(env.writes.length, 0);
    sidebar.style.transform = "translateX(0px)";
    callback();
    assert.equal(env.writes.length, 2);
    observe(panel);
    callback();
    assert.equal(observerCount, 1);
    assert.equal(env.writes.length, 2);
    swiping = true;
    sidebar.style.transform = "translateX(-20px)";
    callback();
    swiping = false;
    sidebar.style.transform = "translateX(0px)";
    callback();
    assert.equal(env.writes.length, 2);
    hidden = true;
    callback();
    hidden = false;
    callback();
    assert.equal(env.writes.length, 4);
    sidebar.style.transform = "";
    callback();
    rootElement.isConnected = false;
    sidebar.style.transform = "translateX(0px)";
    callback();
    assert.equal(env.writes.length, 4);
    observe({...panel});
    assert.equal(disconnected, 1);
    assert.equal(observerCount, 2);
});
