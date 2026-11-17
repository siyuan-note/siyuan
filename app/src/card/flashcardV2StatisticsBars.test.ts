import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {escapeHtml} from "../util/escape";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const start = source.indexOf("const flashcardV2StatisticsBars =");
const end = source.indexOf("const flashcardV2StatisticsDistribution =", start);
assert.ok(start > 0 && end > start);
const compiled = transpileModule(source.slice(start, end), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;
const render = (counts: number[], detail = true) => runInNewContext(
    `${compiled}\nflashcardV2StatisticsBars(values, label, count, detail);`, {
        values: counts.map((value) => ({value})), count: (item: {value: number}) => item.value,
        label: () => "Date <label>", detail: detail ? () => "1 <card>" : undefined, escapeHtml,
        window: {siyuan: {languages: {emptyContent: "No <data>"}}},
    }) as string;

test("statistics bars use a locally block-sized mark while preserving relative widths and values", () => {
    const html = render([3, 1, 0]);
    assert.equal((html.match(/class="card__v2-statistics-bar"/g) || []).length, 3);
    assert.match(html, /width:100%;min-width:2px/);
    assert.match(html, /width:33\.33333333333333%;min-width:2px/);
    assert.match(html, /width:0%;min-width:0/);
    assert.ok(html.includes(`3 · ${escapeHtml("1 <card>")}`));
    assert.ok(html.includes(escapeHtml("Date <label>")));
    assert.doesNotMatch(html, /class="fn__block"/);
    assert.equal((html.match(/aria-hidden="true"/g) || []).length, 3);
    const style = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    const section = style.slice(style.indexOf("&__v2-statistics {"), style.indexOf("&__v2-basic {"));
    assert.match(section, /&-bar\s*\{\s*display: block;\s*height: 8px;/);
    assert.match(section, /background: var\(--b3-theme-primary\);/);
});

test("empty statistics render explicit escaped empty text rather than a blank plot", () => {
    const html = render([]);
    assert.ok(html.includes(escapeHtml("No <data>")));
    assert.doesNotMatch(html, /card__v2-statistics-bar|b3-list-item/);
});

test("zero-valued statistics remain zero rows and optional detail is not invented", () => {
    const html = render([0, 0], false);
    assert.equal((html.match(/width:0%;min-width:0/g) || []).length, 2);
    assert.equal((html.match(/text-align:right">0<\/span>/g) || []).length, 2);
    assert.doesNotMatch(html, /No | · |NaN|Infinity/);
});
