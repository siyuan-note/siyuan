import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {genNumberInputHtml, genStackHtml} from "./render";

describe("genNumberInputHtml", () => {
    it("keeps the unit next to the input inside the number wrapper", () => {
        const html = genNumberInputHtml("timeout", 30, 0, 100, undefined, "s");

        assert.match(html, /class="fn__size200 fn__flex-center fn__flex config-item__number"/);
        assert.match(html, /<span class="ft__on-surface fn__flex-center">s<\/span>/);
    });

    it("renders a standalone input when there is no unit", () => {
        const html = genNumberInputHtml("timeout", 30);

        assert.match(html, /class="b3-text-field fn__flex-center fn__size200"/);
        assert.doesNotMatch(html, /config-item__number/);
    });
});

describe("genStackHtml", () => {
    it("renders descriptions with controls using the primary text color", () => {
        const html = genStackHtml([{
            left: {kind: "desc", text: "Setting name"},
            right: {kind: "button", id: "setting", label: "Configure", icon: "iconSettings"},
        }]);

        assert.match(html, /class="fn__flex-center fn__flex-1 config-item__main">Setting name<\/div>/);
        assert.doesNotMatch(html, /ft__on-surface/);
    });

    it("keeps standalone descriptions styled as secondary text", () => {
        const html = genStackHtml([{left: {kind: "desc", text: "Setting description"}}]);

        assert.match(html, /class="b3-label__text">Setting description<\/div>/);
    });

    it("keeps titles with controls styled as configuration names", () => {
        const html = genStackHtml([{
            left: {kind: "title", text: "Setting title"},
            right: {kind: "button", id: "setting", label: "Configure", icon: "iconSettings"},
        }]);

        assert.match(html, /class="fn__flex-center fn__flex-1 config-item__main config-name">Setting title<\/div>/);
    });
});
