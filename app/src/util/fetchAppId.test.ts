import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    injectPluginStorageAppId,
    installPluginStorageFetchAppId,
    isPluginStorageWriteRequest,
    SIYUAN_APP_ID_HEADER,
    isSameOriginAPIRequest,
    withAPIAppId,
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


describe("host API app id", () => {
    const origin = new URL(baseURL).origin;

    it("resolves document-relative URLs but compares the window origin", () => {
        for (const input of ["/api/test", "../../../api/test?q=1", new URL("/api/test", baseURL),
            new Request(new URL("/api/test", baseURL))]) {
            assert.equal(isSameOriginAPIRequest(input, baseURL, origin), true);
        }
        for (const input of ["/api", "/apis/test", "/assets/test", "https://example.com/api/test", "http://["]) {
            assert.equal(isSameOriginAPIRequest(input, baseURL, origin), false);
        }
        assert.equal(isSameOriginAPIRequest("/api/test", "https://example.com/", origin), false);
        assert.equal(isSameOriginAPIRequest(`${origin}/api/test`, "https://example.com/", origin), true);
    });

    it("preserves Request body, signal and init header override semantics", async () => {
        const controller = new AbortController();
        const request = new Request(`${origin}/api/test`, {method: "POST", body: "request-body",
            headers: {Authorization: "request-auth"}, signal: controller.signal});
        const inherited = withAPIAppId(request, undefined, "caller", baseURL, origin);
        assert.equal(getHeader(inherited, "Authorization"), "request-auth");
        const effective = new Request(request, inherited);
        assert.equal(await effective.text(), "request-body");
        assert.equal(effective.method, "POST");
        assert.equal(request.headers.has(SIYUAN_APP_ID_HEADER), false);
        controller.abort();
        assert.equal(effective.signal.aborted, true);

        const headers = new Headers({Accept: "text/event-stream", [SIYUAN_APP_ID_HEADER]: "other"});
        const init = Object.freeze({headers, cache: "no-store" as RequestCache});
        const overridden = withAPIAppId(request, init, "caller", baseURL, origin);
        assert.equal(getHeader(overridden, "Authorization"), null);
        assert.equal(getHeader(overridden, "Accept"), "text/event-stream");
        assert.equal(getHeader(overridden, SIYUAN_APP_ID_HEADER), "caller");
        assert.equal(headers.get(SIYUAN_APP_ID_HEADER), "other");
        assert.equal(overridden.cache, "no-store");
    });

    it("preserves FormData without setting its content type and leaves external init untouched", () => {
        const body = new FormData();
        body.append("file", "data");
        const signal = new AbortController().signal;
        const init: RequestInit = {method: "POST", body, signal, credentials: "include", keepalive: true,
            headers: [["Accept", "application/json"]]};
        const updated = withAPIAppId("/api/asset/upload", init, "caller", baseURL, origin);
        assert.equal(updated.body, body);
        assert.equal(updated.signal, signal);
        assert.equal(updated.credentials, "include");
        assert.equal(updated.keepalive, true);
        assert.equal(getHeader(updated, "Content-Type"), null);
        assert.equal(getHeader(init, SIYUAN_APP_ID_HEADER), null);
        assert.equal(withAPIAppId("https://example.com/api/upload", init, "caller", baseURL, origin), init);
        assert.equal(withAPIAppId("/assets/test", undefined, "caller", baseURL, origin), undefined);
    });

    it("does not expand the global plugin wrapper to other APIs or external document bases", async () => {
        const {calls, fetcher} = createMockFetch();
        const wrapped = injectPluginStorageAppId(fetcher, "caller", "https://example.com/", origin);
        const init = {method: "POST"};
        await wrapped("/api/file/putFile", init);
        await wrapped(`${origin}/api/transactions`, init);
        await wrapped(`${origin}/api/file/putFile`, init);
        assert.equal(calls[0].init, init);
        assert.equal(calls[1].init, init);
        assert.equal(getHeader(calls[2].init, SIYUAN_APP_ID_HEADER), "caller");
    });
});
