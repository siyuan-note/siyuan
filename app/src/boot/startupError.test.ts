import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {completeStartup, guardStartup, installStartupError, resolveStartupLanguage, setStartupLanguage, setStartupStage} from "./startupError";
import bundledLanguages from "../../appearance/boot/startup-languages.json";

class ElementStub extends EventTarget {
    id = "";
    className = "";
    textContent = "";
    children: ElementStub[] = [];
    attributes = new Map<string, string>();
    style = {removeProperty() {}};
    parent?: ElementStub;
    constructor(public tagName = "DIV") { super(); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    append(...children: ElementStub[]) {
        children.forEach(child => { child.parent = this; this.children.push(child); });
    }
    appendChild(child: ElementStub) { this.append(child); }
    replaceChildren(...children: ElementStub[]) { this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() {}
    set innerHTML(_value: string) { assert.fail("diagnostics must be inserted as text"); }
}

const createPage = () => {
    const document = Object.assign(new EventTarget(), {
        body: new ElementStub(), documentElement: new ElementStub("HTML"), hidden: false,
        createElement: (name: string) => new ElementStub(name.toUpperCase()),
        createRange: () => ({selectNodeContents: (element: ElementStub) => selected = element.textContent}),
        execCommand: (): boolean => true,
        getElementById: (id: string): ElementStub | undefined => find(element => element.id === id),
        querySelector: (selector: string): ElementStub | undefined => {
            assert.equal(selector, ".startup-error");
            return find(element => element.className.split(" ").includes("startup-error"));
        },
    });
    const find = (matches: (element: ElementStub) => boolean, element = document.body): ElementStub | undefined => {
        if (!element) return;
        if (matches(element)) return element;
        for (const child of element.children) {
            const match = find(matches, child);
            if (match) return match;
        }
    };
    let selected = "";
    let reloads = 0;
    const timers = new Map<number, () => void>();
    let timerID = 0;
    const target = Object.assign(new EventTarget(), {
        document,
        navigator: {languages: ["en"], userAgent: "test browser", clipboard: {writeText: async () => {}}},
        location: {href: "http://127.0.0.1:6806/stage/build/mobile/", reload: () => reloads++},
        getSelection: () => ({removeAllRanges() {}, addRange() {}}),
        setTimeout: (callback: () => void) => { timers.set(++timerID, callback); return timerID; },
        clearTimeout: (id: number) => timers.delete(id),
    });
    const previous = globalThis.window;
    globalThis.window = target as unknown as Window & typeof globalThis;
    const startup = installStartupError(globalThis.window, "test-version");
    return {target, document, startup, find, timers, selected: () => selected, reloads: () => reloads,
        dispose: () => { startup.dispose(); globalThis.window = previous; }};
};

test("startup translations match every bundled language", () => {
    assert.deepEqual(Object.keys(bundledLanguages).sort(), readdirSync("appearance/langs").map(file => file.slice(0, -5)).sort());
    for (const [language, strings] of Object.entries(bundledLanguages)) {
        const pack = JSON.parse(readFileSync(`appearance/langs/${language}.json`, "utf8"));
        for (const [key, value] of Object.entries(strings)) assert.equal(value, pack[key], `${language}: ${key}`);
    }
    for (const [preferred, expected] of [["zh-Hant-HK", "zh-TW"], ["zh-Hans", "zh-CN"], ["pt-PT", "pt-BR"], ["de-DE", "de"], ["unknown", "en"]]) {
        assert.equal(resolveStartupLanguage([preferred]), expected);
    }
});

test("an asynchronous startup rejection shows localized, selectable diagnostics without a language pack", async () => {
    const page = createPage();
    try {
        setStartupLanguage("zh-CN");
        setStartupStage("engine");
        guardStartup<void>(async () => { throw new Error("<script>untrusted error</script>"); })();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(page.document.documentElement.attributes.get("data-startup-state"), "failed");
        assert.equal(page.find(element => element.id === "startupErrorTitle")?.textContent, "思源启动失败");
        assert.match(page.find(element => element.tagName === "P")?.textContent || "", /加载编辑引擎/);
        const details = page.find(element => element.tagName === "PRE");
        assert.match(details.textContent, /test-version\nstage=engine/);
        assert.match(details.textContent, /<script>untrusted error<\/script>/);
        const buttons = page.find(element => element.className.includes("startup-error__actions")).children;
        buttons[1].dispatchEvent(new Event("click"));
        assert.equal(page.selected(), details.textContent);
        assert.equal(buttons[1].textContent, "已复制");
        buttons[0].dispatchEvent(new Event("click"));
        assert.equal(page.reloads(), 1);
    } finally { page.dispose(); }
});

test("copy failures keep the diagnostic text selected for the system copy menu", async () => {
    const page = createPage();
    try {
        page.document.execCommand = () => false;
        page.target.navigator.clipboard.writeText = async () => { throw new Error("denied"); };
        page.startup.fail(new Error("failed"));
        const copy = page.find(element => element.className.includes("startup-error__actions")).children[1];
        copy.dispatchEvent(new Event("click"));
        await new Promise(resolve => setImmediate(resolve));
        assert.match(copy.textContent, /Select and copy/);
        assert.match(page.selected(), /failed/);
    } finally { page.dispose(); }
});

test("startup catches main script failures and timeouts, then stops monitoring after successful initialization", () => {
    const page = createPage();
    try {
        page.target.dispatchEvent(Object.assign(new Event("error"), {error: new Error("bundle syntax error")}));
        assert.match(page.find(element => element.tagName === "PRE").textContent, /bundle syntax error/);
        completeStartup();
        assert.equal(page.document.querySelector(".startup-error"), undefined);
        assert.equal(page.document.documentElement.attributes.get("data-startup-state"), "ready");
        assert.equal(page.timers.size, 0);
        page.startup.fail(new Error("unrelated runtime failure"));
        assert.equal(page.document.querySelector(".startup-error"), undefined);
    } finally { page.dispose(); }
    const timeout = createPage();
    try {
        setStartupStage("storage");
        [...timeout.timers.values()][0]();
        assert.match(timeout.find(element => element.tagName === "PRE").textContent, /stage=storage/);
        assert.match(timeout.find(element => element.tagName === "PRE").textContent, /Startup timed out/);
    } finally { timeout.dispose(); }
});

test("background time does not consume a startup deadline", () => {
    const page = createPage();
    try {
        page.document.hidden = true;
        page.document.dispatchEvent(new Event("visibilitychange"));
        assert.equal(page.timers.size, 0);
        page.document.hidden = false;
        page.document.dispatchEvent(new Event("visibilitychange"));
        assert.equal(page.timers.size, 1);
    } finally { page.dispose(); }
});

test("normal layout completion preserves a visible startup failure until the application is ready", () => {
    const source = readFileSync("src/mobile/util/startup.ts", "utf8");
    const functionSource = source.match(/export const finishMobileStartup = \(\) => \{[\s\S]*?\n};/)[0];
    let removed = false;
    const loading = {classList: {contains: () => true}, remove: () => removed = true};
    const document = {getElementById: () => loading, body: {style: {removeProperty() {}}}};
    runInNewContext(functionSource.replace("export const", "const") + "\nfinishMobileStartup();", {document, finishInitialView: undefined});
    assert.equal(removed, false);
    loading.classList.contains = () => false;
    runInNewContext(functionSource.replace("export const", "const") + "\nfinishMobileStartup();", {document, finishInitialView: undefined});
    assert.equal(removed, true);
});
