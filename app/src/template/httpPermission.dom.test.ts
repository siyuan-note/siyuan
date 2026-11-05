import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string, themes: string[], languages: Record<string, string>[]) => {
    const check: typeof assert = require("node:assert/strict");
    const theme = document.createElement("style");
    const styles = document.createElement("style");
    styles.textContent = css;
    document.head.append(theme, styles);
    let allowed: boolean | undefined;
    let revoked = 0;
    const exports = {} as typeof import("./httpPermission");
    new Function("exports", "require", source)(exports, (name: string) => name === "../util/fetch" ? {
        fetchSyncPost: async (_url: string, data: {action: string}) => {
            if (data.action === "revoke") { revoked++; allowed = false; }
            return {code: 0, data: {allowed}};
        },
    } : {clearTemplateHTTPConfirmations() {}});
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    let scenarios = 0;
    for (const themeCSS of themes) {
        theme.textContent = themeCSS;
        for (const language of languages) {
            window.siyuan = {languages: language} as unknown as typeof window.siyuan;
            for (const mobile of [false, true]) {
                for (const width of [180, 273]) {
                    for (const font of [14, 28]) {
                        const menu = document.createElement("div");
                        menu.className = `b3-menu${mobile ? " b3-menu--fullscreen" : ""}`;
                        menu.style.cssText = `position:static;width:${width}px;font-size:${font}px;--b3-font-size:${font}px`;
                        document.body.replaceChildren(menu);
                        for (const slot of ["template", "renderTemplate"] as const) {
                            for (const state of [undefined, false, true]) {
                                menu.innerHTML = `<div class="b3-menu__items"><textarea data-type="${slot === "template" ? "updateTemplate" : "updateRenderTemplate"}"></textarea>${exports.templateHTTPPermissionHTML(slot)}<button class="b3-menu__item" data-next>Next</button></div>`;
                                const textarea = menu.querySelector("textarea");
                                textarea.value = '.action{httpGet "https://example.com"}';
                                textarea.style.width = "100%";
                                textarea.style.boxSizing = "border-box";
                                const button = menu.querySelector<HTMLButtonElement>("[data-http-permission]");
                                const status = button.querySelector<HTMLElement>("[data-http-permission-status]");
                                allowed = state;
                                exports.bindTemplateHTTPPermission(menu, {kind: "av", avID: "database", keyID: "field", slot});
                                await tick();
                                check.equal(status.textContent, exports.templateHTTPPermissionLabel(state));
                                check.equal(button.disabled, state === false);
                                const bounds = button.getBoundingClientRect();
                                const action = button.querySelector<HTMLElement>(".b3-menu__label > span");
                                check.ok(status.getBoundingClientRect().top >= action.getBoundingClientRect().bottom - 1,
                                    "permission status has its own line below the action");
                                check.ok(button.scrollWidth <= button.clientWidth + 1, "permission text stays within the button");
                                for (const element of [action, status]) {
                                    const rect = element.getBoundingClientRect();
                                    check.ok(rect.left >= bounds.left && rect.right <= bounds.right + 1);
                                    check.ok(rect.bottom <= bounds.bottom + 1, "wrapped text is not clipped vertically");
                                    check.ok(element.scrollWidth <= element.clientWidth + 1, "long localized text wraps");
                                }
                                check.ok(menu.scrollWidth <= menu.clientWidth + 1, "the panel has no horizontal overflow");
                                check.ok(menu.querySelector("[data-next]").getBoundingClientRect().top >= bounds.bottom,
                                    "the following menu item is not covered");
                                if (state === true) {
                                    button.focus();
                                    check.equal(document.activeElement, button);
                                    const previous = revoked;
                                    button.click();
                                    await tick();
                                    check.ok(revoked > previous, "revocation remains available");
                                    check.equal(status.textContent, language.templateHTTPNotAllowed);
                                    check.equal(button.disabled, true);
                                    textarea.dispatchEvent(new Event("input"));
                                    check.equal(status.textContent, language.templateHTTPPermissionUnknown);
                                    check.equal(button.disabled, false);
                                }
                            }
                            scenarios++;
                        }
                    }
                }
            }
        }
    }
    return `Permission layout passed: ${scenarios} scenarios`;
};

test("database template permission actions wrap with their status on desktop and mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync("src/template/httpPermission.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const css = compile("src/assets/scss/util/_reset.scss").css + compile("src/assets/scss/component/_menu.scss").css +
        compile("src/assets/scss/component/_form.scss").css;
    const themes = ["daylight", "midnight"].map(name => readFileSync(`appearance/themes/${name}/theme.css`, "utf8"));
    const localized = ["en", "de", "zh-CN", "ja"].map(name => JSON.parse(readFileSync(`appearance/langs/${name}.json`, "utf8")));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-http-permission-layout-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");app.whenReady().then(async()=>{
const win=new BrowserWindow({show:false,width:800,height:700,webPreferences:{nodeIntegration:true,contextIsolation:false}});
try {await win.loadURL("data:text/html,<html><body></body></html>");
console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" + browserCases.toString() + ")(" +
        [source, css, themes, localized].map(value => JSON.stringify(value)).join(",") + ")")}));
win.destroy();app.exit(0);}catch(e){console.error(e);win.destroy();app.exit(1);}});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Permission layout passed: 128 scenarios/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-http-permission-layout-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
