import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import type {IInlineStyle, IInlineStyleBuiltin, IInlineStyleOrder} from "./inlineStyle";

let inlineStyle: typeof import("./inlineStyle");

it("renders both formats with content overrides while preserving interface colors", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const data = inlineStyle.normalizeInlineStyles({version: 2, styles: [], builtin: {
        colors: [], hidden: {}, styles: [{id: "info",
            light: {color: "#112233", backgroundColor: "#ddeeff"},
            dark: {color: "#445566", backgroundColor: "#778899"}}],
    }});
    const html = `<style>:root {--b3-card-info-color: #010203; --b3-card-info-background: #040506;}</style>
<style id="siyuanStyle">${inlineStyle.getInlineStylesCSS(data)}</style>
<button id="interface" style="color:var(--b3-card-info-color);background-color:var(--b3-card-info-background)">UI</button>` +
        ["protyle-wysiwyg", "b3-typography"].map(className => `<div class="${className}">` +
            [
                "color:var(--b3-card-info-color);background-color:var(--b3-card-info-background)",
                "color:var(--b3-inline-builtin-info-color, var(--b3-card-info-color));" +
                    "background-color:var(--b3-inline-builtin-info-background-color, var(--b3-card-info-background))",
            ].map(style => `<span class="content" style="${style}">A</span>`).join("") + "</div>").join("");
    const cases = () => {
        const check = (element: Element, color: string, background: string) => {
            const style = getComputedStyle(element);
            if (style.color !== color || style.backgroundColor !== background) {
                throw new Error(`${element.outerHTML}: ${style.color}, ${style.backgroundColor}`);
            }
        };
        for (const mode of ["light", "dark"]) {
            document.documentElement.setAttribute("data-theme-mode", mode);
            document.querySelectorAll(".content").forEach(element => check(element,
                mode === "light" ? "rgb(17, 34, 51)" : "rgb(68, 85, 102)",
                mode === "light" ? "rgb(221, 238, 255)" : "rgb(119, 136, 153)"));
            check(document.getElementById("interface"), "rgb(1, 2, 3)", "rgb(4, 5, 6)");
        }
        (document.getElementById("siyuanStyle") as HTMLStyleElement).disabled = true;
        document.querySelectorAll(".content").forEach(element => check(element, "rgb(1, 2, 3)", "rgb(4, 5, 6)"));
    };
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-inline-style-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {offscreen: true}});
    try {
        await win.loadURL("data:text/html," + encodeURIComponent(${JSON.stringify(html)}));
        await win.webContents.executeJavaScript(${JSON.stringify(`const __name = value => value; (${cases.toString()})()`)});
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 25000, windowsHide: true});
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});

before(async () => {
    Object.assign(globalThis, {
        NODE_ENV: "test",
        SIYUAN_VERSION: "test",
    });
    inlineStyle = await import("./inlineStyle");
});

const combinedStyle: IInlineStyle = {
    id: "20260821120000-abcdefg",
    name: "Combined",
    light: {
        color: "#112233",
        backgroundColor: "#ddeeff",
    },
    dark: {
        color: "#fefefe",
        backgroundColor: "#223344",
    },
};

const defaultOrder = (styles: IInlineStyle[] = []): IInlineStyleOrder => {
    const order: IInlineStyleOrder = {
        color: [...inlineStyle.DEFAULT_INLINE_STYLE_ORDER.color],
        backgroundColor: [...inlineStyle.DEFAULT_INLINE_STYLE_ORDER.backgroundColor],
        style1: [...inlineStyle.DEFAULT_INLINE_STYLE_ORDER.style1],
    };
    styles.forEach(style => {
        const type = inlineStyle.getInlineStyleType(style);
        if (type && !order[type].includes(style.id)) {
            order[type].push(style.id);
        }
    });
    return order;
};

const emptyBuiltin: IInlineStyleBuiltin = {
    colors: [],
    styles: [],
    hidden: {
        color: [],
        backgroundColor: [],
        style1: [],
        av: [],
    },
};

describe("normalizeInlineStyles", () => {
    it("keeps paired light and dark colors and removes invalid data", () => {
        assert.deepEqual(inlineStyle.normalizeInlineStyles({
            version: 9,
            styles: [combinedStyle, {
                id: combinedStyle.id,
                name: "Duplicate",
                light: {color: "#ffffff"},
                dark: {color: "#000000"},
            }, {
                id: "20260821120001-bbcdefg",
                name: " Background ",
                light: {color: "invalid", backgroundColor: "#AABBCC"},
                dark: {backgroundColor: "#001122"},
            }, {
                id: "invalid-id",
                name: "Invalid",
                light: {color: "#ffffff"},
                dark: {color: "#000000"},
            }],
        }), {
            version: 2,
            builtin: emptyBuiltin,
            styles: [combinedStyle, {
                id: "20260821120001-bbcdefg",
                name: "Background",
                light: {backgroundColor: "#aabbcc"},
                dark: {backgroundColor: "#001122"},
            }],
            order: defaultOrder([combinedStyle, {
                id: "20260821120001-bbcdefg",
                name: "Background",
                light: {backgroundColor: "#aabbcc"},
                dark: {backgroundColor: "#001122"},
            }]),
            av: inlineStyle.INLINE_STYLE_EMPTY.av,
        });
    });

    it("normalizes built-in overrides and hidden entries", () => {
        assert.deepEqual(inlineStyle.normalizeInlineStyles({
            version: 2,
            builtin: {
                colors: [{
                    index: 2,
                    light: {color: "#AABBCC", backgroundColor: "#123456"},
                    dark: {color: "#001122"},
                }, {
                    index: 2,
                    light: {color: "#ffffff"},
                    dark: {color: "#000000"},
                }, {
                    index: 15,
                    light: {color: "#ffffff"},
                    dark: {color: "#000000"},
                }, {
                    index: 14,
                    light: {color: "#ffffff"},
                    dark: {color: "#000000"},
                }],
                styles: [{
                    id: "warning",
                    light: {color: "#FEDCBA", backgroundColor: "#123456"},
                    dark: {color: "#ABCDEF", backgroundColor: "invalid"},
                }, {
                    id: "unknown",
                    light: {color: "#ffffff"},
                    dark: {color: "#000000"},
                }],
                hidden: {
                    color: [3, 1, 3, 0, 14],
                    backgroundColor: [13],
                    style1: ["success", "unknown", "error", "success"],
                    av: [2, 13, 99],
                },
            },
            styles: [],
        }), {
            version: 2,
            builtin: {
                colors: [{
                    index: 2,
                    light: {color: "#aabbcc"},
                    dark: {color: "#001122"},
                }, {
                    index: 14,
                    light: {color: "#ffffff"},
                    dark: {color: "#000000"},
                }],
                styles: [{
                    id: "warning",
                    light: {color: "#fedcba"},
                    dark: {color: "#abcdef"},
                }],
                hidden: {
                    color: [1, 3],
                    backgroundColor: [13],
                    style1: ["error", "success"],
                    av: [2, 13],
                },
            },
            styles: [],
            order: defaultOrder(),
            av: inlineStyle.INLINE_STYLE_EMPTY.av,
        });
    });

    it("keeps mixed built-in and custom order and appends missing keys", () => {
        const custom = {
            ...combinedStyle,
            id: "20260821120003-dbcdefg",
            name: "Accent",
            light: {color: "#112233"},
            dark: {color: "#fefefe"},
        };
        const normalized = inlineStyle.normalizeInlineStyles({
            styles: [custom],
            order: {
                color: ["2", custom.id, "1", "2", "unknown", "14"],
                backgroundColor: ["13"],
                style1: ["success", "missing"],
            },
        });
        assert.deepEqual(normalized.order.color.slice(0, 3), ["2", custom.id, "1"]);
        assert.equal(normalized.order.color[normalized.order.color.length - 1], "13");
        assert.deepEqual(normalized.order.backgroundColor.slice(0, 2), ["13", "1"]);
        assert.deepEqual(normalized.order.style1, ["success", "error", "warning", "info"]);
    });

    it("limits names by Unicode code points without splitting surrogate pairs", () => {
        const normalized = inlineStyle.normalizeInlineStyles({
            version: 1,
            styles: [{
                id: "20260821120002-cbcdefg",
                name: "😀".repeat(65),
                light: {color: "#ffffff"},
                dark: {color: "#000000"},
            }],
        });
        assert.equal([...normalized.styles[0].name].length, 64);
        assert.equal(normalized.styles[0].name.endsWith("😀"), true);
    });
});

describe("inline style values", () => {
    it("infers the legacy appearance type from available properties", () => {
        assert.equal(inlineStyle.getInlineStyleType(combinedStyle), "style1");
        assert.equal(inlineStyle.getInlineStyleType({...combinedStyle, light: {color: "#112233"}, dark: {color: "#ffffff"}}), "color");
        assert.equal(inlineStyle.getInlineStyleType({
            ...combinedStyle,
            light: {backgroundColor: "#ddeeff"},
            dark: {backgroundColor: "#223344"},
        }), "backgroundColor");
    });

    it("encodes combined styles as background then foreground", () => {
        const encoded = inlineStyle.encodeStyle1("#ddeeff", "#112233");
        assert.equal(encoded, "#ddeeff\u200b#112233");
        assert.deepEqual(inlineStyle.decodeStyle1(encoded), {
            backgroundColor: "#ddeeff",
            color: "#112233",
        });
    });

    it("builds variable references with current-mode fallbacks", () => {
        assert.deepEqual(inlineStyle.getInlineStyleApplication(combinedStyle, "dark"), {
            type: "style1",
            color: "var(--b3-inline-style-20260821120000-abcdefg-background-color, #223344)" +
                "\u200b" +
                "var(--b3-inline-style-20260821120000-abcdefg-color, #fefefe)",
        });
    });
});

describe("getInlineStylesCSS", () => {
    it("generates isolated light and dark variables", () => {
        assert.equal(inlineStyle.getInlineStylesCSS({version: 2, builtin: emptyBuiltin,
            styles: [combinedStyle]}), `:root[data-theme-mode="light"] {
  --b3-inline-style-20260821120000-abcdefg-color: #112233;
  --b3-inline-style-20260821120000-abcdefg-background-color: #ddeeff;
}
:root[data-theme-mode="dark"] {
  --b3-inline-style-20260821120000-abcdefg-color: #fefefe;
  --b3-inline-style-20260821120000-abcdefg-background-color: #223344;
}`);
    });

    it("overrides numbered colors and scopes semantic theme variables to content", () => {
        assert.equal(inlineStyle.getInlineStylesCSS({
            version: 2,
            builtin: {
                colors: [{
                    index: 2,
                    light: {color: "#112233", backgroundColor: "#ddeeff"},
                    dark: {color: "#fefefe", backgroundColor: "#223344"},
                }],
                styles: [{
                    id: "error",
                    light: {color: "#330000", backgroundColor: "#ffeeee"},
                    dark: {color: "#ffdddd", backgroundColor: "#440000"},
                }],
                hidden: emptyBuiltin.hidden,
            },
            styles: [],
        }), `:root[data-theme-mode="light"] {
  --b3-font-color2: #112233;
  --b3-font-background2: #ddeeff;
}
:root[data-theme-mode="light"] .protyle-wysiwyg,
:root[data-theme-mode="light"] .b3-typography {
  --b3-card-error-color: #330000;
  --b3-card-error-background: #ffeeee;
}
:root[data-theme-mode="dark"] {
  --b3-font-color2: #fefefe;
  --b3-font-background2: #223344;
}
:root[data-theme-mode="dark"] .protyle-wysiwyg,
:root[data-theme-mode="dark"] .b3-typography {
  --b3-card-error-color: #ffdddd;
  --b3-card-error-background: #440000;
}`);
    });
});

describe("recent inline styles", () => {
    it("deduplicates old and new built-in expressions", () => {
        const current = "style1\u200b" + inlineStyle.getBuiltinInlineStyleApplication("info").color;
        const previous = "style1\u200bvar(--b3-inline-builtin-info-background-color, var(--b3-card-info-background))" +
            "\u200bvar(--b3-inline-builtin-info-color, var(--b3-card-info-color))";
        assert.equal(inlineStyle.getRecentInlineStyleKey(previous), inlineStyle.getRecentInlineStyleKey(current));
        assert.notEqual(inlineStyle.getRecentInlineStyleKey(current),
            inlineStyle.getRecentInlineStyleKey("style1\u200b" + inlineStyle.getBuiltinInlineStyleApplication("error").color));
    });
    it("extracts a stable preset ID and ignores changing fallbacks", () => {
        const first = "color\u200b" +
            "var(--b3-inline-style-20260821120000-abcdefg-color, #112233)";
        const second = "color\u200b" +
            "var(--b3-inline-style-20260821120000-abcdefg-color, #445566)";
        assert.equal(inlineStyle.getInlineStyleIDFromValue(first), combinedStyle.id);
        assert.equal(inlineStyle.getRecentInlineStyleKey(first), inlineStyle.getRecentInlineStyleKey(second));
    });

    it("filters hidden built-in colors without removing defaults or custom styles", () => {
        const data = inlineStyle.normalizeInlineStyles({
            builtin: {
                hidden: {
                    color: [3],
                    backgroundColor: [4],
                    style1: ["error"],
                    av: [5],
                },
            },
            styles: [combinedStyle],
        });
        const custom = "color\u200bvar(--b3-inline-style-20260821120000-abcdefg-color, #112233)";
        const values = [
            "color\u200bvar(--b3-font-color3)",
            "color\u200bvar(--b3-font-color2)",
            "backgroundColor\u200bvar(--b3-font-background4)",
            "style1\u200bvar(--b3-card-error-background)\u200bvar(--b3-card-error-color)",
            "style1\u200bvar(--b3-inline-builtin-warning-background-color, var(--b3-card-warning-background))" +
                "\u200bvar(--b3-inline-builtin-warning-color, var(--b3-card-warning-color))",
            "color\u200b",
            custom,
        ];
        assert.deepEqual(inlineStyle.filterHiddenRecentInlineStyles(values, data), [
            values[1],
            values[4],
            values[5],
            custom,
        ]);
        assert.deepEqual(inlineStyle.getVisibleBuiltinColorIndexes("av", data),
            [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
        assert.deepEqual(inlineStyle.getVisibleOrderedStyleKeys("color", data),
            ["1", "2", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"]);
        assert.deepEqual(inlineStyle.getVisibleOrderedStyleKeys("style1", {
            ...data,
            order: {
                ...data.order,
                style1: ["success", "error", "warning", "info", combinedStyle.id],
            },
        }), ["success", "warning", "info", combinedStyle.id]);
        assert.deepEqual(inlineStyle.getVisibleOrderedStyleKeys("style1", {
            ...data,
            styles: [{...combinedStyle, hidden: true}],
            order: {
                ...data.order,
                style1: ["success", "error", "warning", "info", combinedStyle.id],
            },
        }), ["success", "warning", "info"]);
    });
});

describe("built-in semantic styles", () => {
    it("previews each mode independently without persisting literal colors", () => {
        const data = inlineStyle.normalizeInlineStyles({version: 2, styles: [], builtin: {
            ...emptyBuiltin,
            styles: [{id: "info", light: {color: "#112233"}, dark: {color: "#ddeeff"}}],
        }});
        assert.deepEqual(inlineStyle.getBuiltinInlineStylePreview("info", "light", data), {
            color: "#112233", backgroundColor: "var(--b3-card-info-background)",
        });
        assert.deepEqual(inlineStyle.getBuiltinInlineStylePreview("info", "dark", data), {
            color: "#ddeeff", backgroundColor: "var(--b3-card-info-background)",
        });
        assert.equal(inlineStyle.getBuiltinInlineStyleApplication("info").color,
            "var(--b3-card-info-background)\u200bvar(--b3-card-info-color)");
        assert.equal(inlineStyle.getBuiltinInlineStylePreview("info", "light").color,
            "var(--b3-card-info-color)");
    });
    it("writes original theme variables without overrides", () => {
        assert.deepEqual(inlineStyle.getBuiltinInlineStyleApplication("info"), {
            type: "style1",
            color: "var(--b3-card-info-background)" +
                "\u200bvar(--b3-card-info-color)",
        });
        assert.deepEqual(inlineStyle.getBuiltinInlineStylePreview("success", "light"), {
            color: "var(--b3-card-success-color)",
            backgroundColor: "var(--b3-card-success-background)",
        });
    });
});
