import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {compile} from "sass";
import {browserSources, runBrowserCase} from "../datePicker/test/browser";

test("inline code keeps its configured font and weight while combined bold marks take precedence", async () => {
    const sources = browserSources({assets: "src/util/assets.ts"});
    for (const theme of ["daylight", "midnight"]) {
        sources[theme] = readFileSync(`appearance/themes/${theme}/theme.css`, "utf8");
    }
    for (const entry of ["base", "mobile"]) {
        const css = compile(`src/assets/scss/${entry}.scss`, {logger: {warn() {}, debug() {}}}).css;
        const result = await runBrowserCase(async (sources, css) => {
            const check = (condition: boolean, message: string) => {
                if (!condition) throw new Error(message);
            };
            const style = document.createElement("style");
            style.textContent = css + ":root {--b3-font-family-code: monospace; --b3-font-family-emoji-reset: monospace}";
            document.head.append(style);
            const api = {} as typeof import("./assets");
            Object.assign(window, {siyuan: {config: {
                appearance: {}, editor: {fontSize: 32, codeFontFamilies: [{family: "monospace", weight: 500}]},
            }}});
            const fallback = new Proxy({}, {get: () => () => ""});
            new Function("exports", "require", sources.assets)(api, (id: string) => {
                if (id === "./hostCapabilities") return {getHostCapabilities: () => ({customAppearance: true})};
                if (id === "../protyle/util/compatibility") return {
                    isMac: () => false, isIPad: () => false, isIPhone: () => false,
                    isWin11: async () => false, resolvePlatformClass: () => "body--windows",
                };
                return fallback;
            });
            const dynamic = document.createElement("style");
            dynamic.textContent = await api.setInlineStyle(false);
            document.head.append(dynamic);
            const themeStyle = document.createElement("style");
            document.head.append(themeStyle);
            for (const theme of ["daylight", "midnight"]) {
                themeStyle.textContent = sources[theme];
                for (const container of ["protyle-wysiwyg", "b3-typography"]) {
                    const content = container === "protyle-wysiwyg" ?
                        '<span data-case data-type="code">code</span><span data-case data-type="code strong">bold code</span>' +
                        '<span data-case data-type="strong code">bold code</span>' :
                        '<code data-case>code</code><code><span data-case data-type="strong">bold code</span></code>' +
                        "<strong><code data-case>exported bold code</code></strong>";
                    document.body.innerHTML = `<div class="${container}">${content}</div>`;
                    const [code, ...bold] = document.querySelectorAll("[data-case]");
                    check(getComputedStyle(code).fontWeight === "500", "ordinary inline code keeps its configured weight");
                    for (const element of bold) {
                        check(getComputedStyle(element).fontWeight === "700", "bold wins regardless of mark order");
                        check(getComputedStyle(element).fontFamily.includes("monospace"), "code keeps its configured family");
                    }
                    document.querySelectorAll("[data-case]").forEach(element => element.setAttribute("data-type", "code"));
                    document.querySelectorAll("strong").forEach(element => element.replaceWith(...element.childNodes));
                    check([...document.querySelectorAll("[data-case]")].every(element => getComputedStyle(element).fontWeight === "500"),
                        "removing bold restores the configured weight");
                }
            }
            return "ok";
        }, sources, css);
        assert.equal(result.trim(), "ok");
    }
});
