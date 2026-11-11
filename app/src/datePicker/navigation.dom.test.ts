import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const equal = (actual: unknown, expected: unknown, message: string) => {
        if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
    };
    const ok = (value: unknown, message: string) => { if (!value) { throw new Error(message); } };
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    new Function(sources.icons)();
    const mobile = sources.frontend === "browser-mobile";
    document.documentElement.dataset.frontend = sources.frontend;
    if (mobile) { const sidebar = document.createElement("div"); sidebar.id = "sidebar"; document.body.append(sidebar); }
    const modules: Record<string, any> = {};
    for (const name of ["model", "yearInput", "field"]) {
        const exports = modules[name] = {};
        new Function("exports", "require", sources[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
    }
    const host = document.createElement("div"); host.style.width = mobile ? "288px" : "345px"; document.body.append(host);
    const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
        calendarToday: "Today", clear: "Clear", invalid: "Invalid"};
    const create = (options: Record<string, string> = {}) => modules.field.createDateField(host, {
        type: "date", value: "2024-02-28", locale: "en-US", languages, ...options,
    });
    const navigation = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".date-picker__navigation .block__icon"));
    const month = () => host.querySelector<HTMLSelectElement>(".date-picker__month-editor select").value;
    const visible = (button: HTMLButtonElement) => {
        const label = button.getAttribute("aria-label");
        const computed = getComputedStyle(button);
        equal(computed.opacity, button.disabled ? "0.38" : "1", label + " uses shared visible/disabled opacity");
        equal(computed.visibility, "visible", label + " visibility");
        ok(button.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}), label + " is painted without hover");
        const use = button.querySelector("use");
        const symbol = document.querySelector(use.getAttribute("href") || use.getAttribute("xlink:href"));
        ok(symbol?.querySelector("path"), label + " resolves a real icon path");
        const glyph = use.getBBox();
        ok(glyph.width > 0 && glyph.height > 0, label + " renders nonempty icon geometry");
        const rect = button.getBoundingClientRect();
        ok(rect.width > 0 && rect.height > 0, label + " has a hit target");
        for (let element: HTMLElement = button; element; element = element.parentElement) {
            ok(Number(getComputedStyle(element).opacity) > 0, label + " has no transparent ancestor");
        }
    };
    const field = create();
    const caption = host.querySelector<HTMLElement>(".date-picker__heading");
    equal(caption.getAttribute("aria-live"), "polite", "Month changes remain announced");
    equal(getComputedStyle(caption).clipPath, "inset(50%)", "Duplicate month caption is visually clipped");
    ok(getComputedStyle(caption).display !== "none", "Caption is not removed from layout");
    equal(getComputedStyle(caption).visibility, "visible", "Caption is not visibility-hidden");
    equal(caption.getAttribute("aria-hidden"), null, "Caption is not hidden from assistive technology");
    equal(caption.textContent, "February 2024", "Calendar caption identifies the current month");
    const [previous, next] = navigation();
    for (const button of [previous, next]) {
        ok(!button.matches(":hover"), "Initial arrow visibility must not depend on hover");
        visible(button);
        button.focus();
        equal(document.activeElement, button, "Navigation accepts keyboard focus");
        visible(button);
    }
    previous.click(); equal(month(), "1", "Previous navigates to January");
    equal(caption.textContent, "January 2024", "Month navigation updates the live caption");
    next.click(); equal(month(), "2", "Next navigates to February");
    equal(field.commit(), "2024-02-28", "Month navigation does not select a date");
    ok(host.scrollWidth <= host.clientWidth + 1, "Navigation fits the narrow host");
    field.destroy(); host.replaceChildren();

    for (const [value, disabledIndex] of [["0001-01-01", 0], ["275760-09-13", 1]] as const) {
        const boundary = create({value});
        const buttons = navigation();
        ok(buttons[disabledIndex].disabled, "Calendar endpoint disables the outgoing arrow");
        await new Promise(resolve => setTimeout(resolve, 350));
        buttons.forEach(visible);
        const current = month();
        buttons[disabledIndex].click();
        equal(month(), current, "Disabled navigation cannot leave the supported range");
        boundary.destroy(); host.replaceChildren();
    }
    const constrained = create({min: "2024-02-01", max: "2024-02-29"});
    navigation().forEach(visible);
    navigation()[0].click();
    ok(Array.from(host.querySelectorAll<HTMLButtonElement>("[data-date]")).every(button =>
        button.dataset.date >= "2024-02-01" || button.getAttribute("aria-disabled") === "true"), "Min constraint survives navigation");
    navigation()[1].click(); navigation()[1].click();
    ok(Array.from(host.querySelectorAll<HTMLButtonElement>("[data-date]")).every(button =>
        button.dataset.date <= "2024-02-29" || button.getAttribute("aria-disabled") === "true"), "Max constraint survives navigation");
    equal(constrained.commit(), "2024-02-28", "Constraints and draft survive browsing");
    constrained.destroy();
    host.replaceChildren(); host.dir = "rtl";
    const rtl = create({locale: "ar-EG"});
    const [rtlPrevious, rtlNext] = navigation();
    equal(rtlPrevious.querySelector("use").getAttribute("xlink:href"), "#iconRight", "RTL previous points toward earlier months");
    equal(rtlNext.querySelector("use").getAttribute("xlink:href"), "#iconLeft", "RTL next points toward later months");
    navigation().forEach(visible);
    rtl.destroy();
    return "Date picker navigation rendering passed";
};

for (const frontend of ["browser-desktop", "browser-mobile"]) {
    for (const scheme of ["daylight", "midnight"]) {
        test(`date picker navigation is visible with production icons and ${frontend} ${scheme} styles`, {
            timeout: 45000, skip: !canRunBrowser,
        }, async () => {
            const sources = {...browserSources({model: join(__dirname, "model.ts"), yearInput: join(__dirname, "yearInput.ts"), field: join(__dirname, "field.ts")}),
                frontend, icons: readFileSync(join(__dirname, "../../appearance/icons/litheness/icon.js"), "utf8")};
            const css = compile(join(__dirname, `../assets/scss/${frontend === "browser-mobile" ? "mobile" : "base"}.scss`),
                {logger: {warn() {}}}).css;
            const theme = readFileSync(join(__dirname, `../../appearance/themes/${scheme}/theme.css`), "utf8");
            assert.match(await runBrowserCase(browserCases, sources, theme + css, {width: frontend === "browser-mobile" ? 320 : 900}),
                /Date picker navigation rendering passed/);
        });
    }
}
