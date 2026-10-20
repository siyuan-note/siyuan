import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as clipboardData from "./clipboardData";
import * as browserCompatibility from "./browserCompatibility";

const source = ts.transpileModule(readFileSync(join(process.cwd(), "src/protyle/util/compatibility.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

const createHarness = (richResult: boolean | void, plainResult: boolean | void = true) => {
    let html = "";
    let plain = "";
    let plainWrites = 0;
    const module = {exports: {}};
    runInNewContext(source, {
        module, exports: module.exports, console,
        require: (id: string) => id === "./clipboardData" ? clipboardData : {},
        window: {
            siyuan: {config: {system: {container: "harmony"}}, languages: {clipboardPermissionDenied: "Denied"}},
            JSHarmony: {
                writeHTMLClipboard: (text: string, value: string) => {
                    plain = text;
                    html = value;
                    return richResult;
                },
                writeSiYuanHTMLClipboard: () => { throw new Error("Legacy writer must not be used"); },
                writeClipboard: () => { plainWrites++; return plainResult; },
                readClipboard: () => plain,
                readHTMLClipboard: () => html,
                readSiYuanHTMLClipboard: () => "",
            },
        },
    });
    return {
        api: module.exports as typeof import("./compatibility"),
        getHTML: () => html,
        getPlainWrites: () => plainWrites,
        setHTML: (value: string) => { html = value; },
    };
};

describe("Harmony clipboard bridge", () => {
    const data = {
        textPlain: "剪切实验 😀",
        textHTML: "<p>剪切实验 😀</p>",
        textSiyuan: '<div data-type="NodeParagraph">剪切实验 😀</div>',
    };

    it("writes comment HTML readable through both system paste and the native bridge", async () => {
        const harness = createHarness(true);
        assert.equal((await harness.api.writeClipboardData(data)).status, "rich");
        assert.deepEqual(clipboardData.getTextSiyuanFromTextHTML(harness.getHTML()), {
            textHtml: data.textHTML, textSiyuan: data.textSiyuan,
        });
        const read = await harness.api.readClipboard();
        assert.equal(read.textPlain, data.textPlain);
        assert.equal(read.textHTML, data.textHTML);
        assert.equal(read.siyuanHTML, data.textSiyuan);
    });

    it("accepts void results from older shells", async () => {
        const harness = createHarness(undefined);
        assert.equal((await harness.api.writeClipboardData(data)).status, "rich");
    });

    it("reads legacy clipboard HTML without a visible separator", async () => {
        const harness = createHarness(true);
        harness.setHTML(data.textHTML + "__@text/siyuan@__" + data.textSiyuan);
        const read = await harness.api.readClipboard();
        assert.equal(read.textHTML, data.textHTML);
        assert.equal(read.siyuanHTML, data.textSiyuan);
    });

    it("reports failure without plain text fallback for cut", async () => {
        const harness = createHarness(false);
        assert.equal((await harness.api.writeClipboardData(data, {fallbackToPlainText: false})).status, "failed");
        assert.equal(harness.getPlainWrites(), 0);
    });

    it("reports failed fallback and allows successful plain text fallback for copy", async () => {
        assert.equal((await createHarness(false, false).api.writeClipboardData(data)).status, "failed");
        assert.equal((await createHarness(false, true).api.writeClipboardData(data)).status, "plain");
    });
});

const createPlatformHarness = (clientNavigator: {userAgent: string; platform: string; maxTouchPoints: number},
                               options: {browser?: boolean; container?: string} = {}) => {
    const classes = new Set<string>();
    const attributes: Record<string, string> = {};
    const module = {exports: {}};
    runInNewContext(source, {
        module, exports: module.exports, console,
        require: (id: string) => {
            if (id === "./clipboardData") {
                return clipboardData;
            }
            if (id === "./browserCompatibility") {
                return browserCompatibility;
            }
            if (id === "../../util/functions") {
                return {getFrontend: () => "desktop", isBrowser: () => Boolean(options.browser)};
            }
            return {};
        },
        navigator: clientNavigator,
        window: {
            siyuan: {
                config: {system: {container: options.container || "std"}},
                languages: {clipboardPermissionDenied: "Denied"},
            },
        },
        document: {
            body: {
                classList: {
                    toggle: (name: string, force?: boolean) => {
                        if (force) {
                            classes.add(name);
                        } else {
                            classes.delete(name);
                        }
                    },
                },
            },
            documentElement: {setAttribute: (name: string, value: string) => { attributes[name] = value; }},
        },
    });
    return {api: module.exports as typeof import("./compatibility"), classes, attributes};
};

describe("frontend platform classes", () => {
    const windowsUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
    const linuxUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
    const cases = [
        {
            name: "a HarmonyOS phone", expected: "body--harmony",
            navigator: {
                userAgent: "Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36  ArkWeb/4.1.6.1 Mobile",
                platform: "Linux armv8l", maxTouchPoints: 5,
            },
        },
        {
            name: "a HarmonyOS 2in1 device", expected: "body--harmony",
            navigator: {
                userAgent: "Mozilla/5.0 (PC; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36  ArkWeb/4.1.6.1",
                platform: "Linux x86_64", maxTouchPoints: 0,
            },
        },
        {
            name: "a HarmonyOS UA carrying an Android compatibility field", expected: "body--harmony",
            navigator: {
                userAgent: "Mozilla/5.0 (Linux; Android 12; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
                platform: "Linux armv8l", maxTouchPoints: 5,
            },
        },
        {
            name: "an older HarmonyOS built on an Android kernel", expected: "body--android",
            navigator: {
                userAgent: "Mozilla/5.0 (Linux; Android 10; HarmonyOS; AGS6-W09; HMSCore 6.16.4.352) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.0.0 Safari/537.36",
                platform: "Linux armv8l", maxTouchPoints: 5,
            },
        },
        {
            name: "an iPhone", expected: "body--ios",
            navigator: {
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
                platform: "iPhone", maxTouchPoints: 5,
            },
        },
        {
            name: "an iPad reporting a Macintosh platform", expected: "body--ios",
            navigator: {
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
                platform: "MacIntel", maxTouchPoints: 5,
            },
        },
        {
            name: "an Android client", expected: "body--android",
            navigator: {
                userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
                platform: "Linux armv8l", maxTouchPoints: 5,
            },
        },
        {
            name: "macOS", expected: "body--mac",
            navigator: {
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
                platform: "MacIntel", maxTouchPoints: 0,
            },
        },
        {name: "Windows", expected: "body--windows", navigator: {userAgent: windowsUA, platform: "Win32", maxTouchPoints: 0}},
        {name: "Linux", expected: "body--linux", navigator: {userAgent: linuxUA, platform: "Linux x86_64", maxTouchPoints: 0}},
    ];
    cases.forEach(item => {
        it(`resolves ${item.expected} for ${item.name}`, () => {
            assert.equal(createPlatformHarness(item.navigator).api.resolvePlatformClass(), item.expected);
        });
    });

    it("keeps the platform classes mutually exclusive and writes the frontend marker", () => {
        const harness = createPlatformHarness({userAgent: windowsUA, platform: "Win32", maxTouchPoints: 0}, {browser: true});
        harness.api.applyPlatformClasses();
        assert.deepEqual([...harness.classes].sort(), ["body--win32-browser", "body--windows"]);
        assert.equal(harness.attributes["data-frontend"], "desktop");
    });

    it("ignores the kernel container when resolving the platform", () => {
        const harness = createPlatformHarness({userAgent: windowsUA, platform: "Win32", maxTouchPoints: 0}, {container: "ios"});
        assert.equal(harness.api.resolvePlatformClass(), "body--windows");
    });

    it("keeps the legacy Electron class names for existing themes", () => {
        const harness = createPlatformHarness({userAgent: linuxUA, platform: "Linux x86_64", maxTouchPoints: 0});
        harness.api.applyPlatformClasses();
        assert.ok(harness.classes.has("body--linux"));
        assert.ok(harness.classes.has("body--win32"));
        assert.ok(!harness.classes.has("body--win32-browser"));
    });
});
