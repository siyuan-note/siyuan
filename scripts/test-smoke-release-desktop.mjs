import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import {test} from "node:test";
import {waitForStartup} from "./smoke-release-desktop.mjs";

async function setup(t) {
    const server = createServer((request, response) => {
        assert.equal(request.url, "/json/list");
        response.end(JSON.stringify([
            {type: "page", url: "file:///boot.html", webSocketDebuggerUrl: `ws://${request.headers.host}/devtools/page/boot`},
            {type: "page", url: "https://127.0.0.1:6806/stage/build/app/", webSocketDebuggerUrl: "ws://192.0.2.1:80/devtools/page/other"},
            {type: "page", url: "https://127.0.0.1:6806/stage/build/app/", webSocketDebuggerUrl: `ws://${request.headers.host}/devtools/page/main`},
        ]));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => server.close());
    return {port: server.address().port, failure: () => undefined, interval: 0, timeout: 1000};
}

test("a release is ready only when its local app main page is visible", async t => {
    const options = await setup(t);
    const observations = [
        {state: "ready", visible: false},
        {state: "loading", visible: true},
        {state: "ready", visible: true},
    ];
    await waitForStartup({...options, inspect: async url => {
        assert.equal(url, `ws://127.0.0.1:${options.port}/devtools/page/main`);
        return observations.shift();
    }});
    assert.equal(observations.length, 0);
});

test("startup diagnostics reject a package and preserve the failure detail", async t => {
    const options = await setup(t);
    await assert.rejects(waitForStartup({...options,
        inspect: async () => ({state: "failed", detail: "Could not load Lute"}),
    }), /Could not load Lute/);
});

test("a still running but unready process cannot pass the startup check", async t => {
    const options = await setup(t);
    await assert.rejects(waitForStartup({...options, timeout: 30, inspect: async () => ({state: "loading"})}), /did not reach/);
});

test("a failed process stops startup verification immediately", async () => {
    await assert.rejects(waitForStartup({failure: () => new Error("Application exited")}), /Application exited/);
});
