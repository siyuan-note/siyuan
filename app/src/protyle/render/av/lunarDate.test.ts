import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {compileString} from "sass";

const browserCases = (sources: Record<string, string>, language: Record<string, unknown>, data: unknown, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const modules: Record<string, unknown> = {
        "../../../../../kernel/av/lunar_calendar_data.json": data,
        "./capabilities": {},
        "./cell": {},
        "./view": {},
        "../../../util/escape": {
            escapeAttr: (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
            escapeHtml: (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
        },
        "../../../dialog/message": {showMessage: () => {}},
    };
    Object.assign(window, {siyuan: {languages: language}});
    for (const [name, source] of Object.entries(sources)) {
        const exports = {};
        new Function("require", "exports", source)((name: string) => modules[name], exports);
        modules["./" + name] = exports;
    }
    const editor = modules["./lunarDate"] as typeof import("./lunarDate");
    const style = document.createElement("style");
    style.textContent = css + ".fn__none{display:none} body{margin:0} .b3-menu{max-width:100%;width:max-content}";
    document.head.append(style);
    const menu = document.createElement("div");
    menu.classList.add("b3-menu");
    document.body.append(menu);
    let updates: IAVCellDateValue[] = [];
    let closeCount = 0;
    let submit: () => void;
    const original: IAVCellDateValue = {
        content: new Date(2025, 6, 25, 14, 7, 35, 123).valueOf(), isNotEmpty: true, isNotTime: false,
        content2: new Date(2025, 6, 26, 15, 8, 45, 456).valueOf(), isNotEmpty2: true, hasEndDate: true,
    };
    const mount = (value = original, explicit = false) => {
        updates = [];
        menu.innerHTML = editor.getLunarDateHTML(value);
        submit = editor.bindLunarDateEditor({value, menuElement: menu, requireExplicitChange: explicit,
            update: value => updates.push(value), close: () => closeCount++});
    };
    const first = () => menu.querySelector<HTMLElement>("[data-lunar-endpoint]");
    const select = (part: string, value: string) => {
        const control = first().querySelector<HTMLSelectElement>(`[data-lunar-part="${part}"]`);
        control.value = value;
        control.dispatchEvent(new Event("change", {bubbles: true}));
    };
    mount();
    select("year", "2026");
    check.equal(first().querySelector<HTMLSelectElement>('[data-lunar-part="month"]').value, "");
    check.equal(first().querySelector<HTMLSelectElement>('[data-lunar-part="day"]').value, "");
    check.equal(first().querySelector("[data-lunar-error]").classList.contains("fn__none"), false);
    submit();
    check.equal(updates.length, 0, "invalid input keeps the stored date");
    select("month", "8");
    select("day", "15");
    submit();
    check.equal(updates[0].content, new Date(2026, 8, 25, 14, 7).valueOf());
    check.equal(updates[0].content2, original.content2, "editing the start preserves the end timestamp");
    mount();
    select("month", "6");
    select("day", "30");
    select("month", "-6");
    check.equal(first().querySelector<HTMLSelectElement>('[data-lunar-part="day"]').value, "");
    submit();
    check.equal(updates.length, 0, "a short month does not clamp the thirtieth day");
    mount();
    menu.querySelector<HTMLInputElement>("[data-lunar-end]").click();
    submit();
    check.equal(updates[0].content, original.content);
    check.equal(updates[0].content2, original.content2);
    check.equal(updates[0].hasEndDate, false);
    mount({content: new Date(1800, 0, 2).valueOf(), isNotEmpty: true, isNotTime: true});
    submit();
    check.equal(updates.length, 0, "old dates outside the conversion table remain unchanged");
    mount({isNotEmpty: false, isNotTime: true}, true);
    submit();
    check.equal(updates.length, 0, "cancelling empty input does not save the prefilled date");
    select("year", "2025");
    select("month", "-6");
    select("day", "1");
    submit();
    check.equal(updates[0].isNotEmpty2, false, "a disabled end date stays empty");
    mount();
    menu.querySelector<HTMLButtonElement>('[data-type="clearDate"]').click();
    submit();
    check.equal(updates.length, 1);
    check.equal(updates[0].isNotEmpty, false);
    check.equal(updates[0].isNotEmpty2, false);
    check.equal(closeCount, 1);
    mount();
    for (const control of Array.from(menu.querySelectorAll<HTMLElement>("input, select"))) {
        if (getComputedStyle(control).display === "none") {
            continue;
        }
        check.ok(control.getBoundingClientRect().right <= window.innerWidth, "controls fit a narrow viewport");
        const key = new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true});
        control.dispatchEvent(key);
        check.equal(key.defaultPrevented, false, "native control navigation remains available");
        if (control instanceof HTMLSelectElement) {
            const before = closeCount;
            control.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
            check.equal(closeCount, before, "Enter on a select confirms its option without closing the editor");
        }
    }
    return "Lunar date editor cases passed";
};

test("lunar date controls preserve dates, validate selections, and fit narrow layouts", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(["lunarCalendar", "dateFormat", "dateSubmit", "lunarDate"].map(name => [name,
        transpileModule(readFileSync(path.join(__dirname, name + ".ts"), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText]));
    const language = JSON.parse(readFileSync("appearance/langs/zh-CN.json", "utf8"));
    const data = JSON.parse(readFileSync("../kernel/av/lunar_calendar_data.json", "utf8"));
    const css = compileString(readFileSync("src/assets/scss/business/_av.scss", "utf8")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-lunar-date-test-"));
    const script = path.join(temporary, "run.cjs");
    const args = [sources, language, data, css].map(value => JSON.stringify(value)).join(",");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + args + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:320, height:700, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) {console.error(error); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, windowsHide: true, timeout: 40000,
        });
        assert.match(result.stdout, /Lunar date editor cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-lunar-date-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
