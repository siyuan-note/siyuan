import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {requestEnglishCommandTranslations} from "./english";

describe("English command translations", () => {
    it("loads the versioned English language file without caching", async () => {
        const requests: Array<{url: string; cache?: RequestCache}> = [];
        const fetcher = (async (url: string, init?: RequestInit) => {
            requests.push({url, cache: init?.cache});
            return {
                ok: true,
                json: async () => ({search: "Search"}),
            } as Response;
        }) as typeof fetch;

        assert.deepEqual(await requestEnglishCommandTranslations("1.2.3", fetcher), {search: "Search"});
        assert.deepEqual(requests, [{
            url: "/appearance/langs/en.json?v=1.2.3",
            cache: "no-store",
        }]);
    });

    it("rejects a failed language response", async () => {
        const fetcher = (async () => ({ok: false, status: 404}) as Response) as typeof fetch;

        await assert.rejects(requestEnglishCommandTranslations("1.2.3", fetcher), /404/);
    });
});
