import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    detectRemoteKernel, hasRemoteArgument, isExternalURLAllowed, resolveHostCapabilities, resolveRemoteKernel,
    type TKernelConnection,
} from "./hostCapabilities";

describe("trusted remote extension capabilities", () => {
    const connection: TKernelConnection = {
        kernelMode: "remote", ownsKernel: false, kernelOrigin: "https://example.com",
        trustRemoteExtensions: true,
    };

    it("only enables plugins and appearance for the matching host connection", () => {
        const restricted = resolveHostCapabilities(true, undefined, connection.kernelOrigin);
        assert.equal(restricted.plugins, false);
        assert.equal(restricted.customAppearance, false);
        assert.deepEqual(resolveHostCapabilities(true, connection, connection.kernelOrigin), {
            ...restricted, plugins: true, customAppearance: true,
        });
        for (const origin of ["https://other.example.com", "https://example.com:8443", "http://example.com"]) {
            assert.deepEqual(resolveHostCapabilities(true, connection, origin), restricted);
        }
        assert.deepEqual(resolveHostCapabilities(true, {...connection, trustRemoteExtensions: false},
            connection.kernelOrigin), restricted);
        assert.deepEqual(resolveHostCapabilities(true, {...connection, kernelMode: "local"},
            connection.kernelOrigin), restricted);
    });

    it("does not grant trust from query strings or renderer command line arguments", () => {
        const remote = detectRemoteKernel("?remote=1&trustRemoteExtensions=true", ["--trust-remote-extensions"]);
        assert.equal(resolveHostCapabilities(remote, undefined, connection.kernelOrigin).plugins, false);
    });

    it("preserves local capabilities", () => {
        const local = resolveHostCapabilities(false, undefined, "https://127.0.0.1:6806");
        assert.equal(local.remoteKernel, false);
        for (const [name, value] of Object.entries(local)) {
            if (name !== "remoteKernel") {
                assert.equal(value, true, name);
            }
        }
    });
});

describe("remote kernel detection", () => {
    it("detects the remote query", () => {
        assert.equal(detectRemoteKernel("?remote=1", []), true);
        assert.equal(detectRemoteKernel("?remote=0", []), false);
    });

    it("detects the remote command line argument", () => {
        assert.equal(hasRemoteArgument(["SiYuan", "--remote=https://example.com"]), true);
        assert.equal(hasRemoteArgument(["SiYuan", "--remote"]), true);
        assert.equal(hasRemoteArgument(["SiYuan", "--remote-proxy=https://example.com"]), false);
    });

    it("uses the command line as a fallback", () => {
        assert.equal(detectRemoteKernel("", ["--remote=https://example.com/path?a=b"]), true);
    });

    it("uses the host connection after initialization", () => {
        assert.equal(resolveRemoteKernel({
            kernelMode: "local",
            ownsKernel: true,
            kernelOrigin: "http://127.0.0.1:6806",
        }, "?remote=1", ["--remote=https://example.com"]), false);
        assert.equal(resolveRemoteKernel({
            kernelMode: "remote",
            ownsKernel: false,
            kernelOrigin: "https://example.com",
        }, "", []), true);
    });
});

describe("external URL capabilities", () => {
    it("allows only HTTP URLs for a remote kernel", () => {
        assert.equal(isExternalURLAllowed("https://example.com/auth", true), true);
        assert.equal(isExternalURLAllowed("http://127.0.0.1:3000/auth", true), true);
        assert.equal(isExternalURLAllowed("/assets/file.pdf", true), false);
        assert.equal(isExternalURLAllowed("assets/file.pdf", true), false);
        assert.equal(isExternalURLAllowed("\\\\server\\share\\note.txt", true), false);
        assert.equal(isExternalURLAllowed("javascript:alert(1)", true), false);
        assert.equal(isExternalURLAllowed("file:///tmp/note.txt", true), false);
        assert.equal(isExternalURLAllowed("data:text/html,<script>alert(1)</script>", true), false);
        assert.equal(isExternalURLAllowed("siyuan://blocks/20260903150000-abcdefg", true), false);
        assert.equal(isExternalURLAllowed("not a URL", true), false);
    });

    it("preserves local external URL handling", () => {
        assert.equal(isExternalURLAllowed("mailto:test@example.com", false), true);
        assert.equal(isExternalURLAllowed("file:///tmp/note.txt", false), true);
    });
});
