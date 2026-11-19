import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = (sources: Record<string, string>, language: Record<string, unknown>, data: unknown, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    // 只替代菜单外观和定位，保留独立菜单、移动端选择器及农历字段的真实事件处理。
    class MenuSurface {
        public removeCB?: () => void;
        constructor(public element: HTMLElement) {
            element.addEventListener("click", event => {
                if (typeof event.detail === "string" && event.detail === "back") {
                    this.remove();
                }
            });
        }
        remove() {
            const callback = this.removeCB;
            this.removeCB = undefined;
            callback?.();
            this.element.lastElementChild.innerHTML = "";
            this.element.classList.add("fn__none");
        }
        popup() {
            this.element.classList.remove("fn__none");
        }
        addItem(options: IMenu) {
            const element = document.createElement(options.type === "empty" ? "div" : "button");
            element.innerHTML = options.label;
            this.element.lastElementChild.append(element);
            options.bind?.(element);
            if (options.click) {
                element.addEventListener("click", (event: MouseEvent) => {
                    const keepOpen = options.click(element, event);
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    if (!keepOpen) {
                        this.remove();
                    }
                });
            }
        }
    }
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
        "../menus/Menu": {Menu: MenuSurface},
    };
    modules["../../util/escape"] = modules["../../../util/escape"];
    Object.assign(window, {siyuan: {languages: language}});
    for (const [name, source] of Object.entries(sources)) {
        const exports = {};
        new Function("require", "exports", source)((name: string) => modules[name], exports);
        modules["./" + name] = exports;
        if (name === "inline") { modules["../../../datePicker/inline"] = exports; }
        if (name === "overlayOwnership") {
            modules["../menus/overlayOwnership"] = exports;
            modules["../../menus/overlayOwnership"] = exports;
        }
        if (name === "pluginMenu") {
            modules["../../../plugin/Menu"] = exports;
            modules["../../plugin/Menu"] = exports;
        }
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
        check.ok(control.getBoundingClientRect().right <= window.innerWidth, "controls fit a narrow viewport: " + control.tagName + " " + control.getBoundingClientRect().right + "/" + innerWidth);
        const key = new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true});
        control.dispatchEvent(key);
        check.equal(key.defaultPrevented, false, "native control navigation remains available");
        if (control instanceof HTMLSelectElement) {
            const before: number = closeCount;
            control.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
            check.equal(closeCount, before, "Enter on a select confirms its option without closing the editor");
        }
    }
    mount({isNotEmpty: false, isNotTime: true}, true);
    const beforeConfirm = closeCount;
    menu.querySelector<HTMLButtonElement>("[data-lunar-confirm]").click();
    submit();
    check.equal(updates.length, 1, "confirm saves the prefilled date exactly once");
    check.equal(updates[0].isNotEmpty, true);
    check.equal(closeCount, beforeConfirm + 1);
    mount(original, true);
    select("year", "2026");
    const beforeInvalid = closeCount;
    menu.querySelector<HTMLButtonElement>("[data-lunar-confirm]").click();
    check.equal(updates.length, 0, "invalid confirmation preserves the stored value");
    check.equal(closeCount, beforeInvalid, "invalid confirmation keeps the editor open");

    for (const index of [0, 1]) {
        mount();
        const time = menu.querySelectorAll<HTMLInputElement>("[data-lunar-time]")[index];
        time.value = "14:07:99";
        time.dispatchEvent(new Event("input", {bubbles: true}));
        time.dispatchEvent(new Event("change", {bubbles: true}));
        if (index === 1) { menu.querySelector<HTMLInputElement>("[data-lunar-end]").click(); }
        const toggle = menu.querySelector<HTMLInputElement>("[data-lunar-include-time]");
        toggle.click();
        check.equal(toggle.checked, true, "invalid time cannot be hidden by changing to an all-day lunar date");
        check.equal(time.value, "14:07:99", "rejected lunar time toggle preserves invalid draft");
        submit();
        check.equal(updates.length, 0, "invalid visible or hidden lunar endpoint time is never normalized on submit");
    }

    const commonMenu = document.createElement("div");
    commonMenu.className = "b3-menu fn__none";
    commonMenu.innerHTML = '<div class="b3-menu__title"><span class="b3-menu__label"></span></div><div class="b3-menu__items"></div>';
    document.body.append(commonMenu);
    Object.assign(window.siyuan, {menus: {menu: new MenuSurface(commonMenu)}});
    const fieldEditor = modules["./fieldValueEditor"] as typeof import("./fieldValueEditor");
    const mobileSelect = modules["./nativeSelect"] as typeof import("../../../mobile/util/nativeSelect");
    const calendar = modules["./lunarCalendar"] as typeof import("./lunarCalendar");
    mobileSelect.initMobileSelect();
    const host = document.createElement("div");
    host.innerHTML = fieldEditor.getValueInputHTML({id: "birthday", name: "Birthday", type: "date", dateFormat: "lunar"},
        {mode: "static", value: {type: "date", date: {...original, isNotTime: true, hasEndDate: false}}});
    document.body.append(host);
    const fieldBinding = fieldEditor.bindFieldDates(host);
    const trigger = host.querySelector<HTMLButtonElement>("button");
    trigger.click();
    const parent = host.querySelector<HTMLElement>("[data-field-date-picker]");
    check.equal(document.querySelector('[data-menu="av-field-lunar-date"]'), null);
    const choose = (part: string, label: string) => {
        const select = parent.querySelector<HTMLSelectElement>(`[data-lunar-part="${part}"]`);
        select.click();
        const picker = mobileSelect.getMobileSelectMenuElement();
        const choice = Array.from(picker.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === label);
        check.ok(choice, "mobile date option exists");
        choice.click();
        check.equal(select.isConnected, true, "selecting a child menu preserves the parent form");
        check.equal(parent.isConnected, true);
        check.equal(!picker.isConnected || picker.classList.contains("fn__none"), true, "the option menu closes after selection");
    };
    choose("year", "2026");
    choose("month", calendar.getLunarMonthLabel(8));
    choose("day", calendar.getLunarDayLabel(15));
    parent.querySelector<HTMLButtonElement>("[data-lunar-confirm]").click();
    check.equal(parent.isConnected, true, "confirmation stays in the original field host");
    check.equal(parent.childElementCount, 0);
    check.equal(JSON.parse(trigger.dataset.lunarValue).content, new Date(2026, 8, 25).valueOf());

    trigger.click();
    const reopened = host.querySelector<HTMLElement>("[data-field-date-picker]");
    document.body.click();
    check.equal(reopened.childElementCount > 0, true, "outside clicks do not dismiss an embedded date draft");
    const year = reopened.querySelector<HTMLSelectElement>('[data-lunar-part="year"]');
    year.value = "2027";
    year.dispatchEvent(new Event("change", {bubbles: true}));
    check.equal(fieldBinding.submit(), true, "the business host can flush its pending lunar draft");
    check.equal(calendar.solarToLunar(JSON.parse(trigger.dataset.lunarValue).content).year, 2027);
    fieldBinding.destroy();
    host.remove();
    return "Lunar date editor cases passed";
};

test("lunar date controls preserve dates, validate selections, and fit narrow layouts", {
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(["model", "yearInput", "field", "inline", "lunarCalendar", "dateFormat", "dateSubmit", "lunarDate"].map(name => [name,
        transpileModule(readFileSync(path.join(__dirname, ["model", "yearInput", "field", "inline"].includes(name) ? "../../../datePicker/" + name + ".ts" : name + ".ts"), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText]));
    for (const [name, file] of Object.entries({overlayOwnership: "src/menus/overlayOwnership.ts", pluginMenu: "src/plugin/Menu.ts",
        nativeSelect: "src/mobile/util/nativeSelect.ts", fieldValueEditor: "src/protyle/render/av/fieldValueEditor.ts"})) {
        sources[name] = transpileModule(readFileSync(file, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
    }
    const language = JSON.parse(readFileSync("appearance/langs/zh-CN.json", "utf8"));
    const data = JSON.parse(readFileSync("../kernel/av/lunar_calendar_data.json", "utf8"));
    const css = compile("src/assets/scss/business/_av.scss").css + compile("src/assets/scss/component/_date-picker.scss").css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-lunar-date-test-"));
    const script = path.join(temporary, "run.cjs");
    const args = [sources, language, data, css].map(value => JSON.stringify(value)).join(",");
    const code = "const __name = value => value; (() => { try { return (" + browserCases.toString() + ")(" + args + "); } catch (error) { return error.stack; } })()";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, useContentSize:true, width:320, height:700, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.show();
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) {console.error(error); app.exit(1);}
});`, "utf8");
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CONFIG_HOME: path.join(temporary, "config"), XDG_CACHE_HOME: path.join(temporary, "cache"), XDG_DATA_HOME: path.join(temporary, "data")};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [...(process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless", "--ozone-override-screen-size=1200,1200"] : []), script], {
            env, windowsHide: true, timeout: 40000,
        });
        assert.match(result.stdout, /Lunar date editor cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-lunar-date-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
