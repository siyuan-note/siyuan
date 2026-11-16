import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("split datetime preserves partial drafts, constraints, endpoint identity and lifecycle", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries(["model", "yearInput", "field", "inline"].map(name => [name, join(__dirname, name + ".ts")])));
    const result = await runBrowserCase(async source => {
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field", "inline"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const ok = (value: boolean, message: string) => { if (!value) { throw Error(message); } };
        const {bindInlineDatePicker, getInlineDateValue, setInlineDateValue} = modules.inline;
        document.body.innerHTML = '<input id="start" type="datetime-local" step="any" value="2026-11-11T10:35:27.123"><input id="end" type="datetime-local" step="any" value="2026-11-12T11:45:28.456"><button id="outside">Outside</button><div id="calendar"></div>';
        const start = document.querySelector<HTMLInputElement>("#start");
        const end = document.querySelector<HTMLInputElement>("#end");
        const host = document.querySelector<HTMLElement>("#calendar");
        const languages = {date: "Date", datePickerTime: "Time", startDate: "Start", endDate: "End", invalid: "Invalid"};
        const binding = bindInlineDatePicker(host, [start, end], {languages});
        const time = (input: HTMLInputElement) => input.closest(".date-picker__split").querySelector<HTMLInputElement>('[data-date-picker-part="time"]');
        let changes = 0;
        start.addEventListener("change", () => changes++);
        const edit = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event("input", {bubbles: true})); };
        start.focus();
        edit(start, "2026-11-13");
        time(start).focus();
        ok(changes === 0 && binding.isActive(start), "Date to time focus does not submit");
        ok(getInlineDateValue(start) === "2026-11-13T10:35:27.123", "Date draft preserves exact old time");
        edit(time(start), "12:46:29.789");
        ok(getInlineDateValue(start) === "2026-11-13T12:46:29.789", "Time draft preserves date");
        binding.update();
        ok(time(start).value === "12:46:29.789" && binding.validate(), "Update retains both drafts");
        document.querySelector<HTMLButtonElement>("#outside").focus();
        ok(changes === 1, "Leaving pair submits one change");
        start.focus(); edit(time(start), "");
        ok(!binding.validate() && getInlineDateValue(start) === "2026-11-13T", "Missing time is invalid rather than clear");
        host.querySelector<HTMLButtonElement>('button[data-date="2026-11-14"]').click();
        ok(start.value === "2026-11-14" && time(start).value === "" && !binding.validate(), "Calendar preserves missing time draft");
        edit(start, "");
        ok(binding.validate() && getInlineDateValue(start) === "", "Both empty is optional clear");
        edit(time(start), "10:00");
        ok(!binding.validate() && getInlineDateValue(start) === "T10:00", "Missing date remains incomplete");
        setInlineDateValue(start, "2026-11-14T10:00");
        start.min = "2026-11-14T11:00"; binding.update();
        ok(!binding.validate() && !time(start).checkValidity(), "Combined minimum invalidates visible fields");
        start.min = ""; start.step = "60";
        edit(time(start), "10:00:01"); binding.update();
        ok(!binding.validate(), "Minute step rejects explicit seconds");
        start.step = "any"; binding.update();
        ok(binding.validate(), "Step any accepts precision");
        time(start).dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        ok(!binding.validate(), "Time IME blocks save");
        time(start).dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        ok(binding.validate(), "Time IME completion restores validation");
        ok(!start.closest(".date-picker__split").querySelector(".ft__smaller"), "Split inputs have no redundant visible captions");
        for (const [raw, expected] of [["930", "09:30"], ["0930", "09:30"], ["123", "01:23"], ["1234", "12:34"], ["2359", "23:59"]]) {
            time(start).focus();
            edit(time(start), raw);
            ok(time(start).value === raw, "Typing does not insert punctuation into the draft");
            ok(binding.validate() && getInlineDateValue(start) === `2026-11-14T${expected}`, "Commit validation accepts a complete numeric time");
            time(start).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
            ok(time(start).value === expected, "Enter displays the normalized time");
        }
        for (const raw of ["1", "12", "2400", "1260", "9999"]) {
            edit(time(start), raw);
            document.querySelector<HTMLButtonElement>("#outside").focus();
            ok(!binding.validate() && time(start).value === raw, "Incomplete or out-of-range digits remain invalid, without guessing");
            time(start).focus();
        }
        edit(time(start), "0930");
        time(start).dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        time(start).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true}));
        ok(!binding.validate() && time(start).value === "0930", "Numeric draft is not committed or displayed as normalized during IME");
        time(start).dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        document.querySelector<HTMLButtonElement>("#outside").focus();
        ok(time(start).value === "09:30", "Leaving the pair normalizes complete digits");
        end.focus();
        ok(host.querySelectorAll("table").length === 1 && binding.isActive(end), "Endpoints share one calendar");
        ok(time(end).getAttribute("aria-label").includes("End"), "End time identifies its endpoint");
        start.dataset.datePickerType = "date"; start.value = "2026-11-14"; binding.update();
        ok(document.querySelectorAll(".date-picker__split").length === 1 && start.value === "2026-11-14", "All-day removes only its own time control");
        start.dataset.datePickerType = "datetime-local"; setInlineDateValue(start, "2026-11-14T10:00:01"); binding.update();
        ok(document.querySelectorAll(".date-picker__split").length === 2 && getInlineDateValue(start) === "2026-11-14T10:00:01", "Time mode restores exactly one pair");
        edit(time(start), "25:70"); binding.destroy();
        ok(start.value === "2026-11-14T25:70" && !start.checkValidity(), "Destroy preserves invalid combined draft");
        ok(!document.querySelector(".date-picker__split"), "Destroy removes owned pairs");
        setInlineDateValue(start, "2026-11-14T10:00");
        const moved = bindInlineDatePicker(host, start, {languages});
        moved.activate(start);
        const iframe = document.createElement("iframe");
        document.body.append(iframe);
        iframe.contentDocument.body.append(start);
        await new Promise(resolve => setTimeout(resolve, 0));
        ok(start.ownerDocument === iframe.contentDocument, "Cleanup never reparents an adopted source into the old document");
        ok(!document.querySelector(".date-picker__split") && !host.children.length, "Adoption releases split controls and calendar");
        return "split date cases passed";
    }, sources);
    assert.match(result, /split date cases passed/);
});
