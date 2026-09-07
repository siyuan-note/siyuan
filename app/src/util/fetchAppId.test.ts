import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    injectPluginStorageAppId,
    installPluginStorageFetchAppId,
    isPluginStorageWriteRequest,
    SIYUAN_APP_ID_HEADER,
} from "./fetchAppId";

const baseURL = "http://127.0.0.1:6806/stage/build/app/";

const createMockFetch = () => {
    const calls: Array<{input: RequestInfo | URL; init?: RequestInit}> = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({input, init});
        return Promise.resolve(new Response(null, {status: 200}));
    }) as typeof fetch;
    return {calls, fetcher};
};

const getHeader = (init: RequestInit | undefined, name: string) =>
    init?.headers === undefined ? null : new Headers(init.headers).get(name);

describe("plugin storage fetch app id", () => {
    it("matches only same-origin POST requests to exact write endpoints", () => {
        assert.equal(isPluginStorageWriteRequest("/api/file/putFile", {method: "POST"}, baseURL), true);
        assert.equal(isPluginStorageWriteRequest("/api/file/removeFile?path=test", {method: "post"}, baseURL), true);
        assert.equal(isPluginStorageWriteRequest(
            "http://127.0.0.1:6806/api/file/putFile", {method: "POST"}, baseURL), true);
        assert.equal(isPluginStorageWriteRequest(
            new URL("/api/file/removeFile", baseURL), {method: "POST"}, baseURL), true);
        assert.equal(isPluginStorageWriteRequest("/api/file/putFile", {method: "GET"}, baseURL), false);
        assert.equal(isPluginStorageWriteRequest("/api/file/putFile/extra", {method: "POST"}, baseURL), false);
        assert.equal(isPluginStorageWriteRequest("/api/file/getFile?next=/api/file/putFile", {method: "POST"},
            baseURL), false);
        assert.equal(isPluginStorageWriteRequest(
            "https://example.com/api/file/putFile", {method: "POST"}, baseURL), false);
    });

    it("injects the current app id and preserves init options", async () => {
        const {calls, fetcher} = createMockFetch();
        const wrappedFetch = injectPluginStorageAppId(fetcher, "app-current", baseURL);
        const controller = new AbortController();
        const init: RequestInit = {
            method: "POST",
            body: "data",
            cache: "no-store",
            headers: {Accept: "application/json", [SIYUAN_APP_ID_HEADER]: "app-forged"},
            signal: controller.signal,
        };

        await wrappedFetch("/api/file/putFile", init);

        assert.equal(calls.length, 1);
        assert.equal(calls[0].input, "/api/file/putFile");
        assert.equal(calls[0].init?.method, "POST");
        assert.equal(calls[0].init?.body, "data");
        assert.equal(calls[0].init?.cache, "no-store");
        assert.equal(calls[0].init?.signal, controller.signal);
        assert.equal(getHeader(calls[0].init, "Accept"), "application/json");
        assert.equal(getHeader(calls[0].init, SIYUAN_APP_ID_HEADER), "app-current");
        assert.equal(new Headers(init.headers).get(SIYUAN_APP_ID_HEADER), "app-forged");
    });

    it("preserves headers and method supplied by a Request object", async () => {
        const {calls, fetcher} = createMockFetch();
        const wrappedFetch = injectPluginStorageAppId(fetcher, "app-current", baseURL);
        const request = new Request("http://127.0.0.1:6806/api/file/removeFile", {
            method: "POST",
            headers: {Authorization: "Token test", "Content-Type": "application/json"},
            body: "{}",
        });

        await wrappedFetch(request);

        assert.equal(calls[0].input, request);
        assert.equal(getHeader(calls[0].init, "Authorization"), "Token test");
        assert.equal(getHeader(calls[0].init, "Content-Type"), "application/json");
        assert.equal(getHeader(calls[0].init, SIYUAN_APP_ID_HEADER), "app-current");
    });

    it("passes unrelated requests through without replacing their arguments", async () => {
        const {calls, fetcher} = createMockFetch();
        const wrappedFetch = injectPluginStorageAppId(fetcher, "app-current", baseURL);
        const init: RequestInit = {method: "POST", headers: {Accept: "application/json"}};

        await wrappedFetch("/api/transactions", init);

        assert.equal(calls[0].input, "/api/transactions");
        assert.equal(calls[0].init, init);
        assert.equal(getHeader(calls[0].init, SIYUAN_APP_ID_HEADER), null);
    });

    it("installs the wrapper only once", async () => {
        const {calls, fetcher} = createMockFetch();
        const target = {fetch: fetcher};

        installPluginStorageFetchAppId(target, "app-current", baseURL);
        const installedFetch = target.fetch;
        installPluginStorageFetchAppId(target, "app-current", baseURL);

        assert.equal(target.fetch, installedFetch);
        await target.fetch("/api/file/putFile", {method: "POST"});
        assert.equal(calls.length, 1);
        assert.equal(getHeader(calls[0].init, SIYUAN_APP_ID_HEADER), "app-current");
    });
});
