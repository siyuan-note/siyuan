// connectionEntry.js 是启动页上的连接入口，页面与脚本由 electron/static 一起原样复制进安装包。
// 文案来自同目录的 window-languages.json，脚本不再按目录层级读取 appearance/langs，
// 因此本测试守住「只取同目录文案、缺失或非法语言回落英文」以及入口按钮的挂载方式。
import {test} from "node:test";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source: string = fs.readFileSync(path.join(__dirname, "connectionEntry.js"), "utf8");

type Labels = Record<string, {connectRemoteKernel: string}>;

type EntryOptions = {pathname?: string, search?: string, hasLangSelect?: boolean, hasCrashActions?: boolean};

const createElement = (properties: Record<string, any> = {}): any => {
    const listeners = new Map<string, () => void>();
    const classes = new Set<string>();
    return {
        ...properties,
        style: {},
        classList: {add: (name: string) => classes.add(name), contains: (name: string) => classes.has(name)},
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        dispatch: (type: string) => listeners.get(type)?.(),
    };
};

// 按启动页面的控件与查询参数执行连接入口脚本，记录 require 的模块、元素挂载位置和 IPC 消息
const runEntry = (languages: Labels, lang: string, {
    pathname = "/electron/init.html", search = "?lang=" + lang, hasLangSelect = true, hasCrashActions = false,
}: EntryOptions = {}) => {
    const appended: any[] = [];
    const crashAppended: any[] = [];
    const created: any[] = [];
    const required: string[] = [];
    const sent: any[][] = [];
    const button = createElement();
    const langSelect = hasLangSelect ? createElement({value: lang}) : null;
    const crashActions = hasCrashActions ? createElement({append: (element: any) => crashAppended.push(element)}) : null;
    vm.runInNewContext(source, {
        __dirname,
        URLSearchParams,
        location: {pathname, search},
        require: (name: string) => {
            required.push(name);
            return ({
                electron: {ipcRenderer: {send: (...args: any[]) => sent.push(args)}},
                "./window-languages.json": languages,
            } as Record<string, any>)[name];
        },
        document: {
            createElement: () => {
                created.push(button);
                return button;
            },
            querySelector: (selector: string) =>
                ({".lang": langSelect, ".crash-actions": crashActions} as Record<string, any>)[selector] ?? null,
            body: {append: (element: any) => appended.push(element)},
        },
    });
    return {appended, crashAppended, created, required, sent, button, langSelect};
};

test("connection entry reads labels from the sibling window-languages.json", () => {
    const {appended, required, sent, button, langSelect} = runEntry(
        {en: {connectRemoteKernel: "English"}, "zh-CN": {connectRemoteKernel: "Chinese"}}, "zh-CN");
    // 只允许取同目录文案，出现 node:fs 或 node:path 说明又回到了按目录层级查找
    assert.deepEqual(required, ["electron", "./window-languages.json"]);
    assert.deepEqual(appended, [button]);
    assert.match(button.style.cssText, /position:fixed/);
    assert.equal(button.textContent, "Chinese");
    langSelect.value = "en";
    langSelect.dispatch("change");
    assert.equal(button.textContent, "English");
    button.dispatch("click");
    assert.deepEqual(sent.map(([channel, data]) => [channel, data.lang]), [["siyuan-manage-connections", "en"]]);
});

test("connection entry falls back to English when the selected language is missing", () => {
    const {appended, button} = runEntry({en: {connectRemoteKernel: "English"}}, "fr");
    assert.deepEqual(appended, [button]);
    assert.equal(button.textContent, "English");
});

test("connection entry falls back to English for a malformed or missing language tag", () => {
    const languages = {en: {connectRemoteKernel: "English"}};
    assert.equal(runEntry(languages, "zh-cn").button.textContent, "English");
    assert.equal(runEntry(languages, "en", {search: "", hasLangSelect: false}).button.textContent, "English");
});

for (const [page, options, crash] of [
    ["missing workspace", {pathname: "/electron/workspace.html", search: "?lang=zh-CN&missing=workspace",
        hasCrashActions: true}, false],
    ["safe mode", {pathname: "/electron/workspace.html", search: "?lang=zh-CN&crash=1",
        hasCrashActions: true}, true],
    ["remote boot", {pathname: "/electron/boot.html", search: "?remote=https://example.com&lang=zh-CN",
        hasLangSelect: false}, false],
] as [string, EntryOptions, boolean][]) {
    test(`connection entry mounts and opens connections on the ${page} page`, () => {
        const {appended, crashAppended, button, sent, langSelect} = runEntry(
            {en: {connectRemoteKernel: "English"}, "zh-CN": {connectRemoteKernel: "Chinese"}}, "zh-CN", options);
        assert.deepEqual(appended, crash ? [] : [button]);
        assert.deepEqual(crashAppended, crash ? [button] : []);
        assert.equal(button.textContent, "Chinese");
        assert.equal(button.classList.contains("b3-button--outline"), crash);
        if (crash) {
            assert.equal(button.style.cssText, undefined);
        } else {
            assert.match(button.style.cssText, /position:fixed/);
        }
        if (langSelect) {
            langSelect.value = "en";
            langSelect.dispatch("change");
            assert.equal(button.textContent, "English");
        } else {
            assert.equal(langSelect, null);
        }
        button.dispatch("click");
        assert.deepEqual(sent.map(([channel, data]) => [channel, data.lang]),
            [["siyuan-manage-connections", langSelect ? "en" : "zh-CN"]]);
    });
}

test("connection entry skips the local boot page", () => {
    const {appended, crashAppended, created, required, sent} = runEntry(
        {en: {connectRemoteKernel: "English"}}, "en",
        {pathname: "/electron/boot.html", search: "?lang=en", hasLangSelect: false});
    assert.deepEqual(appended, []);
    assert.deepEqual(crashAppended, []);
    assert.deepEqual(created, []);
    assert.deepEqual(required, []);
    assert.deepEqual(sent, []);
});
