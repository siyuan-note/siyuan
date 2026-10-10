const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const handler = source.slice(source.indexOf('    powerMonitor.on("resume",'),
    source.indexOf('    powerMonitor.on("shutdown",'));

test("resume sync carries each workspace session and reports rejected requests", async () => {
    const requests = [];
    const logs = [];
    let resume;
    const local = {ownsKernel: true, kernelTarget: {origin: "http://127.0.0.1:6806"}};
    const remote = {ownsKernel: false, kernelTarget: {origin: "https://remote.example"}};
    const createSession = name => ({fetch: async (url, options) => {
        requests.push({name, url, options});
        return {ok: name === "remote", status: name === "remote" ? 200 : 401};
    }});
    const context = {
        powerMonitor: {on: (_event, callback) => { resume = callback; }},
        notebookSystemLock: {retry: async () => {}},
        net: {isOnline: () => true},
        session: {defaultSession: createSession("local")},
        getRemoteSession: target => {
            assert.equal(target, remote.kernelTarget);
            return createSession("remote");
        },
        writeLog: message => logs.push(message),
        workspaces: [local, remote],
    };
    vm.runInNewContext(handler, context);
    await resume();
    assert.equal(requests.length, 2);
    for (const request of requests) {
        assert.equal(request.options.credentials, "include");
        assert.equal(request.options.method, "POST");
        assert.equal(request.url.endsWith("/api/sync/performSync"), true);
        assert.equal(request.options.bypassCustomProtocolHandlers, request.name === "remote");
        assert.equal(request.options.redirect, request.name === "remote" ? "manual" : "follow");
    }
    assert.ok(logs.includes("sync after system resume rejected [HTTP 401]"));
    context.session.defaultSession.fetch = async () => { throw new Error("secret authentication data"); };
    await resume();
    assert.ok(logs.includes("sync after system resume request failed"));
    assert.ok(logs.every(message => !message.includes("secret")));
});
