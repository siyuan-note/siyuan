import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("mobile date panels settle after opening, preserve editing and release observers on close", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({
        model: join(__dirname, "../../../datePicker/model.ts"),
        yearInput: join(__dirname, "../../../datePicker/yearInput.ts"),
        field: join(__dirname, "../../../datePicker/field.ts"),
        inline: join(__dirname, "../../../datePicker/inline.ts"),
        dateSubmit: join(__dirname, "dateSubmit.ts"),
        date: join(__dirname, "date.ts"),
        lunarDate: join(__dirname, "lunarDate.ts"),
        lunarCalendar: join(__dirname, "lunarCalendar.ts"),
        dateFormat: join(__dirname, "dateFormat.ts"),
        menuGroup: join(__dirname, "../../../menus/menuGroup.ts"),
        sheetOpen: join(__dirname, "../../../menus/sheetOpen.ts"),
        sheetActions: join(__dirname, "../../../menus/sheetActions.ts"),
        mobileSheetGesture: join(__dirname, "../../../mobile/util/mobileSheetGesture.ts"),
        escape: join(__dirname, "../../../util/escape.ts"),
        mobilePanel: join(__dirname, "mobilePanel.ts"),
    });
    sources.dayjs = readFileSync(require.resolve("dayjs"), "utf8");
    sources.languages = readFileSync("appearance/langs/en.json", "utf8");
    sources.lunarData = readFileSync("../kernel/av/lunar_calendar_data.json", "utf8");
    const result = await runBrowserCase(async (source, css) => {
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
        };
        const observers = new Set<MutationObserver>();
        const NativeObserver = window.MutationObserver;
        let callbacks = 0;
        let deliveries = 0;
        let runaway = false;
        window.MutationObserver = class extends NativeObserver {
            constructor(callback: MutationCallback) {
                super((records, observer) => {
                    callbacks++;
                    // 微任务反馈循环会阻塞计时器，必须在回调内停止，防止失败用例挂起浏览器。
                    if (++deliveries > 80) {
                        runaway = true;
                        Array.from(observers).forEach(item => item.disconnect());
                        return;
                    }
                    callback(records, observer);
                });
            }

            observe(target: Node, options?: MutationObserverInit) {
                if (runaway) { return; }
                observers.add(this);
                super.observe(target, options);
            }

            disconnect() {
                observers.delete(this);
                super.disconnect();
            }
        };
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        let fields = 0;
        const settle = async (message: string) => {
            deliveries = 0;
            await frame();
            equal(runaway, false, `${message}: observer delivery must be bounded`);
            const before = {fields, callbacks};
            await frame();
            await frame();
            equal(fields, before.fields, `${message}: idle must not recreate calendars`);
            equal(callbacks, before.callbacks, `${message}: idle must not deliver more mutations`);
        };
        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
        document.documentElement.dataset.frontend = "browser-mobile";
        document.body.innerHTML = '<div id="sidebar"></div><div id="cell"></div>';
        Object.assign(window, {siyuan: {languages: JSON.parse(source.languages),
            mobile: {size: {isLandscape: false, portrait: {height1: innerHeight}}}}});
        const initial = {content: 0, content2: 0, isNotEmpty: false, isNotEmpty2: false,
            hasEndDate: false, isNotTime: true};
        const updates: any[] = [];
        const dayjs = {exports: {}};
        new Function("module", "exports", source.dayjs)(dayjs, dayjs.exports);
        const modules: Record<string, any> = {dayjs: dayjs.exports,
            "lunar_calendar_data.json": JSON.parse(source.lunarData),
            cell: {genCellValueByElement: () => ({date: initial}),
                updateCellsValue: (_protyle: unknown, _block: unknown, value: unknown) => updates.push(value)},
            view: {getFieldsByData: (): unknown[] => []},
            capabilities: {isAVDateType: () => true}, message: {showMessage() {}}};
        for (const name of ["model", "yearInput", "field", "inline", "dateSubmit", "escape", "lunarCalendar",
            "dateFormat", "lunarDate", "date", "menuGroup", "sheetOpen", "sheetActions", "mobileSheetGesture", "mobilePanel"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const createDateField = modules.field.createDateField;
        modules.field.createDateField = (...args: unknown[]) => { fields++; return createDateField(...args); };
        const cell = document.getElementById("cell");
        const mount = (isNotTime: boolean, format = "") => {
            initial.isNotTime = isNotTime;
            const panel = document.createElement("div");
            panel.className = "av__panel";
            panel.innerHTML = '<div class="b3-dialog__scrim"></div><div class="b3-menu">' +
                modules.date.getDateHTML([cell], format) + "</div>";
            document.body.append(panel);
            const menu = panel.querySelector<HTMLElement>(".b3-menu");
            // 与业务入口一致，先绑定移动端外壳，再绑定日期编辑器。
            modules.mobilePanel.bindMobileAVPanel(panel, menu);
            const close = modules.date.bindDateEvent({menuElement: menu, cellElements: [cell], data: {},
                requireExplicitChange: true, format});
            return {panel, menu, close: () => { close(); panel.remove(); }};
        };
        const close = async (panel: ReturnType<typeof mount>) => {
            panel.close();
            await settle("Closed panel");
            equal(observers.size, 0, "Closing releases all inline and mobile panel observers");
            equal(document.querySelectorAll(".av__panel, .date-picker").length, 0, "Closing removes the calendar and its owner");
        };
        for (const isNotTime of [true, false]) {
            for (let round = 0; round < 3; round++) {
                const panel = mount(isNotTime);
                await settle(`Open empty ${isNotTime ? "date" : "datetime"} ${round}`);
                equal(panel.menu.querySelectorAll(".date-picker__calendar").length, 1, "One calendar is shared by both endpoints");
                equal(updates.length, 0, "Opening an empty field never writes its prefill");
                await close(panel);
                equal(updates.length, 0, "Untouched close never writes its prefill");
            }
        }
        const panel = mount(true);
        await settle("Before editing");
        const inputs = panel.menu.querySelectorAll<HTMLInputElement>("input");
        panel.menu.querySelector<HTMLButtonElement>(".date-picker__month-toggle").click();
        const year = panel.menu.querySelector<HTMLInputElement>(".date-picker__month-editor input");
        year.value = "2027";
        year.dispatchEvent(new Event("input", {bubbles: true}));
        year.setSelectionRange(1, 3);
        await settle("Edit calendar year");
        const beforeDecoration = fields;
        panel.menu.querySelector(".b3-menu__items").classList.add("mobile-date-test-decoration");
        await settle("Decorative ancestor class");
        equal(fields, beforeDecoration, "Unrelated ancestor classes do not rebuild the calendar");
        equal(document.activeElement, year, "Decorative changes preserve the year editor focus");
        equal(year.value, "2027", "Decorative changes preserve the year draft");
        equal(year.selectionStart, 1, "Decorative changes preserve the year selection start");
        equal(year.selectionEnd, 3, "Decorative changes preserve the year selection end");
        equal(year.closest(".date-picker__month-editor").classList.contains("fn__none"), false, "Decorative changes keep month editing open");
        year.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        inputs[2].click();
        await settle("Enable end date");
        equal(inputs[1].closest(".date-picker__endpoint").classList.contains("fn__none"), false, "End date becomes visible");
        inputs[1].focus();
        await settle("Activate end date");
        equal(inputs[1].dataset.datePickerActive, "true", "Focus selects the end endpoint");
        const selected = panel.menu.querySelector<HTMLButtonElement>("button[data-date]:not(:disabled)");
        const expectedDate = selected.dataset.date;
        selected.click();
        equal(inputs[1].value, expectedDate, "Calendar selection changes the active endpoint");
        inputs[3].click();
        await settle("Enable time");
        equal(inputs[0].dataset.datePickerType, "datetime-local", "Include time preserves datetime semantics");
        equal(panel.menu.querySelectorAll(".date-picker__split").length, 2, "Time mode adds exactly one split per endpoint");
        const time = panel.menu.querySelector<HTMLInputElement>('[data-date-picker-part="time"]');
        const split = inputs[0].closest(".date-picker__split");
        inputs[0].classList.add("fn__none");
        await settle("Hide datetime input");
        equal(split.classList.contains("fn__none"), true, "Input hiding propagates to its split wrapper");
        inputs[0].classList.remove("fn__none");
        await settle("Restore datetime input");
        equal(split.classList.contains("fn__none"), false, "Removing input hiding restores its split wrapper without an explicit update");
        inputs[0].disabled = true;
        await settle("Disable datetime input");
        equal(time.disabled, true, "Disabled state reaches the split time input");
        inputs[0].disabled = false;
        inputs[0].readOnly = true;
        await settle("Readonly datetime input");
        equal(time.disabled, false, "Clearing disabled restores the split time input");
        equal(time.readOnly, true, "Readonly state reaches the split time input");
        inputs[0].readOnly = false;
        await settle("Restore editable datetime input");
        equal(time.readOnly, false, "Clearing readonly restores editing");
        time.value = "12:34";
        time.dispatchEvent(new Event("input", {bubbles: true}));
        time.dispatchEvent(new Event("change", {bubbles: true}));
        await settle("Edit time");
        equal(modules.inline.getInlineDateValue(inputs[0]).endsWith("T12:34"), true, "Time draft remains connected to the original input");
        inputs[3].click();
        await settle("Disable time");
        equal(panel.menu.querySelectorAll(".date-picker__split").length, 0, "Date-only mode removes split controls");
        equal(inputs[1].value, expectedDate, "Time toggling preserves the selected end date");
        inputs[2].click();
        await settle("Disable end date");
        equal(inputs[1].closest(".date-picker__endpoint").classList.contains("fn__none"), true, "End date can be hidden again");
        await close(panel);
        equal(updates.length, 1, "Edited panel saves once through its existing close callback");

        const constrained = mount(true);
        await settle("Open constrained input");
        const date = constrained.menu.querySelector<HTMLInputElement>("input");
        const originalDate = date.value;
        const previousDay = modules.model.formatDate(modules.model.addDays(modules.model.parseDate(originalDate), -1));
        const nextDay = modules.model.formatDate(modules.model.addDays(modules.model.parseDate(originalDate), 1));
        date.min = nextDay;
        await settle("Change minimum date");
        equal(date.getAttribute("aria-invalid"), "true", "Changed minimum revalidates the current draft");
        date.min = "";
        date.max = previousDay;
        await settle("Change maximum date");
        equal(date.getAttribute("aria-invalid"), "true", "Changed maximum revalidates the current draft");
        date.max = "9999-12-31";
        await settle("Restore date constraints");
        equal(date.getAttribute("aria-invalid"), "false", "Restored constraints clear invalid state");
        date.type = "date";
        await settle("Restore raw native type");
        equal(date.type, "text", "Native type mutations are rebound to internal text input");
        equal(date.dataset.datePickerType, "date", "Rebinding retains native date semantics");
        date.closest(".date-picker__endpoint").setAttribute("hidden", "");
        await settle("Hide date ancestor");
        equal(constrained.menu.querySelectorAll(".date-picker__calendar").length, 0, "Hidden ancestors remove the unavailable calendar");
        date.closest(".date-picker__endpoint").removeAttribute("hidden");
        await settle("Restore date ancestor");
        date.focus();
        await settle("Refocus restored date");
        equal(constrained.menu.querySelectorAll(".date-picker__calendar").length, 1, "Restored dates can activate a calendar again");
        await close(constrained);

        const lunar = mount(false, "lunar");
        await settle("Open lunar time controls");
        equal(lunar.menu.querySelectorAll(".date-picker__calendar").length, 0, "Lunar time inputs do not create a solar calendar");
        const lunarTime = lunar.menu.querySelector<HTMLInputElement>("[data-lunar-time]");
        equal(lunarTime.type, "text", "Lunar time retains the internal input binding");
        lunar.menu.querySelector<HTMLInputElement>("[data-lunar-end]").click();
        await settle("Lunar range");
        equal(lunar.menu.querySelectorAll("[data-lunar-endpoint]")[1].classList.contains("fn__none"), false, "Lunar end date becomes visible");
        lunar.menu.querySelector<HTMLInputElement>("[data-lunar-include-time]").click();
        await settle("Hide lunar time");
        equal(lunarTime.classList.contains("fn__none"), true, "Lunar time visibility still follows its switch");
        await close(lunar);
        return "mobile date lifecycle cases passed";
    }, sources, readFileSync("appearance/themes/daylight/theme.css", "utf8") +
        compile("src/assets/scss/base.scss", {silenceDeprecations: ["legacy-js-api", "import", "global-builtin"]}).css,
    {width: 393, height: 852});
    assert.match(result, /mobile date lifecycle cases passed/);
});
