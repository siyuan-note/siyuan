import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const start = source.indexOf("const openFlashcardV2ManagementFilter =");
const end = source.indexOf("const flashcardV2ManagementPageSize", start);
assert.ok(start > 0 && end > start);
const filter = source.slice(start, end);
const basic = filter.slice(filter.indexOf("content: `"), filter.indexOf("</div><details"));
const style = readFileSync("src/assets/scss/business/_card.scss", "utf8");

test("filter template keeps related fields together in DOM navigation order", () => {
    assert.deepEqual([...basic.matchAll(/data-filter="([^"]+)"|data-type="(flagFilter)"|(flashcardTagFilterFields)\(options.tags/g)]
        .map(match => match[1] || match[2] || match[3]), [
        "content", "notebookID", "path", "sourceType", "templateID", "flashcardTagFilterFields", "flagFilter", "presetID",
        "generationStatus", "reviewState", "editLater", "priority", "suspended", "buried", "dueFrom", "dueTo",
    ]);
    assert.match(basic, /<label class="b3-label card__v2-form-field--wide">[^\n]+data-filter="content"/);
    assert.equal((basic.match(/card__v2-form-field--wide/g) || []).length, 1);
});

test("filter grid declares its own spacing and wide field spans either column count", () => {
    assert.match(style, /&--grid\s*\{[^}]*display: grid;[^}]*gap: 16px;/);
    assert.match(style, /&-field--wide\s*\{\s*grid-column: 1 \/ -1;/);
    const mobile = style.slice(style.indexOf("@media screen and (max-width: 750px)"));
    assert.match(mobile, /&__v2-form--grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(style, /&__v2-form\s*\{[^}]*overflow: auto;/);
    assert.match(filter, /height: "70vh"/);
});
