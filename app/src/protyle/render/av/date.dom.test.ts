import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("date panels embed a shared calendar without changing range, batch, clear or host submission", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({model: join(__dirname, "../../../datePicker/model.ts"),
        yearInput: join(__dirname, "../../../datePicker/yearInput.ts"), field: join(__dirname, "../../../datePicker/field.ts"),
        inline: join(__dirname, "../../../datePicker/inline.ts"), dateSubmit: join(__dirname, "dateSubmit.ts"),
        date: join(__dirname, "date.ts"), datePanel: join(__dirname, "panels/date.ts")});
    sources.dayjs = readFileSync(require.resolve("dayjs"), "utf8");
    sources.icons = readFileSync("appearance/icons/litheness/icon.js", "utf8");
    sources.languages = readFileSync("appearance/langs/en.json", "utf8");
    const result = await runBrowserCase(async (source, css) => {
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
        };
        const updates: any[] = [];
        const initial = {content: new Date(2026, 1, 10, 12, 30).getTime(), content2: new Date(2026, 1, 20, 14, 45).getTime(),
            isNotEmpty: true, isNotEmpty2: true, hasEndDate: true, isNotTime: true};
        const dayjsModule = {exports: {}};
        new Function("module", "exports", source.dayjs)(dayjsModule, dayjsModule.exports);
        new Function(source.icons)();
        Object.assign(window, {siyuan: {languages: JSON.parse(source.languages)}});
        const modules: Record<string, any> = {dayjs: dayjsModule.exports,
            "./cell": {genCellValueByElement: () => ({date: initial}),
                updateCellsValue: (_protyle: unknown, _block: unknown, value: unknown) => updates.push(value)},
            "./view": {getFieldsByData: (): unknown[] => []}, "./lunarDate": {}, "../col": {getColId: () => "date"}, "../dateFormatMenu": {}};
        modules["../cell"] = modules["./cell"];
        for (const name of ["model", "yearInput", "field", "inline", "dateSubmit", "date", "datePanel"]) {
            const exports = modules["./" + name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path]);
            if (name === "inline") { modules["../../../datePicker/inline"] = exports; }
            if (name === "date") { modules["../date"] = exports; }
        }
        const style = document.createElement("style");
        style.textContent = css + "body{margin:0}.av__panel>.b3-menu{left:8px;top:8px;min-width:200px;max-width:calc(100vw - 16px)}";
        document.head.append(style);
        document.documentElement.dataset.frontend = "browser-mobile";
        const panel = document.createElement("div");
        panel.className = "av__panel";
        document.body.append(panel);
        const cell = document.createElement("div");
        let close: () => void;
        const mount = (explicit = false) => {
            panel.innerHTML = '<div class="b3-menu">' + modules["./date"].getDateHTML([cell]) + "</div>";
            close = modules["./date"].bindDateEvent({menuElement: panel.querySelector(".b3-menu"), cellElements: [cell],
                data: {}, requireExplicitChange: explicit});
            return panel.querySelectorAll<HTMLInputElement>("input");
        };
        let inputs = mount(true);
        equal(panel.querySelectorAll(".date-picker__calendar").length, 1, "Range shares one calendar");
        equal(panel.querySelectorAll(".b3-dialog__container, .date-picker__fields, .date-picker__shortcuts").length, 0, "No extra surface, fields or clear");
        inputs[1].focus();
        equal(updates.length, 0, "Focusing endpoint does not save batch prefill");
        close();
        equal(updates.length, 0, "Batch close without edits does not save");
        inputs = mount(true);
        inputs[1].focus();
        panel.querySelector<HTMLButtonElement>('button[data-date="2026-02-21"]').click();
        equal(updates.length, 0, "Calendar selection updates draft, not database transaction");
        close();
        equal(updates.length, 1, "Host close saves once");
        equal(updates[0].content, new Date(2026, 1, 10).getTime(), "Start is unchanged");
        equal(updates[0].content2, new Date(2026, 1, 21).getTime(), "Selected end is saved");
        close();
        equal(updates.length, 1, "Repeated close is idempotent");
        inputs = mount();
        inputs[3].click();
        equal(inputs[0].dataset.datePickerType, "datetime-local", "Include-time updates semantic type");
        equal(inputs[0].type, "text", "Include-time never restores a system picker");
        equal(inputs[0].value, "2026-02-10 12:30", "Time toggle restores cached time");
        inputs[3].click();
        equal(inputs[0].value, "2026-02-10", "All-day toggle restores date only");
        inputs[2].click();
        equal(inputs[1].classList.contains("fn__none"), true, "End switch hides only its endpoint");
        inputs[2].click();
        equal(inputs[1].value, "2026-02-20", "Hidden endpoint value is preserved");
        inputs[0].value = "2026-02-31";
        inputs[0].dispatchEvent(new Event("input", {bubbles: true}));
        close();
        equal(updates.length, 1, "Invalid text cannot be saved on close");
        equal(inputs[0].value, "2026-02-31", "Closing does not turn invalid draft into empty");
        inputs = mount();
        const menu = panel.querySelector<HTMLElement>(".b3-menu");
        const clear = panel.querySelector<HTMLElement>('[data-type="clearDate"]');
        modules["./datePanel"].datePanel.actions.clearDate({options: {cellElements: [cell]},
            menuElement: menu, avPanelElement: panel, data: {}, fields: [{id: "date", date: {fillSpecificTime: true}}]},
        {target: clear, event: new Event("click")});
        equal(updates.length, 2, "Existing business clear writes once");
        equal(updates[1].isNotEmpty, false, "Business clear clears start");
        equal(updates[1].isNotEmpty2, false, "Business clear clears end");
        equal(updates[1].hasEndDate, false, "Business clear disables end");
        equal(updates[1].isNotTime, false, "Business clear retains column time default");
        document.body.append(panel);
        for (const fireChange of [false, true]) {
            for (const endpoint of [0, 1]) {
                inputs = mount();
                const before = updates.length;
                inputs[endpoint].value = "2026-02-30";
                inputs[endpoint].dispatchEvent(new Event("input", {bubbles: true}));
                if (fireChange) { inputs[endpoint].dispatchEvent(new Event("change", {bubbles: true})); }
                if (endpoint === 1) { inputs[2].click(); }
                inputs[3].click();
                equal(inputs[3].checked, false, "Invalid start or hidden end draft blocks include-time toggle");
                equal(inputs[endpoint].value, "2026-02-30", "Time toggle never sanitizes invalid text into empty");
                inputs[3].click();
                equal(inputs[endpoint].value, "2026-02-30", "Repeated time toggles preserve invalid text");
                close();
                equal(updates.length, before, "Invalid drafts cannot clear or normalize either stored endpoint on close");
            }
        }
        inputs = mount();
        inputs[3].click();
        const beforeSeconds = updates.length;
        inputs[0].value = "2026-02-10T12:30:99";
        inputs[0].dispatchEvent(new Event("input", {bubbles: true}));
        inputs[0].dispatchEvent(new Event("change", {bubbles: true}));
        inputs[3].click();
        equal(inputs[3].checked, true, "Invalid seconds cannot be truncated into a valid all-day date");
        equal(inputs[0].value, "2026-02-10T12:30:99", "Invalid seconds survive the rejected toggle");
        close();
        equal(updates.length, beforeSeconds, "Invalid seconds never change stored dates");
        inputs = mount();
        inputs[0].value = "2026-02-14";
        inputs[0].dispatchEvent(new Event("input", {bubbles: true}));
        inputs[3].click();
        equal(inputs[0].value, "2026-02-14 00:00", "Time toggle retains a valid draft before its change or blur event");
        inputs[3].click();
        equal(inputs[0].value, "2026-02-14", "A valid input-only draft survives a time round trip");
        close();
        equal(updates.at(-1).content, new Date(2026, 1, 14).getTime(), "Valid unblurred draft saves the edited date");
        inputs = mount();
        inputs[1].focus();
        equal(panel.querySelector(".b3-menu").getBoundingClientRect().right <= innerWidth, true, "Date panel fits narrow viewport");
        equal(Array.from(panel.querySelectorAll("button[data-date]")).every(button => button.getBoundingClientRect().right <= innerWidth), true,
            "Calendar cells fit narrow viewport");
        for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>(".date-picker__navigation .block__icon"))) {
            equal(button.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}), true, "Date panel navigation is visible");
            const rect = button.querySelector("use").getBBox();
            equal(rect.width > 0 && rect.height > 0, true, "Date panel navigation paints real icons");
        }
        return "date panel inline cases passed";
    }, sources, readFileSync("appearance/themes/daylight/theme.css", "utf8") + compile("src/assets/scss/base.scss").css, {width: 320, height: 740,
        interact: async win => {
            await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
            const image = await win.webContents.capturePage();
            // 交互回调在临时目录的 Electron 脚本中执行。
            require("node:fs").writeFileSync(require("node:path").join(__dirname, "date-panel-inline-320.png"), image.toPNG());
            return "date panel inline cases passed";
        }});
    assert.match(result, /date panel inline cases passed/);
});
