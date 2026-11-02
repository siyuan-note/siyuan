import {createRemoteKernelTarget} from "./remoteKernel";
import {createRemoteDocumentContentSecurityPolicy, getRemoteDocumentInlineScriptSources} from "./remoteDocument";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("trusted extension CSP authorizes snippets explicitly while retaining document restrictions", () => {
    const target = createRemoteKernelTarget("https://example.com", ["--trust-remote-extensions"]);
    const policy = createRemoteDocumentContentSecurityPolicy("<script>packaged();</script>", target.origin,
        target.extensionScriptNonce);
    assert.ok(policy.includes("'nonce-" + target.extensionScriptNonce + "'"));
    const directives = Object.fromEntries(policy.split("; ").map(value => {
        const [name, ...sources] = value.split(" ");
        return [name, sources];
    }));
    assert.ok(directives["script-src"].includes("'unsafe-eval'"));
    assert.equal(directives["script-src"].includes("'unsafe-inline'"), false);
    assert.equal(directives["script-src"].includes("'self'"), false);
    for (const pathname of ["/plugins/", "/appearance/themes/", "/appearance/icons/"]) {
        assert.ok(directives["script-src"].includes(target.origin + pathname));
    }
    for (const name of ["script-src-attr", "frame-src", "child-src", "object-src"]) {
        assert.deepEqual(directives[name], ["'none'"]);
    }
    const untrusted = createRemoteDocumentContentSecurityPolicy("", target.origin);
    assert.equal(untrusted.includes("'unsafe-eval'"), false);
    assert.equal(untrusted.includes("'nonce-"), false);
});

test("remote document CSP only permits hashed packaged inline scripts", () => {
    const html = "<!-- <button onclick=\"comment()\"> -->" +
        "<style>.example::after { content: '<button onclick=\"style()\">'; }</style>" +
        "<script src=\"/external.js\">ignored();</script>" +
        "<script>trusted();</script><button onclick=\"reload()\">Reload</button>";
    assert.deepEqual(getRemoteDocumentInlineScriptSources(html), {
        eventHandlers: ["reload()"],
        inlineScripts: ["trusted();"],
    });
    const policy = createRemoteDocumentContentSecurityPolicy(html, "https://example.com");
    assert.ok(policy.includes("'sha256-gy+T9mHal6aj/WinLcmWSKaGzIDuSIxPtm/8HDkG7f4='"));
    assert.equal(policy.includes("'sha256-sC0PQhdi5wMoECrBbPZDMcg4gm1Z2uOfLRLceVFG7RY='"), false);
    assert.ok(policy.includes("script-src https://example.com/stage/ " +
        "https://example.com/appearance/icons/litheness/icon.js blob: 'wasm-unsafe-eval'"));
    assert.ok(policy.includes("base-uri https://example.com/"));
    assert.ok(policy.includes("script-src-attr 'none'"));
    assert.ok(policy.includes("style-src 'unsafe-inline' https://example.com/stage/ " +
        "https://example.com/appearance/"));
    assert.equal(policy.includes("'unsafe-hashes'"), false);
    assert.ok(policy.includes("worker-src https://example.com/stage/"));
    assert.equal(policy.includes("worker-src https://example.com/stage/ blob:"), false);
    assert.equal(policy.includes("script-src 'self'"), false);
    assert.equal(policy.includes("worker-src 'self'"), false);
    assert.equal(policy.includes("https://example.com/appearance/icons/custom/icon.js"), false);
    assert.equal(policy.includes("'unsafe-eval'"), false);
    assert.equal(policy.includes("comment()"), false);
    assert.equal(policy.includes("style()"), false);
});

test("remote document CSP covers the app templates and authorization page", () => {
    const documentPaths = [
        path.join(__dirname, "..", "..", "src/assets/template/app/index.tpl"),
        path.join(__dirname, "..", "..", "src/assets/template/app/window.tpl"),
        path.join(__dirname, "..", "static/remote-auth.html"),
    ];
    documentPaths.forEach((documentPath) => {
        const html = fs.readFileSync(documentPath, "utf8");
        const {eventHandlers, inlineScripts} = getRemoteDocumentInlineScriptSources(html);
        const policy = createRemoteDocumentContentSecurityPolicy(html, "https://example.com");
        const uniqueScriptSources = new Set(inlineScripts);
        assert.equal((policy.match(/'sha256-/g) || []).length, uniqueScriptSources.size);
        assert.equal(eventHandlers.some((source) => policy.includes(source)), false);
        assert.equal(policy.includes("'unsafe-hashes'"), false);
        assert.equal(policy.includes("script-src 'unsafe-inline'"), false);
        assert.equal(policy.includes("'unsafe-eval'"), false);
    });
});
