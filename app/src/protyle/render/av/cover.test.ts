import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getCardCoverImageHTML} from "./cover";

describe("getCardCoverImageHTML", () => {
    it("escapes a title image used as inline style", () => {
        const html = getCardCoverImageHTML("background:red;\" onload=\"require('child_process')\" x=\"", "", false);

        assert.equal(html.includes(" onload=\""), false);
        assert.match(html, /style="background:red;&quot; onload=&quot;/);
    });

    it("escapes a title image used as image source", () => {
        const payload = "missing\" onerror=\"require('child_process')";
        const html = getCardCoverImageHTML(payload, payload, false);

        assert.equal(html.includes(" onerror=\""), false);
        assert.match(html, /src="missing&quot; onerror=&quot;/);
    });

    it("preserves built-in background styles", () => {
        const coverStyle = "background:linear-gradient(#fff 50%, transparent 0);background-size:20px 20px;";

        assert.equal(getCardCoverImageHTML(coverStyle, "", false).includes(`style="${coverStyle}"`), true);
    });

    it("preserves image compression and fitting", () => {
        const html = getCardCoverImageHTML("assets/cover.png", "assets/cover.png?style=thumb", true);

        assert.match(html, /class="av__gallery-img av__gallery-img--fit"/);
        assert.match(html, /src="assets\/cover\.png\?style=thumb"/);
    });
});
