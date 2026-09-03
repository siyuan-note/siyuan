const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
    createRemoteDocumentContentSecurityPolicy,
    getArgFrom,
    getInsecureCertificateSwitchName,
    getRemoteKernelRedirectDecision,
    getRemoteKernelRequestPolicy,
    getRemoteKernelWebRequestDestination,
    getRemoteKernelVersionStatus,
    getUnsafeRemoteChromiumSwitchName,
    getRemoteDocumentInlineScriptSources,
    insecureCertificateSwitchNames,
    isAllowedRemoteExternalURL,
    normalizeRemoteKernelOrigin,
    remoteKernelActiveStorageTypes,
    shouldBlockRemoteFrameNavigation,
    shouldForwardRemoteDeepLink,
    shouldTrustLocalKernelCertificate,
    unsafeRemoteChromiumSwitchNames,
} = require("./remoteKernel");

test("getArgFrom preserves equals signs in values", () => {
    assert.equal(getArgFrom(["--remote=https://example.com/?token=a=b"], "--remote"),
        "https://example.com/?token=a=b");
});

test("normalizeRemoteKernelOrigin accepts HTTPS origins", () => {
    assert.equal(normalizeRemoteKernelOrigin("https://example.com"), "https://example.com");
    assert.equal(normalizeRemoteKernelOrigin("https://example.com:443/"), "https://example.com");
    assert.equal(normalizeRemoteKernelOrigin("https://example.com:8443/"), "https://example.com:8443");
});

test("normalizeRemoteKernelOrigin rejects insecure or non-origin URLs", () => {
    [
        "",
        "http://example.com",
        "https://user:password@example.com",
        "https://example.com/path",
        "https://example.com/?query=value",
        "https://example.com?",
        "https://example.com/#fragment",
        "https://example.com#",
    ].forEach((value) => assert.throws(() => normalizeRemoteKernelOrigin(value)));
});

test("remote kernel request policy rejects lifecycle and workspace APIs", () => {
    [
        "/api/system/exit",
        "/api/system/uiproc",
        "/api/system/setWorkspaceDir",
        "/api/system/createWorkspaceDir",
        "/api/system/removeWorkspaceDir",
        "/api/system/removeWorkspaceDirPhysically",
        "/api/system/checkUpdate",
        "/api/system/setDownloadInstallPkg",
        "/api/system/setNetworkServe",
        "/api/system/setNetworkServeTLS",
        "/api/system/setUpdateChannel",
    ].forEach((pathname) => assert.equal(getRemoteKernelRequestPolicy({
        method: "POST",
        pathname,
        destination: "",
        localResourceAvailable: false,
    }), "deny-api"));
    assert.equal(getRemoteKernelRequestPolicy({
        method: "POST",
        pathname: "/api/system/%65xit/",
        destination: "",
        localResourceAvailable: false,
    }), "deny-api");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "POST",
        pathname: "/api/system/%2565xit",
        destination: "",
        localResourceAvailable: false,
    }), "deny-api");
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

test("remote document CSP covers the packaged app, window, and authorization pages", () => {
    const documentPaths = [
        path.join(__dirname, "../stage/build/app/index.html"),
        path.join(__dirname, "../stage/build/app/window.html"),
        path.join(__dirname, "remote-auth.html"),
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

test("web request resource types map to enforceable active-content destinations", () => {
    assert.equal(getRemoteKernelWebRequestDestination("mainFrame"), "document");
    assert.equal(getRemoteKernelWebRequestDestination("subFrame"), "frame");
    assert.equal(getRemoteKernelWebRequestDestination("stylesheet"), "style");
    assert.equal(getRemoteKernelWebRequestDestination("script"), "script");
    assert.equal(getRemoteKernelWebRequestDestination("worker"), "worker");
    assert.equal(getRemoteKernelWebRequestDestination("xhr"), "");
    assert.equal(getRemoteKernelWebRequestDestination("image"), "");
});

test("remote kernel request policy rejects remotely supplied active content", () => {
    ["document", "frame", "iframe", "object", "embed", "script", "style", "worker", "sharedworker",
        "serviceworker", "audioworklet", "paintworklet", "xslt"].forEach((destination) => {
        assert.equal(getRemoteKernelRequestPolicy({
            method: "GET",
            pathname: "/untrusted/content",
            destination,
            localResourceAvailable: false,
        }), "deny-active-content");
    });
    assert.equal(getRemoteKernelRequestPolicy({
        method: "POST",
        pathname: "/stage/build/app/",
        destination: "document",
        localResourceAvailable: true,
    }), "deny-active-content");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/stage/build/%61pp/",
        destination: "document",
        localResourceAvailable: true,
    }), "deny-active-content");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/",
        destination: "document",
        localResourceAvailable: false,
    }), "deny-active-content");
});

test("remote kernel request policy serves trusted UI locally and forwards data", () => {
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/stage/build/app/",
        destination: "document",
        localResourceAvailable: true,
    }), "local");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/stage/build/app/index.js",
        destination: "script",
        localResourceAvailable: true,
    }), "local");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/appearance/themes/daylight/theme.css",
        destination: "style",
        localResourceAvailable: true,
    }), "local");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/stage/build/app/layout-worker.js",
        destination: "worker",
        localResourceAvailable: true,
    }), "local");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "POST",
        pathname: "/api/block/getBlockInfo",
        destination: "",
        localResourceAvailable: false,
    }), "remote");
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/assets/image.png",
        destination: "image",
        localResourceAvailable: false,
    }), "remote");
});

test("remote protocol only accepts active content from packaged target resources", () => {
    ["document", "frame", "iframe", "object", "embed", "script", "style", "worker", "sharedworker",
        "serviceworker", "audioworklet", "paintworklet", "xslt"].forEach((destination) => {
        assert.equal(getRemoteKernelRequestPolicy({
            method: "GET",
            pathname: "/external/content",
            destination,
            localResourceAvailable: false,
            isTargetOrigin: false,
        }), "deny-active-content");
    });
    ["image", "media", "font", ""].forEach((destination) => {
        assert.equal(getRemoteKernelRequestPolicy({
            method: "GET",
            pathname: "/external/content",
            destination,
            localResourceAvailable: false,
            isTargetOrigin: false,
        }), "remote");
    });
    assert.equal(getRemoteKernelRequestPolicy({
        method: "GET",
        pathname: "/stage/build/app/local-worker.js",
        destination: "worker",
        localResourceAvailable: true,
        isTargetOrigin: true,
    }), "local");
    ["sharedworker", "serviceworker", "audioworklet", "paintworklet"].forEach((destination) => {
        assert.equal(getRemoteKernelRequestPolicy({
            method: "GET",
            pathname: "/stage/build/app/local-worker.js",
            destination,
            localResourceAvailable: true,
            isTargetOrigin: true,
        }), "deny-active-content");
    });
});

test("certificate trust exception only applies to an owned loopback kernel", () => {
    assert.equal(shouldTrustLocalKernelCertificate("local", "127.0.0.1"), true);
    assert.equal(shouldTrustLocalKernelCertificate("local", "localhost"), true);
    assert.equal(shouldTrustLocalKernelCertificate("remote", "127.0.0.1"), false);
    assert.equal(shouldTrustLocalKernelCertificate("remote", "localhost"), false);
    assert.equal(shouldTrustLocalKernelCertificate("local", "example.com"), false);
});

test("remote mode clears only active web storage that could replace the packaged frontend", () => {
    assert.deepEqual(remoteKernelActiveStorageTypes, ["serviceworkers", "cachestorage"]);
    ["cookies", "filesystem", "indexdb", "localstorage"].forEach((storageType) => {
        assert.equal(remoteKernelActiveStorageTypes.includes(storageType), false);
    });
});

test("remote mode recognizes Chromium switches that weaken certificate verification", () => {
    [
        "--ignore-certificate-errors",
        "--ignore-certificate-errors-spki-list=sha256/test",
        "--allow-insecure-localhost",
        "--ignore-ssl-errors",
        "--ignore-ssl-errors-with-hosts=example.com",
    ].forEach((arg) => assert.ok(getInsecureCertificateSwitchName(arg)));
    assert.equal(getInsecureCertificateSwitchName("--disable-gpu"), undefined);
    assert.equal(getInsecureCertificateSwitchName("ignore-certificate-errors"), undefined);
    assert.ok(insecureCertificateSwitchNames.includes("ignore-certificate-errors"));
    assert.ok(insecureCertificateSwitchNames.includes("allow-insecure-localhost"));
});

test("remote mode recognizes Chromium switches that weaken renderer security", () => {
    assert.equal(getUnsafeRemoteChromiumSwitchName("--disable-web-security"), "disable-web-security");
    assert.equal(getUnsafeRemoteChromiumSwitchName("--allow-running-insecure-content"),
        "allow-running-insecure-content");
    assert.equal(getUnsafeRemoteChromiumSwitchName("--disable-site-isolation-trials"),
        "disable-site-isolation-trials");
    assert.equal(getUnsafeRemoteChromiumSwitchName("--disable-site-isolation-for-policy"),
        "disable-site-isolation-for-policy");
    assert.equal(getUnsafeRemoteChromiumSwitchName("--disable-features=CalculateNativeWinOcclusion,IsolateOrigins"),
        "disable-features");
    assert.equal(getUnsafeRemoteChromiumSwitchName("--disable-features=AutoupgradeMixedContent"), undefined);
    assert.ok(unsafeRemoteChromiumSwitchNames.includes("ignore-certificate-errors"));
    assert.ok(unsafeRemoteChromiumSwitchNames.includes("disable-web-security"));
    assert.equal(getUnsafeRemoteChromiumSwitchName("--disable-gpu"), undefined);
});

test("remote mode only opens web URLs through the operating system", () => {
    assert.equal(isAllowedRemoteExternalURL("https://example.com/path"), true);
    assert.equal(isAllowedRemoteExternalURL("http://example.com/path"), true);
    assert.equal(isAllowedRemoteExternalURL("file:///tmp/document"), false);
    assert.equal(isAllowedRemoteExternalURL("javascript:alert(1)"), false);
    assert.equal(isAllowedRemoteExternalURL("siyuan://blocks/20200101000000-abcdefg"), false);
    assert.equal(isAllowedRemoteExternalURL("not a URL"), false);
});

test("remote mode blocks every nested frame navigation and load", () => {
    assert.equal(shouldBlockRemoteFrameNavigation({isMainFrame: true}), false);
    assert.equal(shouldBlockRemoteFrameNavigation({isMainFrame: false}), true);
    assert.equal(shouldBlockRemoteFrameNavigation({resourceType: "subFrame"}), true);
    assert.equal(shouldBlockRemoteFrameNavigation({resourceType: "object"}), true);
    assert.equal(shouldBlockRemoteFrameNavigation({resourceType: "image"}), false);
    assert.equal(shouldBlockRemoteFrameNavigation({resourceType: "xhr"}), false);
});

test("remote redirects stay on the configured origin and retain method semantics", () => {
    const exitRedirect = getRemoteKernelRedirectDecision({
        status: 307,
        location: "/api/system/exit",
        origin: "https://example.com",
        method: "POST",
    });
    assert.equal(exitRedirect.action, "follow");
    assert.equal(exitRedirect.method, "POST");
    assert.equal(getRemoteKernelRequestPolicy({
        method: exitRedirect.method,
        pathname: exitRedirect.url.pathname,
        destination: "",
        localResourceAvailable: false,
    }), "deny-api");
    assert.deepEqual(getRemoteKernelRedirectDecision({
        status: 302,
        location: "https://other.example/path",
        origin: "https://example.com",
        method: "GET",
    }), {action: "deny"});
    ["file:///tmp/payload", "data:text/html,payload", "javascript:alert(1)"].forEach((location) => {
        assert.deepEqual(getRemoteKernelRedirectDecision({
            status: 302,
            location,
            origin: "https://example.com",
            method: "GET",
        }), {action: "deny"});
    });
    assert.equal(getRemoteKernelRedirectDecision({
        status: 303,
        location: "/result",
        origin: "https://example.com",
        method: "POST",
    }).method, "GET");
    assert.deepEqual(getRemoteKernelRedirectDecision({
        status: 304,
        origin: "https://example.com",
        method: "GET",
    }), {action: "none"});
});

test("remote kernel version status requires an exact valid version", () => {
    assert.equal(getRemoteKernelVersionStatus({code: 0, data: "3.8.2"}, "3.8.2"), "compatible");
    assert.equal(getRemoteKernelVersionStatus({code: 0, data: "3.8.3"}, "3.8.2"), "mismatch");
    assert.equal(getRemoteKernelVersionStatus({code: -1, data: "3.8.2"}, "3.8.2"), "invalid");
    assert.equal(getRemoteKernelVersionStatus({code: 0, data: 382}, "3.8.2"), "invalid");
});

test("remote deep links only reach the matching active remote target", () => {
    const currentOrigin = "https://example.com";
    assert.equal(shouldForwardRemoteDeepLink({
        currentOrigin,
        remoteArgumentPresent: false,
        localTargetRequested: false,
    }), true);
    assert.equal(shouldForwardRemoteDeepLink({
        currentOrigin,
        requestedOrigin: currentOrigin,
        remoteArgumentPresent: true,
        localTargetRequested: false,
    }), true);
    assert.equal(shouldForwardRemoteDeepLink({
        currentOrigin,
        requestedOrigin: "https://other.example",
        remoteArgumentPresent: true,
        localTargetRequested: false,
    }), false);
    assert.equal(shouldForwardRemoteDeepLink({
        currentOrigin,
        requestedOrigin: currentOrigin,
        remoteArgumentPresent: true,
        localTargetRequested: true,
    }), false);
    assert.equal(shouldForwardRemoteDeepLink({
        requestedOrigin: currentOrigin,
        remoteArgumentPresent: true,
        localTargetRequested: false,
    }), false);
});
