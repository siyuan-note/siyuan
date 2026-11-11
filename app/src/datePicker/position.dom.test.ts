import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const ok = (value: unknown, message: string) => { if (!value) { throw new Error(message); } };
    const modules: Record<string, any> = {};
    for (const name of ["model", "yearInput", "field", "menuPosition", "position"]) {
        const exports = modules[name] = {};
        new Function("exports", "require", sources[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
    }
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    new Function(sources.icons)();
    const tick = () => new Promise<void>(resolve => setTimeout(resolve, 60));
    const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
        calendarToday: "Aujourd’hui", clear: "Effacer", invalid: "Invalid"};
    const make = (doc: Document, owner: HTMLElement, type = "date", locale = "fr-FR") => {
        const element = doc.createElement("div"); element.className = "date-picker-dialog b3-dialog--open";
        element.innerHTML = '<div class="b3-dialog"><div class="b3-dialog__scrim"></div><div class="b3-dialog__container" role="dialog">' +
            '<div class="b3-dialog__body"><div class="b3-dialog__content"></div><div class="b3-dialog__action">' +
            '<button class="b3-button b3-button--cancel">Abbrechen</button><button class="b3-button">Bestätigen</button></div></div></div></div>';
        doc.body.append(element);
        const content = element.querySelector<HTMLElement>(".b3-dialog__content");
        content.dir = owner.dir;
        const field = modules.field.createDateField(content, {type, value: type === "time" ? "12:30" :
            type === "datetime-local" ? "2024-02-28T12:30" : "2024-02-28", languages, locale});
        const release = modules.position.bindDatePickerPosition(element, owner);
        const container = element.querySelector<HTMLElement>(".b3-dialog__container");
        return {element, container, field, close() { release(); field.destroy(); element.remove(); }};
    };
    const owner = document.createElement("input"); owner.type = "date";
    owner.style.cssText = "position:fixed;width:120px;height:28px"; document.body.append(owner);
    const inside = (root: HTMLElement, bounds = {left: 0, top: 0, right: innerWidth, bottom: innerHeight}) => {
        const rect = root.getBoundingClientRect();
        ok(rect.left >= bounds.left - 1 && rect.top >= bounds.top - 1 && rect.right <= bounds.right + 1 &&
            rect.bottom <= bounds.bottom + 1, "Picker stays inside its visible viewport: " + JSON.stringify({rect, bounds}));
        const footer = root.querySelector<HTMLElement>(".b3-dialog__action").getBoundingClientRect();
        ok(footer.height > 0 && footer.top >= bounds.top - 1 && footer.bottom <= bounds.bottom + 1, "Footer stays reachable");
        const content = root.querySelector<HTMLElement>(".b3-dialog__content");
        ok(content.clientHeight > 0, "Short screens retain a scrollable content viewport");
        ok(content.scrollWidth <= content.clientWidth + 1, "Localized content does not overflow horizontally");
    };
    for (const type of ["date", "time", "datetime-local"]) {
        for (const corner of [[8, 8], [innerWidth - 128, 8], [8, innerHeight - 36], [innerWidth - 128, innerHeight - 36]]) {
            owner.style.left = corner[0] + "px"; owner.style.top = corner[1] + "px";
            const picker = make(document, owner, type);
            inside(picker.container);
            await tick(); inside(picker.container);
            picker.close();
        }
    }
    owner.style.left = "20px"; owner.style.top = "40px"; owner.dir = "rtl";
    const rtl = make(document, owner, "date", "ar-EG"); await tick(); inside(rtl.container);
    const collapsedHeight = rtl.container.getBoundingClientRect().height;
    rtl.element.querySelector<HTMLButtonElement>(".date-picker__month-toggle").click();
    await tick(); inside(rtl.container);
    if (innerHeight > 600) {
        ok(rtl.container.getBoundingClientRect().height > collapsedHeight, "Opening month editing expands when viewport space is available");
    }
    const before = rtl.container.getBoundingClientRect().left;
    owner.style.left = innerWidth - 128 + "px"; await tick();
    inside(rtl.container);
    if (innerWidth > 600) { ok(rtl.container.getBoundingClientRect().left > before, "Position tracks anchor style movement"); }
    rtl.close();

    const originalViewport = window.visualViewport;
    const viewport = Object.assign(new EventTarget(), {offsetLeft: 12, offsetTop: 22,
        width: innerWidth - 24, height: Math.min(220, innerHeight - 44)});
    Object.defineProperty(window, "visualViewport", {configurable: true, value: viewport});
    owner.dir = "ltr";
    const constrained = make(document, owner, "datetime-local"); await tick();
    inside(constrained.container, {left: 12, top: 22, right: innerWidth - 12, bottom: 22 + viewport.height});
    viewport.offsetTop = 42; viewport.height -= 20; viewport.dispatchEvent(new Event("resize")); await tick();
    inside(constrained.container, {left: 12, top: 42, right: innerWidth - 12, bottom: 42 + viewport.height});
    constrained.close();
    Object.defineProperty(window, "visualViewport", {configurable: true, value: originalViewport});

    const scroller = document.createElement("div"); scroller.style.cssText = "position:fixed;inset:0;overflow:auto";
    const spacer = document.createElement("div"); spacer.style.height = "1500px"; scroller.append(spacer);
    owner.style.cssText = "position:absolute;left:20px;top:180px;width:120px;height:28px"; scroller.append(owner); document.body.append(scroller);
    const scrolling = make(document, owner); await tick();
    const start = scrolling.container.getBoundingClientRect().top;
    scroller.scrollTop = 100; await tick(); inside(scrolling.container);
    if (innerHeight > 500) { ok(scrolling.container.getBoundingClientRect().top !== start, "Captured ancestor scroll moves the picker"); }
    scrolling.close(); scroller.remove();

    const iframe = document.createElement("iframe"); iframe.style.cssText = "width:250px;height:220px"; document.body.append(iframe);
    const target = iframe.contentDocument;
    const targetStyle = target.createElement("style"); targetStyle.textContent = css; target.head.append(targetStyle);
    const targetOwner = target.createElement("input"); targetOwner.style.cssText = "position:fixed;right:0;bottom:0;width:100px";
    target.body.append(targetOwner);
    const foreign = make(target, targetOwner); await tick();
    inside(foreign.container, {left: 0, top: 0, right: target.defaultView.innerWidth, bottom: target.defaultView.innerHeight});
    foreign.close(); iframe.remove();
    return "Date picker positioning passed";
};

for (const [width, height] of [[900, 900], [320, 600], [260, 240]]) {
    test(`date picker anchored layout in the real ${width}x${height} viewport`, {timeout: 45000, skip: !canRunBrowser}, async () => {
        const sources = {...browserSources(Object.fromEntries(["model", "yearInput", "field", "position"].map(name =>
            [name, join(__dirname, name + ".ts")]))),
        ...browserSources({menuPosition: join(__dirname, "../menus/menuPosition.ts")}),
        icons: readFileSync(join(__dirname, "../../appearance/icons/litheness/icon.js"), "utf8")};
        const css = readFileSync(join(__dirname, "../../appearance/themes/daylight/theme.css"), "utf8") +
            compile(join(__dirname, "../assets/scss/base.scss"), {logger: {warn() {}}}).css;
        assert.match(await runBrowserCase(browserCases, sources, css, {width, height}), /Date picker positioning passed/);
    });
}
