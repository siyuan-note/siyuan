import {after, before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {renderCalendarDockPeriod} from "./calendar-period";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

before(() => {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {config: {lang: "en"}, languages: {}},
        },
    });
});

after(() => {
    if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
    } else {
        Reflect.deleteProperty(globalThis, "window");
    }
});

describe("Calendar dock period label", () => {
    const title = "August 2026";

    it("keeps the outer period label in Day view", () => {
        const markup = renderCalendarDockPeriod("day", title);
        assert.match(markup, /class="av__calendar-dock-period"/);
        assert.ok(markup.includes(title));
    });

    it("keeps the outer period label in Schedule view", () => {
        const markup = renderCalendarDockPeriod("agenda", title);
        assert.match(markup, /class="av__calendar-dock-period"/);
        assert.ok(markup.includes(title));
    });

    it("suppresses the outer period label in Month view", () => {
        assert.equal(renderCalendarDockPeriod("month", title), "");
    });

    it("Month view keeps exactly one month title, inside the mini navigator between its arrows", () => {
        // The mini month navigator cannot execute under node:test (its dayjs
        // `import *` binding is webpack-only), so assert the rendered template
        // contract directly from source: one title, ordered prev < title < next.
        const source = fs.readFileSync(path.join(__dirname, "../../protyle/render/av/calendar/mini-month.ts"), "utf8");
        const headerStart = source.indexOf("av__calendar-mini-header");
        const headerEnd = source.indexOf("av__calendar-mini-weekdays");
        assert.ok(headerStart !== -1 && headerEnd !== -1 && headerEnd > headerStart, "mini header template found");
        const header = source.slice(headerStart, headerEnd);
        const titles = header.match(/av__calendar-mini-title/g) || [];
        assert.equal(titles.length, 1, "mini navigator renders exactly one month title");
        const prev = header.indexOf('data-type="calendar-mini-prev"');
        const titleIndex = header.indexOf("av__calendar-mini-title");
        const next = header.indexOf('data-type="calendar-mini-next"');
        assert.ok(prev !== -1 && titleIndex !== -1 && next !== -1, "prev arrow, title and next arrow all present in mini header");
        assert.ok(prev < titleIndex && titleIndex < next, "the single month title sits between the prev/next arrows");
    });
});
