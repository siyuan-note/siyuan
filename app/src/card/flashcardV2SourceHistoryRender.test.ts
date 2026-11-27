import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {renderSourceHistoryConfiguration} from "./flashcardV2SourceHistoryRender";

const lang = {config: "Settings", tooltipText: "Hint", group: "Group", enable: "Enabled", disable: "Disabled",
    matchDiacritics: "Match diacritics", width: "Width"};

describe("source history configuration", () => {
    it("escapes historical content and handles object prototype names as plain data", () => {
        const html = renderSourceHistoryConfiguration(JSON.parse('{"hint":"<img src=x onerror=alert(1)>","__proto__":"constructor"}'), new Map(), lang);
        assert.ok(html.includes("&lt;img"));
        assert.ok(!html.includes("<img"));
        assert.ok(html.includes("constructor"));
    });

    it("uses shared group labels and highlights changed geometry", () => {
        const config = {groupIDs: ["stable-group"], width: 0.4};
        const html = renderSourceHistoryConfiguration(config, new Map([["stable-group", "#2"]]), lang,
            {groupIDs: ["stable-group"], width: 0.2});
        assert.ok(html.includes("#2"));
        assert.ok(!html.includes("stable-group"));
        assert.ok(html.includes('<dt class="ft__error">Width</dt>'));
        assert.ok(html.includes("<dt>Group</dt>"));
    });

    it("shows the positive match-diacritics setting with its correct polarity", () => {
        const html = renderSourceHistoryConfiguration({ignoreDiacritics: true}, new Map(), lang);
        assert.ok(html.includes("<dt>Match diacritics</dt><dd>Disabled</dd>"));
    });
});
