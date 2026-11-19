import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {compile, Logger} from "sass";
import {canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("relation items stay inline with icons and rich text in either wrapping mode", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const css = readFileSync("appearance/themes/daylight/theme.css", "utf8") +
        compile("src/assets/scss/base.scss", {logger: Logger.silent}).css;
    const result = await runBrowserCase(async (_sources, styles) => {
        document.head.innerHTML = `<style>${styles}</style>`;
        const check = (condition: boolean, message: string) => { if (!condition) throw Error(message); };
        for (const wrap of [false, true]) {
            for (const hiddenIcon of [false, true]) {
                for (const rich of [false, true]) {
                    const item = (text: string) => `<div class="av__cell--relation"><span class="b3-menu__avemoji${hiddenIcon ? " fn__none" : ""}"><svg></svg></span><div class="av__celltext${rich ? " av__celltext--rich b3-typography document-title-preview" : ""}">${rich ? `<p>${text}</p>` : text}</div></div>`;
                    document.body.innerHTML = `<div class="av"><div class="av__cell" data-wrap="${wrap}" style="width:300px">${item("First")}${item("Second")}</div></div>`;
                    const items = Array.from(document.querySelectorAll<HTMLElement>(".av__cell--relation"));
                    check(items[0].offsetTop === items[1].offsetTop, `Short items stay inline: ${wrap}/${hiddenIcon}/${rich}`);
                    for (const relation of items) {
                        check(getComputedStyle(relation).display === "inline-flex", "Relation layout does not depend on wrapping");
                        const text = relation.querySelector<HTMLElement>(".av__celltext");
                        const icon = relation.querySelector<HTMLElement>(".b3-menu__avemoji");
                        if (!hiddenIcon) check(icon.getBoundingClientRect().top === text.getBoundingClientRect().top, "Icon and text share a row");
                    }
                    const cell = document.querySelector<HTMLElement>(".av__cell");
                    cell.style.width = "100px";
                    items[0].querySelector(".av__celltext").textContent = "LongUnbrokenRelationTitle".repeat(4);
                    check(items[0].getBoundingClientRect().width <= cell.clientWidth + 1, "Long item fits the cell");
                    const text = items[0].querySelector<HTMLElement>(".av__celltext");
                    if (wrap) check(text.clientHeight > 30, "Wrapping permits multiline long titles");
                    else check(text.clientHeight < 30, "No-wrap keeps long titles on one line");
                }
            }
        }
        return "Relation layout passed";
    }, {}, css);
    assert.match(result, /Relation layout passed/);
});

for (const surface of ["attributes", "calendar"]) {
    test(`relation titles align with their icons in ${surface}`, {
        timeout: 60000, skip: !canRunBrowser,
    }, async () => {
        const styles = Object.fromEntries(Object.entries({base: "daylight", mobile: "midnight"}).map(([entry, theme]) => [
            entry, readFileSync(`appearance/themes/${theme}/theme.css`, "utf8") +
            compile(`src/assets/scss/${entry}.scss`, {logger: Logger.silent}).css,
        ]));
        const result = await runBrowserCase(async (styles, surface) => {
            const check = (condition: boolean, message: string) => { if (!condition) throw Error(message); };
            const checkLayout = (field: HTMLElement, wrap: boolean, rich: boolean, hiddenIcon: boolean, context: string) => {
                const [first, second] = field.querySelectorAll<HTMLElement>(".av__cell--relation");
                const title = first.querySelector<HTMLElement>(".av__celltext");
                const icon = first.querySelector<HTMLElement>(".b3-menu__avemoji");
                const firstTop = first.getBoundingClientRect().top;
                check(getComputedStyle(first).display.endsWith("flex"), `${context}: the item has a flex layout`);
                check(firstTop === second.getBoundingClientRect().top, `${context}: short items share a row`);
                if (!hiddenIcon) {
                    check(icon.getBoundingClientRect().top === title.getBoundingClientRect().top, `${context}: icon and title share a row`);
                }
                document.body.firstElementChild.setAttribute("style", "width:230px;font-size:20px");
                const longText = "LongUnbrokenRelationTitle".repeat(12);
                title.innerHTML = rich ? `<p>${longText}</p>` : longText;
                const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
                check(first.offsetWidth <= field.clientWidth, `${context}: long items fit the field`);
                check((title.clientHeight > lineHeight + 1) === wrap, `${context}: long titles follow the field wrapping mode`);
                check((second.getBoundingClientRect().top > first.getBoundingClientRect().top) === wrap,
                    `${context}: long items follow the field wrapping mode`);
            };
            for (const [entry, css] of Object.entries(styles)) {
                document.head.innerHTML = `<style>${css}</style>`;
                for (const wrap of surface === "calendar" ? [false, true] : [true]) {
                    for (const rich of [false, true]) {
                        for (const hiddenIcon of [false, true]) {
                            const item = (text: string) => `<div class="av__cell--relation"><span class="b3-menu__avemoji${hiddenIcon ? " fn__none" : ""}"><svg></svg></span><div class="av__celltext${rich ? " av__celltext--rich b3-typography document-title-preview" : ""}">${rich ? `<p>${text}</p>` : text}</div></div>`;
                            const items = item("One") + item("Two");
                            document.body.innerHTML = surface === "calendar" ?
                                `<div class="av" data-av-type="calendar" style="width:420px"><div class="av__calendar-item" style="font-size:20px"><div class="av__calendar-item-content"><div class="av__calendar-field" data-dtype="relation" data-wrap="${wrap}">${items}</div></div></div></div>` :
                                `<div class="custom-attr protyle-db-attr__body" style="width:420px;font-size:20px"><div data-av-id="av"><div class="block__icons av__row"><div class="block__logo"><span>Field</span></div><div class="fn__flex-1 fn__flex custom-attr__avvalue" data-type="relation">${items}</div></div></div></div>`;
                            const field = document.querySelector<HTMLElement>(".av__calendar-field, .custom-attr__avvalue");
                            checkLayout(field, wrap, rich, hiddenIcon, `${entry}/${surface}/${wrap}/${rich}/${hiddenIcon}`);
                        }
                    }
                }
            }
            return "Relation field layout passed";
        }, styles, surface);
        assert.match(result, /Relation field layout passed/);
    });
}
