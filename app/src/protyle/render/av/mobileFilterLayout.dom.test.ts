import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {compile, Logger} from "sass";
import {canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";
import {loadModule} from "../../../testSupport/loadModule";
import * as capabilities from "./capabilities";
import * as filterTree from "./filterTree";

const filterSheet = (locale: string) => {
    const {getFiltersHTML} = loadModule<typeof import("./filter")>("src/protyle/render/av/filter.ts", {
        require: (name: string) => ({
            "./capabilities": capabilities, "./filterTree": filterTree,
            "./view": {getFieldsByData: (data: IAV) => (data.view as IAVTable).columns},
            "./col": {getColIconByType: () => "iconText"},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
        })[name] || {},
        window: {siyuan: {languages: JSON.parse(readFileSync(`appearance/langs/${locale}.json`, "utf8"))}},
        document: {createElement: () => ({style: {}, offsetWidth: 40}), body: {appendChild() {}, removeChild() {}}},
    });
    const text = {column: "text", operator: "Contains", value: {type: "text", text: {content: "Ada"}}};
    const relative = {count: 2, unit: 1, direction: -1};
    const children = [text,
        {column: "date", operator: "Is between", value: {type: "date"}, relativeDate: relative, relativeDate2: relative},
        {column: "select", operator: "Is", value: {type: "select"}},
        {column: "relation", operator: "Contains any item", value: {type: "relation"}},
    ];
    return getFiltersHTML({view: {
        columns: ["text", "date", "select", "relation"].map(type => ({type, id: type, name: "Long field name ".repeat(5)})),
        filters: [{combination: "and", filters: [text, {combination: "or", filters: [
            {combination: "and", filters: [{combination: "or", filters: children}]},
        ]}]}],
    }} as unknown as IAV);
};

for (const [width, locale, theme] of [[320, "de", "midnight"], [390, "zh-CN", "daylight"]] as const) {
    test(`mobile filter controls remain reachable without horizontal scrolling at ${width}px`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        // 选测需要追踪 Sass 入口间接加载的 "src/assets/scss/main/_mobile.scss" 和 "src/assets/scss/business/_av.scss"。
        const css = readFileSync(`appearance/themes/${theme}/theme.css`, "utf8") +
            compile("src/assets/scss/mobile.scss", {logger: Logger.silent}).css;
        const result = await runBrowserCase(async ({html}, stylesheet) => {
            document.head.innerHTML = `<style>${stylesheet}</style>`;
            document.documentElement.dataset.frontend = "browser-mobile";
            document.documentElement.style.setProperty("--b3-font-size", "24px");
            document.body.innerHTML = `<div class="av__panel"><div class="b3-menu b3-menu--fullscreen b3-menu--sheet av__filter-panel" style="height:400px">${html}</div></div>`;
            const items = document.querySelector<HTMLElement>(".b3-menu__items");
            items.classList.add("b3-menu__items--menu");
            for (const row of items.querySelectorAll<HTMLElement>(".av__filter-row")) {
                const field = row.querySelector("[data-type=fieldSelect]").getBoundingClientRect();
                const more = row.querySelector("[data-type=moreFilter]").getBoundingClientRect();
                const operation = row.querySelector("[data-type=operation]").getBoundingClientRect();
                if (!field.width || field.right > more.left || field.top >= more.bottom || more.top >= field.bottom ||
                    operation.top < field.bottom) {
                    throw Error("Field and More must share the first line above the operator at " + row.dataset.path);
                }
            }
            const controls = items.querySelectorAll<HTMLElement>(
                "select, input, [data-type=moreFilter], .av__select-trigger, [data-type=addFilter], [data-type=addFilterCondition], [data-type=removeFilters]");
            for (const control of controls) {
                if (!control.getClientRects().length) { continue; }
                const row = control.closest(".av__filter-row, .av__filter-group-item") || items;
                const bounds = row.getBoundingClientRect();
                const rect = control.getBoundingClientRect();
                const detail = control.dataset.type + " at " + (control.dataset.path || "root");
                if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.width < 16) {
                    throw Error(detail + " exceeds rule bounds");
                }
                items.scrollTop += rect.top - items.getBoundingClientRect().top - 40;
                const visible = control.getBoundingClientRect();
                const hit = document.elementFromPoint(visible.x + visible.width / 2, visible.y + visible.height / 2);
                if (!control.contains(hit) || getComputedStyle(control).opacity === "0") {
                    throw Error(detail + " cannot be tapped at its visible position");
                }
            }
            for (const box of [items, ...items.querySelectorAll<HTMLElement>(".av__filter-row, .av__filter-rowinner, .av__filter-group-children")]) {
                if (box.scrollWidth > box.clientWidth + 1) { throw Error("Filter controls need horizontal scrolling"); }
            }
            return "passed";
        }, {html: filterSheet(locale)}, css, {width, height: 640});
        assert.match(result, /passed/);
    });
}
