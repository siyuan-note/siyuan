import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {flashcardV2ReviewDay} from "./flashcardV2Calendar";

describe("flashcardV2Calendar", () => {
    it("uses local calendar midnights across daylight saving changes", () => {
        const previous = process.env.TZ;
        process.env.TZ = "America/New_York";
        try {
            const spring = flashcardV2ReviewDay(Date.parse("2026-03-08T12:00:00-04:00"));
            assert.equal(spring.reviewDayStart, Date.parse("2026-03-08T00:00:00-05:00"));
            assert.equal(spring.reviewDayEnd, Date.parse("2026-03-09T00:00:00-04:00"));
            assert.equal(spring.reviewDayEnd - spring.reviewDayStart, 23 * 3600000);
            const autumn = flashcardV2ReviewDay(Date.parse("2026-11-01T12:00:00-05:00"));
            assert.equal(autumn.reviewDayStart, Date.parse("2026-11-01T00:00:00-04:00"));
            assert.equal(autumn.reviewDayEnd, Date.parse("2026-11-02T00:00:00-05:00"));
            assert.equal(autumn.reviewDayEnd - autumn.reviewDayStart, 25 * 3600000);
        } finally {
            if (previous === undefined) {
                delete process.env.TZ;
            } else {
                process.env.TZ = previous;
            }
        }
    });
});
