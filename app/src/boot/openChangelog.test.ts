import * as assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("release changelogs always pass through a static HTML and HTTP resource policy", async () => {
    let policy: {ALLOWED_TAGS: string[]; ALLOWED_ATTR: string[]; ALLOWED_URI_REGEXP: RegExp;
        ALLOW_DATA_ATTR: boolean; ALLOW_ARIA_ATTR: boolean};
    let rendered = "";
    let received = "";
    const content = {innerHTML: "", querySelectorAll: (): HTMLElement[] => []};
    const exports = {} as typeof import("./openChangelog");
    runInNewContext(compile("src/boot/openChangelog.ts"), {exports, require: (name: string) => ({
        "../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {show: true, html: "<script>unsafe</script>", version: "3.8.10-alpha.5"}})},
        "../dialog/mobileDialog": {MobileDialog: class {
            element = {setAttribute() {}, querySelector: () => content};
        }},
        "../protyle/render/highlightRender": {highlightRender: () => { rendered = content.innerHTML; }},
        "../util/functions": {isMobile: () => false},
        "../constants": {Constants: {DIALOG_CHANGELOG: "changelog"}},
        "../util/hostCapabilities": {sanitizeKernelHTML: () => { throw new Error("local-kernel bypass used for online content"); }},
        "../util/fetchTimeout": {withFetchTimeout: (request: () => unknown) => request()},
        "../util/escape": {escapeHtml: (value: string) => value},
    })[name], document: {createElement: () => ({innerHTML: "", content: {querySelectorAll: (): HTMLElement[] => []}})},
    window: {siyuan: {config: {system: {kernelVersion: "3.8.10-alpha.5"}}, languages: {}},
        DOMPurify: {sanitize: (html: string, options: typeof policy) => { received = html; policy = options; return "sanitized"; }}}});
    await exports.openChangelog(true);
    assert.equal(received, "<script>unsafe</script>");
    assert.equal(rendered, "sanitized");
    for (const tag of ["script", "iframe", "style", "link", "form", "input", "video", "audio", "svg"]) {
        assert.ok(!policy.ALLOWED_TAGS.includes(tag), tag);
    }
    assert.ok(policy.ALLOWED_TAGS.includes("img"));
    for (const attribute of ["src", "alt", "width", "height"]) {
        assert.ok(policy.ALLOWED_ATTR.includes(attribute), attribute);
    }
    for (const attribute of ["srcset", "style", "class", "id", "onclick", "onerror"]) {
        assert.ok(!policy.ALLOWED_ATTR.includes(attribute), attribute);
    }
    for (const url of ["javascript:alert(1)", "siyuan://blocks/id", "command:exec", "//localhost/api", "/api/unsafe", "#route", "data:text/html,test"]) {
        assert.equal(policy.ALLOWED_URI_REGEXP.test(url), false, url);
    }
    assert.equal(policy.ALLOW_DATA_ATTR, false);
    assert.equal(policy.ALLOW_ARIA_ATTR, false);
    assert.equal(policy.ALLOWED_URI_REGEXP.test("https://github.com/siyuan-note/siyuan/issues/21189"), true);
    assert.match(readFileSync("src/config/tabs/aboutTab.ts", "utf8"), /openChangelog\(true, event\.currentTarget as HTMLButtonElement\)/);
});

const setup = (shortTimeout = false) => {
    const requests: {resolve: (response: unknown) => void; reject: (error: unknown) => void; force: boolean; signal: AbortSignal}[] = [];
    const dialogs: {content: FakeElement; options: {title: string; width: string}}[] = [];
    class FakeElement {
        attributes = new Map<string, string>();
        children: FakeElement[] = [];
        innerHTML = "";
        textContent = "";
        href = "";
        className = "";
        style: {marginRight?: string} = {};
        content = {querySelectorAll: (): HTMLElement[] => []};
        replaceWith: (element: FakeElement) => void = () => undefined;
        setAttribute(name: string, value: string) { this.attributes.set(name, value); }
        getAttribute(name: string) { return this.attributes.get(name) ?? null; }
        removeAttribute(name: string) { this.attributes.delete(name); }
        append(...elements: FakeElement[]) { this.children.push(...elements); }
        querySelectorAll() { return this.children.filter(element => element.href); }
    }
    const button = () => {
        const icon = new FakeElement();
        const element = Object.assign(new FakeElement(), {disabled: false, isConnected: true, closing: false, currentIcon: icon,
            querySelector: () => element.currentIcon, closest: (): object | null => element.closing ? {} : null});
        icon.replaceWith = replacement => {
            element.currentIcon = replacement;
            replacement.replaceWith = original => { element.currentIcon = original; };
        };
        return element;
    };
    const window = {siyuan: {config: {system: {kernelVersion: "3.8.10-alpha.5"}}, languages: {
        changelog: "Changelog", siyuanNote: "SiYuan", changelogUnavailable: "Unavailable",
    }}, DOMPurify: {sanitize: () => "safe HTML"}};
    const timeout = {} as typeof import("../util/fetchTimeout");
    runInNewContext(compile("src/util/fetchTimeout.ts"), {exports: timeout, AbortController, DOMException, setTimeout, clearTimeout});
    const exports = {} as typeof import("./openChangelog");
    const dependencies: Record<string, unknown> = {
        "../util/fetch": {fetchSyncPost: (_url: string, data: {force: boolean}, _headers: unknown, process: boolean, signal: AbortSignal) => {
            assert.equal(process, false);
            return new Promise((resolve, reject) => requests.push({resolve, reject, force: data.force, signal}));
        }},
        "../dialog/mobileDialog": {MobileDialog: class {
            content = new FakeElement();
            element = {setAttribute() {}, querySelector: () => this.content};
            constructor(public options: {title: string; width: string}) { dialogs.push(this); }
        }},
        "../protyle/render/highlightRender": {highlightRender() {}},
        "../util/functions": {isMobile: () => false},
        "../constants": {Constants: {DIALOG_CHANGELOG: "changelog"}},
        "../util/hostCapabilities": {sanitizeKernelHTML: (html: string) => html},
        "../util/fetchTimeout": {withFetchTimeout: (request: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, ms: number) => {
            assert.equal(ms, 15000);
            return timeout.withFetchTimeout(request, signal, shortTimeout ? 10 : ms);
        }},
        "../util/escape": {escapeHtml: (value: string) => value},
    };
    runInNewContext(compile("src/boot/openChangelog.ts"), {exports, window,
        document: {createElement: () => new FakeElement()}, require: (name: string) => dependencies[name]});
    return {requests, dialogs, window, button,
        open: (force = true, trigger?: ReturnType<typeof button>) => exports.openChangelog(force, trigger as unknown as HTMLButtonElement)};
};

const settle = () => new Promise(resolve => setImmediate(resolve));
const successfulResponse = {code: 0, data: {show: true, version: "3.8.10-alpha.5", html: "<p>Changes</p>"}};

test("manual changelog swaps its icon, coalesces repeated clicks and restores exact state", async () => {
    const f = setup();
    const button = f.button();
    const icon = button.currentIcon;
    button.setAttribute("aria-busy", "false");
    const pending = f.open(true, button);
    await settle();
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.currentIcon.className, "b3-loading b3-loading--small");
    await f.open(true, button);
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve(successfulResponse);
    await pending;
    assert.equal(f.dialogs.length, 1);
    assert.equal(f.dialogs[0].content.innerHTML, "safe HTML");
    assert.equal(button.currentIcon, icon);
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-busy"), "false");
});

for (const failure of ["api", "network", "timeout", "not shown"]) {
    test(`manual changelog ${failure} restores the icon, shows the same release and permits retry`, async () => {
        const f = setup(failure === "timeout");
        const button = f.button();
        const icon = button.currentIcon;
        const pending = f.open(true, button);
        await settle();
        if (failure === "api") f.requests[0].resolve({code: -1, data: null});
        if (failure === "network") f.requests[0].reject(new Error("offline"));
        if (failure === "not shown") f.requests[0].resolve({code: 0, data: {show: false}});
        await pending;
        assert.equal(button.currentIcon, icon);
        assert.equal(button.disabled, false);
        assert.equal(button.getAttribute("aria-busy"), null);
        assert.equal(f.dialogs.length, 1);
        assert.equal(f.dialogs[0].content.children[0].textContent, "Unavailable");
        assert.equal(f.dialogs[0].content.children[1].href, "https://github.com/siyuan-note/siyuan/releases/tag/v3.8.10-alpha.5");
        if (failure === "timeout") {
            assert.equal(f.requests[0].signal.aborted, true);
            f.requests[0].resolve(successfulResponse);
            await settle();
            assert.equal(f.dialogs.length, 1);
        }
        const retry = f.open(true, button);
        await settle();
        assert.equal(f.requests.length, 2);
        f.requests[1].resolve(successfulResponse);
        await retry;
        assert.equal(f.dialogs.length, 2);
    });
}

test("startup, detached settings and kernel changes cannot open stale changelogs", async () => {
    const f = setup();
    let pending = f.open(false);
    await settle();
    assert.equal(f.requests[0].force, false);
    f.requests[0].resolve({code: 0, data: {show: false}});
    await pending;
    assert.equal(f.dialogs.length, 0);
    const removed = f.button();
    pending = f.open(true, removed);
    await settle();
    removed.isConnected = false;
    f.requests[1].resolve(successfulResponse);
    await pending;
    assert.equal(f.dialogs.length, 0);
    assert.equal(removed.disabled, false);
    pending = f.open(true, f.button());
    await settle();
    f.window.siyuan.config.system.kernelVersion = "3.8.10-alpha.6";
    f.requests[2].resolve(successfulResponse);
    await pending;
    assert.equal(f.dialogs.length, 0);
});

test("closing settings suppress late success and failure dialogs while their button remains connected", async () => {
    for (const response of [successfulResponse, {code: -1, data: null}]) {
        const f = setup();
        const button = f.button();
        const icon = button.currentIcon;
        const pending = f.open(true, button);
        await settle();
        button.closing = true;
        assert.equal(button.isConnected, true);
        f.requests[0].resolve(response);
        await pending;
        assert.equal(f.dialogs.length, 0);
        assert.equal(button.disabled, false);
        assert.equal(button.currentIcon, icon);
        await f.open(true, button);
        assert.equal(f.requests.length, 1);
    }
});

test("remounted settings share the pending request and only the current button opens a dialog", async () => {
    const f = setup();
    const oldButton = f.button();
    const oldPending = f.open(true, oldButton);
    await settle();
    oldButton.isConnected = false;
    const newButton = f.button();
    const newPending = f.open(true, newButton);
    await settle();
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve(successfulResponse);
    await Promise.all([oldPending, newPending]);
    assert.equal(f.dialogs.length, 1);
    assert.equal(newButton.disabled, false);
    assert.equal(oldButton.disabled, false);
});

test("changing kernel versions never shares another version's request or renders mismatched release notes", async () => {
    const f = setup();
    const oldPending = f.open(true, f.button());
    await settle();
    f.window.siyuan.config.system.kernelVersion = "3.8.10-alpha.6";
    const pending = f.open(true, f.button());
    await settle();
    assert.equal(f.requests.length, 2);
    f.requests[0].resolve(successfulResponse);
    await oldPending;
    assert.equal(f.dialogs.length, 0);
    f.requests[1].resolve(successfulResponse);
    await pending;
    assert.equal(f.dialogs.length, 1);
    assert.equal(f.dialogs[0].content.innerHTML, "");
    assert.equal(f.dialogs[0].content.children[1].href, "https://github.com/siyuan-note/siyuan/releases/tag/v3.8.10-alpha.6");
});

const browserCases = async (source: string, timeoutSource: string) => {
    const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const requests: {resolve: (response: unknown) => void; reject: (error: unknown) => void; force: boolean; signal: AbortSignal}[] = [];
    const dialogs: {element: HTMLElement; options: {width: string; title: string}}[] = [];
    let mobile = false;
    let shortTimeout = false;
    let localSanitizes = 0;
    window.siyuan = {config: {system: {kernelVersion: "3.8.10-alpha.5"}}, languages: {
        siyuanNote: "SiYuan", changelog: "Changelog", changelogUnavailable: "Unable to load the changelog",
    }} as unknown as ISiyuan;
    const timeout = {} as typeof import("../util/fetchTimeout");
    new Function("exports", timeoutSource)(timeout);
    const exports = {} as typeof import("./openChangelog");
    const dependencies: Record<string, unknown> = {
        "../util/fetch": {fetchSyncPost: (url: string, data: {force: boolean}, headers: unknown, process: boolean, signal: AbortSignal) => {
            check(url === "/api/system/getChangelog" && process === false, "explicit API result handling");
            return new Promise((resolve, reject) => requests.push({resolve, reject, force: data.force, signal}));
        }},
        "../dialog/mobileDialog": {MobileDialog: class {
            element = document.createElement("div");
            constructor(public options: {content: string; width: string; title: string}) {
                this.element.innerHTML = options.content;
                document.body.append(this.element);
                dialogs.push(this);
            }
        }},
        "../protyle/render/highlightRender": {highlightRender() {}},
        "../util/functions": {isMobile: () => mobile},
        "../constants": {Constants: {DIALOG_CHANGELOG: "changelog", SIYUAN_VERSION: "1.0.0-wrong-ui-version"}},
        "../util/hostCapabilities": {sanitizeKernelHTML: (html: string) => { localSanitizes++; return html; }},
        "../util/fetchTimeout": {withFetchTimeout: (request: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, ms: number) => {
            check(ms === 15000, "bounded UI request");
            return timeout.withFetchTimeout(request, signal, shortTimeout ? 20 : ms);
        }},
        "../util/escape": {escapeHtml: (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")},
    };
    new Function("exports", "require", source)(exports, (name: string) => dependencies[name]);
    const button = () => {
        const element = document.createElement("button");
        element.innerHTML = '<svg><use href="#iconFileText"></use></svg>Changelog';
        document.body.append(element);
        return element;
    };
    const success = (html = "<p>Current changes</p>") => ({code: 0, data: {show: true, version: window.siyuan.config.system.kernelVersion, html}});
    const trigger = button();
    trigger.setAttribute("aria-busy", "false");
    const originalIcon = trigger.querySelector("svg");
    let pending = exports.openChangelog(true, trigger);
    await tick();
    check(requests.length === 1 && trigger.disabled, "click starts one request and disables button");
    check(trigger.textContent === "Changelog" && !trigger.querySelector("svg"), "loading replaces only the icon");
    check(trigger.querySelector(".b3-loading.b3-loading--small")?.getAttribute("aria-hidden") === "true", "uses shared small spinner");
    check(trigger.getAttribute("aria-busy") === "true", "announces pending state");
    await exports.openChangelog(true, trigger);
    check(requests.length === 1, "duplicate click is ignored");
    requests[0].resolve(success("<h2>Changes</h2><strong>Safe</strong><script>window.changelogExecuted=true</script>" +
        '<a href="https://github.com/siyuan-note/siyuan/actions/workflows/cd.yml">' +
        '<img src="https://img.shields.io/github/actions/workflow/status/siyuan-note/siyuan/cd.yml" alt="Build status" width="120" height="30"' +
        ' style="cursor:pointer;height:30px" srcset="https://example.invalid/tracker 2x" onerror="alert(1)"></a>' +
        '<img src="http://example.invalid/badge.png" alt="HTTP badge">' +
        '<img src="data:image/svg+xml,%3Csvg%20onload%3D%22alert(1)%22%3E%3C/svg%3E" alt="Data image">' +
        '<img src="javascript:alert(1)"><img src="siyuan://blocks/unsafe"><img src="/api/unsafe"><img src="//localhost/api/unsafe">' +
        '<img src="file:///tmp/unsafe"><img src="blob:https://example.invalid/unsafe">' +
        '<iframe src="https://example.invalid"></iframe>' +
        '<a href="javascript:alert(1)">Script</a><a href="siyuan://blocks/unsafe">App</a><a href="/api/unsafe">Relative</a>' +
        '<p id="unsafe" style="background:url(https://example.invalid)" onclick="alert(1)" data-action="unsafe">Text</p>' +
        '<a href="https://github.com/siyuan-note/siyuan/issues/21189">Issue</a>'));
    await pending;
    check(dialogs.length === 1 && localSanitizes === 0, "local online content does not bypass sanitizer");
    const body = dialogs[0].element;
    check(!body.querySelector("script,iframe,[onclick],[onerror],img[style],p[style],[srcset],[data-action],#unsafe"), "unsafe HTML removed by real DOMPurify");
    const badge = body.querySelector<HTMLImageElement>('img[alt="Build status"]');
    check(badge?.getAttribute("src") === "https://img.shields.io/github/actions/workflow/status/siyuan-note/siyuan/cd.yml", "release badge image retained");
    check(badge?.getAttribute("width") === "120" && badge?.getAttribute("height") === "30", "image dimensions retained");
    check(badge?.parentElement.getAttribute("href") === "https://github.com/siyuan-note/siyuan/actions/workflows/cd.yml", "image link retained");
    check(body.querySelectorAll("img[src]").length === 2, "only HTTP and HTTPS image sources remain");
    check(body.querySelector('img[alt="HTTP badge"]')?.getAttribute("src") === "http://example.invalid/badge.png", "HTTP images retained");
    check(body.querySelector("strong")?.textContent === "Safe", "Markdown formatting retained");
    check(body.querySelectorAll("a[href]").length === 2, "only HTTP links remain");
    check(body.querySelector("a[href]").getAttribute("rel") === "noopener noreferrer", "outbound link isolates opener");
    check(trigger.querySelector("svg") === originalIcon && !trigger.disabled && trigger.getAttribute("aria-busy") === "false", "success restores exact original icon and state");

    for (const failure of ["api", "network", "timeout", "not shown"]) {
        const before = dialogs.length;
        const failedButton = button();
        const icon = failedButton.querySelector("svg");
        shortTimeout = failure === "timeout";
        pending = exports.openChangelog(true, failedButton);
        await tick();
        const request = requests.at(-1);
        if (failure === "api") request.resolve({code: -1, msg: "untrusted error", data: null});
        if (failure === "network") request.reject(new TypeError("offline"));
        if (failure === "not shown") request.resolve({code: 0, data: {show: false}});
        await pending;
        check(dialogs.length === before + 1, failure + " provides feedback");
        const failureDialog = dialogs.at(-1).element;
        check(failureDialog.textContent.includes("Unable to load"), failure + " has localized message");
        check(failureDialog.querySelector("a")?.href === "https://github.com/siyuan-note/siyuan/releases/tag/v3.8.10-alpha.5", failure + " links kernel version");
        check(failedButton.querySelector("svg") === icon && !failedButton.disabled && !failedButton.hasAttribute("aria-busy"), failure + " restores button");
        if (failure === "timeout") {
            check(request.signal.aborted, "timeout aborts network");
            request.resolve(success());
            await tick();
            check(dialogs.length === before + 1, "late timeout result does not open another dialog");
        }
        shortTimeout = false;
    }

    let before = dialogs.length;
    const removed = button();
    pending = exports.openChangelog(true, removed);
    await tick();
    removed.remove();
    requests.at(-1).resolve(success());
    await pending;
    check(dialogs.length === before && !removed.disabled, "removed settings cannot open a late dialog");

    for (const response of [success(), {code: -1, data: null}]) {
        const closing = document.createElement("div");
        const closingButton = button();
        document.body.append(closing);
        closing.append(closingButton);
        pending = exports.openChangelog(true, closingButton);
        await tick();
        closing.dataset.dialogClosing = "true";
        check(closingButton.isConnected, "closing animation retains the button");
        requests.at(-1).resolve(response);
        await pending;
        check(dialogs.length === before && !closingButton.disabled, "closing animation suppresses late success and failure");
        closing.remove();
    }

    const oldButton = button();
    const oldPending = exports.openChangelog(true, oldButton);
    await tick();
    const count = requests.length;
    oldButton.remove();
    const newButton = button();
    pending = exports.openChangelog(true, newButton);
    await tick();
    check(requests.length === count, "remounted settings share pending network request");
    requests.at(-1).resolve(success());
    await Promise.all([pending, oldPending]);
    check(dialogs.length === before + 1 && !newButton.disabled, "only current settings open one dialog");

    before = dialogs.length;
    pending = exports.openChangelog();
    await tick();
    check(requests.at(-1).force === false, "startup does not force a changelog");
    requests.at(-1).resolve({code: 0, data: {show: false}});
    await pending;
    check(dialogs.length === before, "prerelease startup stays silent");

    mobile = true;
    pending = exports.openChangelog(true, button());
    await tick();
    requests.at(-1).resolve(success('<img src="https://img.shields.io/badge/Mobile-test-blue" alt="Mobile badge">'));
    await pending;
    check(dialogs.at(-1).options.width === "92vw" && dialogs.at(-1).element.querySelector("img[src]")?.getAttribute("alt") === "Mobile badge", "mobile prerelease images use the same policy");

    window.siyuan.config.system.kernelVersion = "3.8.9";
    pending = exports.openChangelog(true, button());
    await tick();
    requests.at(-1).resolve(success("<p>Local stable</p>"));
    await pending;
    check(localSanitizes === 1 && dialogs.at(-1).options.width === "92vw", "stable logs retain local sanitizer and mobile dialog geometry");
};

test("changelog button lifecycle, safe rendering and failure links in a real browser", {skip: !process.env.CHROMIUM_PATH}, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-changelog-"));
    try {
        const html = path.join(directory, "index.html");
        const purify = readFileSync("stage/protyle/js/protyle-html.js", "utf8").split("\n").slice(0, 2).join("\n");
        const argument = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");
        writeFileSync(html, `<body><script>${purify}</script><script>
            const __name = value => value;
            (${browserCases.toString().replace(/<\/script/gi, "<\\/script")})(${argument(compile("src/boot/openChangelog.ts"))}, ${argument(compile("src/util/fetchTimeout.ts"))})
                .then(() => document.body.setAttribute("data-result", "passed"))
                .catch(error => document.body.setAttribute("data-error", error.stack));
        </script></body>`);
        const result = spawnSync(process.env.CHROMIUM_PATH, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
            "--dump-dom", "--virtual-time-budget=3000", `--user-data-dir=${path.join(directory, "profile")}`, `file://${html}`],
        {encoding: "utf8", timeout: 30000, env: {...process.env, HOME: directory, XDG_CONFIG_HOME: directory}});
        assert.equal(result.status, 0, result.error?.message || result.stderr);
        assert.match(result.stdout, /data-result="passed"/, result.stdout.match(/data-error="[^"]*/)?.[0] || result.stderr);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
