import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    calculateCardCoverPosition,
    getCardCoverImageHTML,
    getCardCoverSource,
    isCardCoverPointerMoveActive
} from "./cover";

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

    it("does not render cross-origin HEIF covers", () => {
        assert.equal(getCardCoverImageHTML(
            "https://example.com/cover.heic",
            "https://example.com/cover.heic",
            false,
        ), "");
    });

    it("applies a stored position only to the same image", () => {
        const position = {image: "assets/cover.png", x: 12.5, y: 87.5};

        assert.match(getCardCoverImageHTML(position.image, position.image, false, position),
            /style="object-position:12\.5% 87\.5%"/);
        assert.doesNotMatch(getCardCoverImageHTML("assets/replaced.png", "assets/replaced.png", false, position),
            /object-position/);
    });
});

describe("getCardCoverSource", () => {
    it("shares positions by content or asset source", () => {
        assert.equal(getCardCoverSource({coverFrom: 1} as IAVGallery), "content");
        assert.equal(getCardCoverSource({
            coverFrom: 2,
            coverFromAssetKeyID: "20200101000000-abcdefg",
        } as IAVKanban), "asset:20200101000000-abcdefg");
        assert.equal(getCardCoverSource({coverFrom: 3} as IAVGallery), "");
    });
});

describe("calculateCardCoverPosition", () => {
    it("moves and clamps both axes independently", () => {
        assert.deepEqual(calculateCardCoverPosition(50, 50, -25, 20, 100, 40), {x: 75, y: 0});
        assert.deepEqual(calculateCardCoverPosition(90, 10, -100, 100, 20, 20), {x: 100, y: 0});
    });

    it("keeps an axis centered when the image does not overflow", () => {
        assert.deepEqual(calculateCardCoverPosition(50, 25, 30, 10, 0, 0), {x: 50, y: 25});
    });
});

describe("isCardCoverPointerMoveActive", () => {
    it("stops a mouse drag when the button was released outside the window", () => {
        assert.equal(isCardCoverPointerMoveActive(1, 1, "mouse", 1), true);
        assert.equal(isCardCoverPointerMoveActive(1, 1, "mouse", 0), false);
        assert.equal(isCardCoverPointerMoveActive(1, 2, "mouse", 1), false);
    });

    it("keeps touch pointer moves active without relying on mouse button state", () => {
        assert.equal(isCardCoverPointerMoveActive(1, 1, "touch", 0), true);
    });
});
