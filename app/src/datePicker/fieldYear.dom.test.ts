import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("date field year previews preserve drafts and confirm browsing without selecting dates", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({model: join(__dirname, "model.ts"), yearInput: join(__dirname, "yearInput.ts"),
        field: join(__dirname, "field.ts")});
    const result = await runBrowserCase(async source => {
        const initialHasFocus = document.hasFocus();
        let focusDiagnostics: unknown;
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}; focus: ${JSON.stringify(focusDiagnostics)}`); }
        };
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", invalid: "Invalid"};
        for (const type of ["date", "datetime-local"]) {
            const host = document.createElement("div");
            document.body.append(host);
            let selections = 0;
            const value = "2024-12-28" + (type === "date" ? "" : "T12:30:15.123");
            const field = modules.field.createDateField(host, {type, value, locale: "en-US", step: "any", languages,
                onSelect: () => selections++});
            const toggle = host.querySelector<HTMLButtonElement>(".date-picker__month-toggle");
            const editor = host.querySelector<HTMLElement>(".date-picker__month-editor");
            const year = editor.querySelector<HTMLInputElement>("input");
            const months = editor.querySelector<HTMLSelectElement>("select");
            let trustedBlurs = 0;
            year.addEventListener("blur", event => { if (event.isTrusted) { trustedBlurs++; } });
            const blurToMonths = () => {
                const before = {initialHasFocus, hasFocus: document.hasFocus(), activeYear: document.activeElement === year,
                    expanded: toggle.getAttribute("aria-expanded"), trustedBlurs, year: year.value};
                months.focus();
                const after = {hasFocus: document.hasFocus(), activeMonth: document.activeElement === months,
                    activeTag: document.activeElement?.tagName, expanded: toggle.getAttribute("aria-expanded"), trustedBlurs, year: year.value};
                focusDiagnostics = {before, after};
                equal(before.activeYear, true, "The native blur check starts with the year focused");
                equal(after.activeMonth, true, "The native focus transition reaches the month selector");
                equal(trustedBlurs > before.trustedBlurs, true, "The native focus transition delivers a trusted year blur");
            };
            const caption = () => host.querySelector("caption").textContent;
            const error = () => host.querySelector(".ft__error").textContent;
            const open = () => { if (toggle.getAttribute("aria-expanded") !== "true") { toggle.click(); } };
            const edit = (text: string, start = text.length, end = start, direction: "forward" | "backward" | "none" = "none") => {
                year.value = text;
                year.setSelectionRange(start, end, direction);
                year.dispatchEvent(new InputEvent("input", {data: text, inputType: "insertText", bubbles: true}));
            };
            const enter = () => {
                const event = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
                year.dispatchEvent(event);
                equal(event.defaultPrevented, true, "Year Enter is handled without bubbling to date confirmation");
            };
            equal(toggle.getAttribute("aria-expanded"), "false", "Year editor begins collapsed");
            equal(editor.classList.contains("fn__none"), true, "Year editing controls begin hidden");
            equal(caption(), "December 2024", "The title represents the visible calendar month");
            open();
            equal(document.activeElement, year, "Opening the editor focuses the year");
            equal(year.selectionStart, 0, "Opening selects the complete year");
            equal(year.selectionEnd, 4, "Opening selects the complete year");
            equal(year.type, "text", "The integrated control preserves caret editing");
            equal(year.inputMode, "numeric", "The integrated control requests a numeric keyboard");
            equal(year.maxLength, -1, "Long numbers are not truncated into another potentially valid year");
            equal(year.getAttribute("aria-label"), "Year", "The year has its localized accessible label");
            equal(months.getAttribute("aria-label"), "Month", "The month has its localized accessible label");
            for (const text of ["e", "+", "-", "."]) {
                const event = new KeyboardEvent("keydown", {key: text, bubbles: true, cancelable: true});
                year.dispatchEvent(event);
                equal(event.defaultPrevented, true, "Nondigit keystrokes are rejected immediately");
                equal(year.value, "2024", "Rejected keys leave the year unchanged");
            }
            for (const text of ["2e3", "2025年", "２０２５"]) {
                const data = new DataTransfer();
                data.setData("text/plain", text);
                const event = new ClipboardEvent("paste", {clipboardData: data, bubbles: true, cancelable: true});
                year.dispatchEvent(event);
                equal(event.defaultPrevented, true, "A mixed paste is rejected as a whole");
                equal(year.value, "2024", "A rejected paste does not extract a different number");
            }
            edit("2e3");
            equal(year.value, "2024", "Fallback input also rejects mixed values");
            equal(error(), "", "Year validation does not show a date error");
            equal(field.validate(), true, "Rejected year edits do not invalidate the civil date");
            edit("0002035", 2, 5, "backward");
            equal(caption(), "December 2035", "A valid numeric input previews the calendar before blur or Enter");
            equal(year.value, "0002035", "Preview does not normalize the year draft");
            equal(year.selectionStart, 2, "Preview preserves the selection start");
            equal(year.selectionEnd, 5, "Preview preserves the selection end");
            equal(year.selectionDirection, "backward", "Preview preserves the selection direction");
            equal(document.activeElement, year, "Preview never moves focus away from typing");
            equal(field.commit(), value, "Preview leaves all date and time fields unchanged");
            equal(selections, 0, "Preview does not select or save a date");
            const previewDay = host.querySelector("[data-date]");
            year.dispatchEvent(new InputEvent("input", {data: "0002035", inputType: "insertText", bubbles: true}));
            equal(host.querySelector("[data-date]"), previewDay, "Duplicate input for the same year does not redraw");
            equal(year.selectionStart, 2, "Duplicate input preserves the caret range");
            equal(year.selectionEnd, 5, "Duplicate input preserves the caret range");
            enter();
            equal(caption(), "December 2035", "Enter navigates to a valid numeric year");
            equal(year.value, "2035", "Confirmation may normalize the committed browsing year");
            equal(host.querySelector("[data-date]"), previewDay, "Confirming the existing preview does not redraw");
            equal(toggle.getAttribute("aria-expanded"), "false", "Enter closes the year editor");
            equal(document.activeElement, toggle, "Enter returns focus to the month title");
            equal(field.commit(), value, "Year navigation never changes the date or time draft");
            equal(selections, 0, "Year navigation never invokes date selection");

            open();
            for (const text of ["", "0", "275761", "99999999999999999999999999999999999999"]) {
                year.focus();
                edit("2");
                equal(caption(), "December 2", "A valid partial numeric year is only a preview");
                edit("20");
                equal(caption(), "December 20", "More numeric typing updates the preview");
                year.select();
                document.execCommand("insertText", false, text);
                if (text === "") { document.execCommand("delete"); }
                equal(year.value, text, "Numeric and empty drafts stay intact until blur");
                blurToMonths();
                equal(year.value, "2035", "Invalid blur restores the confirmed year rather than a numeric typing prefix");
                equal(caption(), "December 2035", "Invalid blur cannot navigate");
                equal(error(), "", "Invalid year blur does not show a validation message");
                equal(toggle.getAttribute("aria-expanded"), "true", "Moving focus to the month keeps the editor open");
            }
            year.focus();
            edit("2036");
            equal(caption(), "December 2036", "Input previews the next year before change");
            const changedPreviewDay = host.querySelector("[data-date]");
            year.dispatchEvent(new Event("change", {bubbles: true}));
            equal(caption(), "December 2036", "Change can navigate a valid year");
            equal(host.querySelector("[data-date]"), changedPreviewDay, "Change confirms the preview without rebuilding days");
            const renderedDay = host.querySelector("[data-date]");
            blurToMonths();
            equal(host.querySelector("[data-date]"), renderedDay, "Repeated change and blur do not redraw the same month");
            year.focus();
            edit("");
            blurToMonths();
            equal(year.value, "2036", "Restoration uses the updated current year");
            edit("2037");
            year.focus();
            blurToMonths();
            months.value = "4";
            months.dispatchEvent(new Event("change", {bubbles: true}));
            equal(caption(), "April 2037", "A year blur followed by month selection uses both new values");
            year.focus();
            edit("2038");
            months.value = "8";
            months.dispatchEvent(new Event("change", {bubbles: true}));
            equal(caption(), "August 2038", "Month change can commit a pending valid year");
            year.focus();
            edit("2");
            edit("275761");
            blurToMonths();
            equal(year.value, "2038", "Invalid blur restores the year confirmed by the latest month selection");
            equal(caption(), "August 2038", "Invalid blur restores the month confirmed by the latest selection");
            year.focus();
            edit("2040");
            equal(caption(), "August 2040", "A new preview uses the most recently confirmed month");
            equal(field.cancelMonthEdit(), true, "Escape handling cancels an open preview");
            equal(year.value, "2038", "Escape restores the latest explicitly confirmed year");
            equal(caption(), "August 2038", "Escape restores the latest explicitly confirmed month");
            equal(toggle.getAttribute("aria-expanded"), "false", "Escape closes the editor");
            equal(document.activeElement, toggle, "Escape returns focus to the month title");
            equal(field.cancelMonthEdit(), false, "A second Escape is left to the parent dialog");
            open();
            year.setSelectionRange(2, 4);
            document.execCommand("insertText", false, "50");
            equal(year.value, "2050", "Native replacement keeps the complete typed year");
            equal(caption(), "August 2050", "Native browser input previews the replacement year immediately");
            equal(year.selectionStart, 4, "Native preview leaves the caret after the inserted text");
            equal(year.selectionEnd, 4, "Native preview leaves the caret collapsed");
            document.execCommand("undo");
            equal(year.value, "2038", "Native undo retains the previous accepted year draft");
            equal(caption(), "August 2038", "Native undo updates the preview to match the restored draft");
            document.execCommand("redo");
            equal(caption(), "August 2050", "Native redo previews the redone year");
            document.execCommand("delete");
            equal(year.value, "205", "Native backward deletion stays editable while previewing");
            equal(caption(), "August 205", "Native deletion previews its numeric prefix without confirming it");
            equal(field.cancelMonthEdit(), true, "Escape cancels native typing and undo previews");
            equal(caption(), "August 2038", "Native editing does not overwrite the last confirmed browsing month");
            equal(field.commit(), value, "All month and year browsing preserves complete civil date and time text");
            equal(selections, 0, "Month and year changes do not select dates");
            field.destroy();
            equal(host.childElementCount, 0, "Disposing the field removes the editor");
            const event = new KeyboardEvent("keydown", {key: "e", cancelable: true});
            year.dispatchEvent(event);
            equal(event.defaultPrevented, false, "Disposing the field removes year filtering");
            host.remove();
        }
        return "Date field year editing passed";
    }, sources);
    assert.match(result, /Date field year editing passed/);
});

test("date field year editing respects civil boundaries and leaves active IME composition alone", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({model: join(__dirname, "model.ts"), yearInput: join(__dirname, "yearInput.ts"),
        field: join(__dirname, "field.ts")});
    const result = await runBrowserCase(async source => {
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
        };
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const host = document.createElement("div");
        document.body.append(host);
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", invalid: "Invalid"};
        const field = modules.field.createDateField(host, {type: "date", value: "2024-12-28", locale: "en-US", languages});
        const toggle = host.querySelector<HTMLButtonElement>(".date-picker__month-toggle");
        const editor = host.querySelector<HTMLElement>(".date-picker__month-editor");
        const year = editor.querySelector<HTMLInputElement>("input");
        const months = editor.querySelector<HTMLSelectElement>("select");
        const caption = () => host.querySelector("caption").textContent;
        const open = () => { if (toggle.getAttribute("aria-expanded") !== "true") { toggle.click(); } };
        const edit = (text: string, isComposing = false) => {
            year.value = text;
            year.dispatchEvent(new InputEvent("input", {data: text, inputType: isComposing ? "insertCompositionText" : "insertText",
                bubbles: true, isComposing}));
        };
        const enter = (options: KeyboardEventInit = {}) => {
            const event = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true, ...options});
            year.dispatchEvent(event);
            return event;
        };
        open();
        edit("275760");
        equal(caption(), "September 275760", "Preview clamps a maximum-year draft to September");
        equal(months.value, "9", "Preview keeps the visible month selector consistent");
        edit("275759");
        equal(caption(), "December 275759", "Leaving a temporary maximum-year preview restores the confirmed December");
        edit("275760");
        equal(field.cancelMonthEdit(), true, "Escape cancels a maximum-year preview");
        equal(caption(), "December 2024", "Escape restores the complete original year and month after a September clamp");
        equal(year.value, "2024", "Escape restores the original year draft");
        equal(months.value, "12", "Escape restores the original December selection");
        for (const option of months.options) { equal(option.disabled, false, "Escape restores the original month's available options"); }
        open();
        edit("275760");
        enter();
        equal(caption(), "September 275760", "Maximum year clamps December to the last representable month");
        equal(months.value, "9", "The month editor reflects the clamped calendar");
        equal(host.querySelector<HTMLButtonElement>('[aria-label="Next"]').disabled, true, "Next cannot leave the final month");
        for (const option of months.options) {
            equal(option.disabled, Number(option.value) > 9, "Only months beyond September are disabled at the final year");
        }
        equal(!!host.querySelector('[data-date="275760-09-13"]'), true, "The final supported day remains visible");
        equal(host.querySelector('[data-date="275760-09-14"]'), null, "Unsupported days are not rendered");
        open();
        months.value = "12";
        months.dispatchEvent(new Event("change", {bubbles: true}));
        equal(months.value, "9", "Even a programmatic disabled-month selection is restored");
        edit("275759");
        enter();
        for (const option of months.options) { equal(option.disabled, false, "Leaving the maximum year restores all months"); }
        open();
        edit("1");
        months.value = "1";
        months.dispatchEvent(new Event("change", {bubbles: true}));
        equal(caption(), "January 1", "The first supported civil year remains navigable");
        equal(host.querySelector<HTMLButtonElement>('[aria-label="Previous"]').disabled, true, "Previous cannot leave the first month");
        edit("2035");
        enter();
        open();
        year.setSelectionRange(2, 4);
        year.dispatchEvent(new Event("select"));
        year.dispatchEvent(new CompositionEvent("compositionstart"));
        const firstDay = host.querySelector("[data-date]");
        edit("2040", true);
        equal(caption(), "January 2035", "Even a valid numeric composition does not preview while the IME is active");
        equal(host.querySelector("[data-date]"), firstDay, "Active numeric composition does not rebuild days");
        edit("20二", true);
        for (const options of [{isComposing: true}, {keyCode: 229}, {}]) {
            equal(enter(options).defaultPrevented, false, "An active IME Enter must not be intercepted, including missing event flags");
            equal(toggle.getAttribute("aria-expanded"), "true", "Active IME Enter does not close the editor");
            equal(year.value, "20二", "Active IME Enter does not restore the draft");
            equal(host.querySelector("[data-date]"), firstDay, "Active IME Enter does not redraw the calendar");
        }
        year.dispatchEvent(new Event("change", {bubbles: true}));
        months.focus();
        equal(year.value, "20二", "Blur and change do not interrupt active composition");
        equal(caption(), "January 2035", "Composition cannot navigate the calendar");
        year.dispatchEvent(new CompositionEvent("compositionend", {data: "二"}));
        equal(year.value, "2035", "Nonnumeric completed composition restores the previous year");
        equal(host.querySelector(".ft__error").textContent, "", "Rejected composition displays no invalid message");
        year.focus();
        year.dispatchEvent(new CompositionEvent("compositionstart"));
        edit("2039", true);
        year.setSelectionRange(1, 3, "backward");
        year.dispatchEvent(new CompositionEvent("compositionend", {data: "2039"}));
        equal(caption(), "January 2039", "Completed ASCII numeric composition previews before confirmation");
        equal(year.value, "2039", "Completed numeric composition preserves the entered text");
        equal(year.selectionStart, 1, "Completed composition preview preserves selection start");
        equal(year.selectionEnd, 3, "Completed composition preview preserves selection end");
        equal(year.selectionDirection, "backward", "Completed composition preview preserves selection direction");
        equal(toggle.getAttribute("aria-expanded"), "true", "Completed composition remains editable until confirmation");
        const composedDay = host.querySelector("[data-date]");
        year.dispatchEvent(new InputEvent("input", {data: "2039", inputType: "insertCompositionText", bubbles: true}));
        equal(host.querySelector("[data-date]"), composedDay, "Trailing composition input does not duplicate the preview render");
        equal(field.cancelMonthEdit(), true, "A completed composition is still an unconfirmed preview");
        equal(caption(), "January 2035", "Escape after composition restores the last confirmed year");
        open();
        year.dispatchEvent(new CompositionEvent("compositionstart"));
        edit("2039", true);
        year.dispatchEvent(new CompositionEvent("compositionend", {data: "2039"}));
        enter();
        equal(caption(), "January 2039", "A completed numeric composition can navigate normally");
        equal(toggle.getAttribute("aria-expanded"), "false", "Enter closes only after composition completes");
        equal(field.commit(), "2024-12-28", "Boundary and IME navigation preserve the original selected date");
        field.destroy();
        return "Date field year boundary and IME coverage passed";
    }, sources);
    assert.match(result, /Date field year boundary and IME coverage passed/);
});

test("date field native Tab restores invalid drafts to the confirmed year rather than a preview prefix", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({model: join(__dirname, "model.ts"), yearInput: join(__dirname, "yearInput.ts"),
        field: join(__dirname, "field.ts")});
    const result = await runBrowserCase(async source => {
        const initialHasFocus = document.hasFocus();
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const style = document.createElement("style");
        style.textContent = ".fn__none {display: none;}";
        document.head.append(style);
        const host = document.createElement("div");
        document.body.append(host);
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", invalid: "Invalid"};
        const field = modules.field.createDateField(host, {type: "date", value: "2024-12-28", locale: "en-US", languages});
        const toggle = host.querySelector<HTMLButtonElement>(".date-picker__month-toggle");
        const year = host.querySelector<HTMLInputElement>(".date-picker__month-editor input");
        const edit = (value: string) => {
            year.value = value;
            year.dispatchEvent(new InputEvent("input", {data: value, inputType: "insertText", bubbles: true}));
        };
        let trustedBlurs = 0;
        year.addEventListener("blur", event => { if (event.isTrusted) { trustedBlurs++; } });
        (window as any).fieldYearNative = {
            prepare: (draft: string) => {
                if (toggle.getAttribute("aria-expanded") !== "true") { toggle.click(); }
                edit("2036");
                year.dispatchEvent(new Event("change", {bubbles: true}));
                edit("20");
                edit(draft);
                year.focus();
            },
            inspect: () => ({initialHasFocus, hasFocus: document.hasFocus(), activeYear: document.activeElement === year,
                activeTag: document.activeElement?.tagName, year: year.value, caption: host.querySelector("caption").textContent,
                expanded: toggle.getAttribute("aria-expanded"), value: field.commit(), error: host.querySelector(".ft__error").textContent,
                trustedBlurs}),
            destroy: () => field.destroy(),
        };
        return "Native year blur ready";
    }, sources, "", {interact: async window => {
        let focusDiagnostics: unknown;
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}; focus: ${JSON.stringify(focusDiagnostics)}`); }
        };
        const run = (script: string) => window.webContents.executeJavaScript(script);
        const tick = () => new Promise<void>(resolve => setTimeout(resolve, 60));
        for (const draft of ["", "275761"]) {
            window.focus();
            await tick();
            await run(`fieldYearNative.prepare(${JSON.stringify(draft)})`);
            await tick();
            const before = await run("fieldYearNative.inspect()");
            focusDiagnostics = {before};
            equal(before.activeYear, true, "The real Tab begins in the year input");
            equal(before.year, draft, "The invalid draft is still present before native blur");
            window.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
            window.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"});
            await tick();
            const after = await run("fieldYearNative.inspect()");
            focusDiagnostics = {before, after};
            equal(after.activeYear, false, "Native Tab leaves the year input");
            equal(after.trustedBlurs > before.trustedBlurs, true, "Native Tab delivers a trusted blur event");
            equal(after.year, "2036", "Native blur restores the confirmed year rather than numeric prefix 20");
            equal(after.caption, "December 2036", "Native blur restores the confirmed browsing month");
            equal(after.expanded, "false", "Native Tab closes the month editor");
            equal(after.value, "2024-12-28", "Native blur does not select or save a date");
            equal(after.error, "", "Native invalid year blur is silent");
        }
        await run("fieldYearNative.destroy()");
        return "Native year blur passed";
    }});
    assert.match(result, /Native year blur passed/);
});
