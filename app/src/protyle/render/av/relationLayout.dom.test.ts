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
