import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {genNumberInputHtml, genStackHtml} from "./render";
import {controlTextBlock} from "../setting/control";

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
    it("disables spell checking for technical fields while preserving the editor preference for prose", () => {
        if (typeof Lute === "undefined") {
            require("../../../stage/protyle/js/lute/lute.min.js");
        }
        const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
        try {
            for (const enabled of [true, false]) {
                Object.defineProperty(globalThis, "window", {
                    configurable: true,
                    value: {siyuan: {config: {editor: {spellcheck: enabled}}}},
                });
                for (const mode of ["input-text", "textarea", "input-password"] as const) {
                    const technical = controlTextBlock("technical", {
                        mode, spellcheck: false, readConfig: () => "sort.json",
                    });
                    const prose = controlTextBlock("prose", {
                        mode, readConfig: () => "Some text",
                    });
                    assert.match(genStackHtml([{left: technical}]), /spellcheck="false"/);
                    const expected = mode === "input-password" ? false : enabled;
                    assert.ok(genStackHtml([{left: prose}]).includes(`spellcheck="${expected}"`));
                }
            }
        } finally {
            if (originalWindow) {
                Object.defineProperty(globalThis, "window", originalWindow);
            } else {
                Reflect.deleteProperty(globalThis, "window");
            }
        }
    });

    it("escapes textarea closing tags and literal character references", () => {
        if (typeof Lute === "undefined") {
            require("../../../stage/protyle/js/lute/lute.min.js");
        }
        const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {siyuan: {config: {editor: {spellcheck: false}}}},
        });
        try {
            const html = genStackHtml([{
                left: {
                    kind: "textBlock", id: "macros", mode: "textarea",
                    readConfig: () => "</textarea><img src=x>\n&amp; &#60; &lt;",
                    readValue: (el) => (el as HTMLTextAreaElement).value,
                },
            }]);

            assert.match(html, />&lt;\/textarea&gt;&lt;img src=x&gt;\n&amp;amp; &amp;#60; &amp;lt;<\/textarea>/);
            assert.equal((html.match(/<\/textarea>/g) || []).length, 1);
            assert.doesNotMatch(html, /<img/);
        } finally {
            if (originalWindow) {
                Object.defineProperty(globalThis, "window", originalWindow);
            } else {
                Reflect.deleteProperty(globalThis, "window");
            }
        }
    });

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
