const assert = require("node:assert/strict");
const {probeRemoteKernelAuthentication} = require("./remoteKernelAuth");

if (!process.versions.electron) {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    test("remote authentication probes use Electron redirects and session cookies", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-auth-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env,
                timeout: 60000,
                windowsHide: true,
            });
            assert.match(stdout, /Authentication probes passed/);
        } finally {
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
        }
    });
} else {
    const {app, net, session} = require("electron");
    const http = require("node:http");
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
        let loginRequests = 0;
        const server = http.createServer((request, response) => {
            const url = new URL(request.url, "http://localhost");
            if (url.pathname === "/timeout") {
                return;
            }
            if (url.pathname === "/disconnect") {
                request.socket.destroy();
                return;
            }
            if (url.pathname === "/redirect") {
                response.writeHead(Number(url.searchParams.get("status") || 302), {
                    Location: url.searchParams.get("to") || "/check-auth",
                });
            } else if (url.pathname === "/check-auth") {
                loginRequests++;
            } else if (url.pathname === "/session") {
                if (request.headers.cookie !== "auth=valid") {
                    response.writeHead(302, {Location: "/check-auth?to=/session"});
                }
            } else {
                response.writeHead(Number(url.searchParams.get("status") || 200));
            }
            response.end("probe");
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const origin = "http://127.0.0.1:" + server.address().port;
        const probe = (pathname, timeout) =>
            probeRemoteKernelAuthentication(net, session.defaultSession, origin + pathname, timeout);
        try {
            assert.equal(await probe("/"), true);
            assert.equal(await probe("/?status=204"), true);
            assert.equal(await probe("/?status=401"), false);
            for (const status of [301, 302, 303, 307, 308]) {
                assert.equal(await probe("/redirect?status=" + status), false);
            }
            for (const target of ["/other", "https://example.com/check-auth", "/redirect",
                origin.replace("http://", "http://user:password@") + "/check-auth"]) {
                await assert.rejects(probe("/redirect?to=" + encodeURIComponent(target)), /unexpected redirect/);
            }
            for (const status of [403, 404, 500, 503]) {
                await assert.rejects(probe("/?status=" + status), {statusCode: status});
            }
            assert.equal(await probe("/session"), false);
            await session.defaultSession.cookies.set({url: origin, name: "auth", value: "valid"});
            assert.equal(await probe("/session"), true);
            await session.defaultSession.cookies.remove(origin, "auth");
            assert.equal(await probe("/session"), false);
            assert.equal(loginRequests, 0);
            session.defaultSession.protocol.handle("http", () => {
                throw new Error("authentication probe must bypass the frontend protocol");
            });
            assert.equal(await probe("/"), true);
            assert.equal(await probe("/redirect"), false);
            await assert.rejects(probe("/timeout", 100), /timed out/);
            await assert.rejects(probe("/disconnect"));
            session.defaultSession.protocol.unhandle("http");
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            await assert.rejects(probe("/"));
            console.log("Authentication probes passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    }).catch((error) => {
        console.error(error);
        app.exit(1);
    });
}
