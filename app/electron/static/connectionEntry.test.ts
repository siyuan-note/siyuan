import {test} from "node:test";
import {type DefaultTreeAdapterMap, parse} from "parse5";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source: string = fs.readFileSync(path.join(__dirname, "connectionEntry.js"), "utf8");

for (const file of ["init.html", "workspace.html"]) {
    test(`${file} places the remote kernel row between the workspace path and language rows`, () => {
        const page = parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
        const elements: DefaultTreeAdapterMap["element"][] = [];
        const collect = (node: DefaultTreeAdapterMap["node"]) => {
            if ("attrs" in node) {
                elements.push(node);
            }
            if ("childNodes" in node) {
                node.childNodes.forEach(collect);
            }
        };
        collect(page);
        const byAttribute = (name: string, value: string) => elements.find(element =>
            element.attrs.some(attr => attr.name === name && attr.value === value));
        const containingRow = (name: string) => {
            const parent = byAttribute("data-i18n", name)?.parentNode;
            return parent && "parentNode" in parent ? parent.parentNode : null;
        };
        const row = byAttribute("class", "b3-label remote-kernel");
        const button = byAttribute("id", "remoteKernelConnect");
        assert.ok(row && button);
        assert.equal(button.parentNode, row);
        assert.equal(containingRow("remoteKernelTitle"), row);
        assert.equal(containingRow("remoteKernelDesc"), row);
        const workspace = containingRow(file === "init.html" ? "workspace" : "selectPath");
        const language = containingRow("lang");
        const languageSelect = byAttribute("class", "b3-select fn__flex-center lang");
        const siblings = row.parentNode?.childNodes.filter(node => "tagName" in node);
        assert.ok(siblings && workspace && language);
        assert.equal(languageSelect?.parentNode, language);
        const rowIndex = siblings.indexOf(row);
        assert.equal(siblings[rowIndex - 1], workspace);
        assert.equal(siblings[rowIndex + 1], language);
    });
}

type Labels = Record<string, {connect: string, connectRemoteKernel: string}>;

const connectionLabels: Labels = {
    en: {connect: "Connect", connectRemoteKernel: "Connect to remote kernel..."},
    "zh-CN": {connect: "连接", connectRemoteKernel: "连接远程内核..."},
};

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
    const inlineButton = pathname.endsWith("/boot.html") ? null : createElement();
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
                const button = createElement();
                created.push(button);
                return button;
            },
            getElementById: (id: string) => id === "remoteKernelConnect" ? inlineButton : null,
            querySelector: (selector: string) =>
                ({".lang": langSelect, ".crash-actions": crashActions} as Record<string, any>)[selector] ?? null,
            body: {append: (element: any) => appended.push(element)},
        },
    });
    return {appended, crashAppended, created, required, sent, button: created[0] || inlineButton, inlineButton, langSelect};
};

test("connection entry reads labels from the sibling window-languages.json", () => {
    const {appended, created, required, sent, button, inlineButton, langSelect} = runEntry(
        connectionLabels, "zh-CN");
    assert.deepEqual(required, ["electron", "./window-languages.json"]);
    assert.deepEqual(appended, []);
    assert.deepEqual(created, []);
    assert.equal(button, inlineButton);
    assert.equal(button.style.cssText, undefined);
    assert.equal(button.textContent, connectionLabels["zh-CN"].connect);
    langSelect.value = "en";
    langSelect.dispatch("change");
    assert.equal(button.textContent, connectionLabels.en.connect);
    button.dispatch("click");
    assert.deepEqual(sent.map(([channel, data]) => [channel, data.lang]), [["siyuan-manage-connections", "en"]]);
});

test("connection entry falls back to English when the selected language is missing", () => {
    const {button} = runEntry(connectionLabels, "fr");
    assert.equal(button.textContent, connectionLabels.en.connect);
});

test("inline connection entry uses the short label in every startup language", () => {
    const languages: Labels = require("./window-languages.json");
    for (const [lang, {connect}] of Object.entries(languages)) {
        assert.ok(connect, lang);
        assert.equal(runEntry(languages, lang).button.textContent, connect, lang);
    }
});

test("connection entry falls back to English for a malformed or missing language tag", () => {
    assert.equal(runEntry(connectionLabels, "zh-cn").button.textContent, connectionLabels.en.connect);
    assert.equal(runEntry(connectionLabels, "en", {search: "", hasLangSelect: false}).button.textContent,
        connectionLabels.en.connect);
});

for (const [page, options, placement] of [
    ["missing workspace", {pathname: "/electron/workspace.html", search: "?lang=zh-CN&missing=workspace",
        hasCrashActions: true}, "row"],
    ["safe mode", {pathname: "/electron/workspace.html", search: "?lang=zh-CN&crash=1",
        hasCrashActions: true}, "crash"],
    ["remote boot", {pathname: "/electron/boot.html", search: "?remote=https://example.com&lang=zh-CN",
        hasLangSelect: false}, "fixed"],
] as [string, EntryOptions, "row" | "crash" | "fixed"][]) {
    test(`connection entry mounts and opens connections on the ${page} page`, () => {
        const label = placement === "row" ? "connect" : "connectRemoteKernel";
        const {appended, crashAppended, button, created, inlineButton, sent, langSelect} = runEntry(
            connectionLabels, "zh-CN", options);
        assert.deepEqual(appended, placement === "fixed" ? [button] : []);
        assert.deepEqual(crashAppended, placement === "crash" ? [button] : []);
        assert.deepEqual(created, placement === "row" ? [] : [button]);
        assert.equal(button.textContent, connectionLabels["zh-CN"][label]);
        assert.equal(button.classList.contains("b3-button--outline"), placement === "crash");
        if (placement === "fixed") {
            assert.match(button.style.cssText, /position:fixed/);
        } else {
            assert.equal(button.style.cssText, undefined);
        }
        assert.equal(button === inlineButton, placement === "row");
        if (langSelect) {
            langSelect.value = "en";
            langSelect.dispatch("change");
            assert.equal(button.textContent, connectionLabels.en[label]);
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
        connectionLabels, "en",
        {pathname: "/electron/boot.html", search: "?lang=en", hasLangSelect: false});
    assert.deepEqual(appended, []);
    assert.deepEqual(crashAppended, []);
    assert.deepEqual(created, []);
    assert.deepEqual(required, []);
    assert.deepEqual(sent, []);
});
