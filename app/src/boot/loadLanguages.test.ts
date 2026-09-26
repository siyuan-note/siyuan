import {it} from "node:test";
import * as assert from "node:assert/strict";
import {loadLanguages} from "./loadLanguages";

it("stops startup and shows the failed language URL when the server returns 404", async () => {
    const originalFetch = globalThis.fetch;
    const originalDocument = globalThis.document;
    const originalConsoleError = console.error;
    let displayed = "";
    let role = "";
    let className = "";
    let booted = false;
    globalThis.fetch = async () => new Response("", {status: 404});
    console.error = () => {};
    (globalThis as {document: Document}).document = {
        createElement: (tag: string) => {
            assert.equal(tag, "pre");
            return {
                className: "",
                textContent: "",
                setAttribute: (name: string, value: string) => {
                    if (name === "role") {
                        role = value;
                    }
                },
            };
        },
        body: {
            appendChild: (element: {className: string; textContent: string}) => {
                displayed = element.textContent;
                className = element.className;
            },
            replaceChildren: () => assert.fail("startup markup must remain available"),
        },
    } as unknown as Document;
    try {
        await loadLanguages("zh-CN", "3.8.6", () => booted = true);
        assert.equal(booted, false);
        assert.equal(role, "alert");
        assert.equal(className, "language-load-error");
        assert.match(displayed, /\/appearance\/langs\/zh-CN\.json\?v=3\.8\.6\nError: HTTP 404/);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalDocument === undefined) {
            delete (globalThis as {document?: Document}).document;
        } else {
            globalThis.document = originalDocument;
        }
        console.error = originalConsoleError;
    }
});

it("passes a valid language pack to startup", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({siyuanNote: "SiYuan"}), {status: 200});
    let loaded: IObject | undefined;
    try {
        await loadLanguages("en", "3.8.6", languages => loaded = languages);
        assert.equal(loaded?.siyuanNote, "SiYuan");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
