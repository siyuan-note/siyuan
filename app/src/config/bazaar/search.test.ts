import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("marketplace searching is debounced while typing, submits immediately on Enter, and aborts the previous request", () => {
    const input = Object.assign(new EventTarget(), {value: "", closest: () => ({
        querySelector: () => ({getAttribute: () => "myPlugin"}),
    })});
    const root = {
        firstElementChild: new EventTarget(),
        isConnected: true,
        querySelectorAll: (selector: string) => selector.endsWith(".b3-text-field") ? [input] : [],
    };
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    let panel = "plugin";
    const mocks: Record<string, unknown> = {
        "./packageConfig": {
            BAZAAR_PACKAGE_CONFIG: {plugins: {api: {bazaar: "/api/bazaar/getBazaarPlugin"}}},
            getBazaarTypeByTab: (type: string) => type === "plugin" ? "plugins" : undefined,
            getBazaarTypeByMyType: (type: string) => type === "myPlugin" ? "plugins" : undefined,
        },
        "./filterMenu": {bindBazaarFilterMenu() {}},
        "../../protyle/util/hasClosest": {hasClosestByClassName: () => ({getAttribute: () => panel})},
        "../../util/fetch": {fetchPost: (_url: string, {keyword}: {keyword: string},
                                _cb: unknown, _headers: unknown, _fail: unknown, signal: AbortSignal) => {
            calls.push(keyword);
            signals.push(signal);
        }},
        "../../util/functions": {getFrontend: () => "desktop", isMobile: () => false},
    };
    // 用可控计时器代替 window 定时器，让防抖窗口可以被测试驱动
    const timers = new Map<number, () => void>();
    let timerID = 0;
    const fakeWindow = {
        setTimeout: (callback: () => void) => {
            const id = ++timerID;
            timers.set(id, callback);
            return id;
        },
        clearTimeout: (id: number) => {
            timers.delete(id);
        },
        siyuan: {languages: {}, storage: {}},
    };
    const flushTimers = () => {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(callback => callback());
    };
    const api = {} as typeof import("./events");
    const source = transpileModule(readFileSync("src/config/bazaar/events.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    new Function("exports", "require", "window", source)(api, (id: string) => mocks[id] || {}, fakeWindow);
    const mount = {element: root as unknown as HTMLElement, generation: 1};
    const controller = {element: root, _beginBazaarRequest: () => mount, _genMyHTML: () => calls.push("downloaded")};
    api.bindBazaarEvents(controller as unknown as Parameters<typeof api.bindBazaarEvents>[0], undefined, mount);
    const type = (value: string, isComposing = false) => {
        input.value = value;
        input.dispatchEvent(Object.assign(new Event("input"), {isComposing}));
    };
    const pressEnter = () => {
        input.dispatchEvent(Object.assign(new Event("keydown"), {key: "Enter", isComposing: false}));
    };

    // 输入过程中不立即请求，防抖窗口结束后只提交一次最终关键词
    type(" p");
    type(" plugin ");
    assert.deepEqual(calls, []);
    flushTimers();
    assert.deepEqual(calls, ["plugin"]);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, false);

    // 回车取消防抖并立即提交，同时中止上一次未完成的请求
    type("theme");
    assert.deepEqual(calls, ["plugin"]);
    pressEnter();
    assert.deepEqual(calls, ["plugin", "theme"]);
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);
    flushTimers();
    assert.deepEqual(calls, ["plugin", "theme"]);

    // 输入法组合期间不搜索，组合结束后走同一条防抖路径
    type("ni", true);
    assert.deepEqual(calls, ["plugin", "theme"]);
    input.dispatchEvent(new Event("compositionend"));
    flushTimers();
    assert.deepEqual(calls, ["plugin", "theme", "ni"]);

    // 清空与其他输入一致，同样在防抖窗口结束后提交
    type("");
    assert.deepEqual(calls, ["plugin", "theme", "ni"]);
    flushTimers();
    assert.deepEqual(calls, ["plugin", "theme", "ni", ""]);

    // 已下载列表走本地过滤，同样防抖
    panel = "downloaded";
    type("theme");
    assert.deepEqual(calls, ["plugin", "theme", "ni", ""]);
    flushTimers();
    assert.deepEqual(calls, ["plugin", "theme", "ni", "", "downloaded"]);
});
