const assert = require("node:assert/strict");
const {test} = require("node:test");
const {installKernelRequestLog} = require("./kernelRequestLog");

const setup = () => {
    const listeners = {};
    const logs = [];
    const targets = new Map([
        [1, {mode: "local", origin: "https://127.0.0.1:6806"}],
        [2, {mode: "local", origin: "http://127.0.0.1:6807"}],
        [3, {mode: "remote", origin: "https://remote.example"}],
    ]);
    const session = {webRequest: {
        onErrorOccurred: callback => { assert.equal(listeners.error, undefined); listeners.error = callback; },
        onCompleted: callback => { assert.equal(listeners.completed, undefined); listeners.completed = callback; },
    }};
    let time = 0;
    const options = {getTarget: id => targets.get(id), writeLog: message => logs.push(message), now: () => time};
    installKernelRequestLog(session, options);
    const request = {webContentsId: 1, url: "https://127.0.0.1:6806/api/transactions?token=secret",
        method: "POST", resourceType: "xhr", error: "net::ERR_CERT_DATABASE_CHANGED"};
    return {listeners, logs, targets, session, options, request, advance: ms => { time += ms; }};
};

test("logs native local API failures without request contents or credentials", () => {
    const {listeners, logs, request} = setup();
    listeners.error({...request, uploadData: [{bytes: "private document"}],
        requestHeaders: {Authorization: "secret"}, referrer: "private"});
    const data = JSON.parse(logs[0].slice("local kernel request failed ".length));
    assert.deepEqual(data, {webContentsId: 1, port: "6806", method: "POST", path: "/api/transactions",
        resourceType: "xhr", error: "net::ERR_CERT_DATABASE_CHANGED"});
});

test("only observes requests to the sending window's local kernel", () => {
    const {listeners, logs, request, targets} = setup();
    for (const override of [{webContentsId: 99}, {webContentsId: 3, url: "https://remote.example/api/transactions"},
        {url: "https://127.0.0.1:6807/api/transactions"}, {url: "https://external.example/image"},
        {url: "invalid"}, {error: "net::ERR_ABORTED"}]) {
        listeners.error({...request, ...override});
    }
    assert.equal(logs.length, 0);
    listeners.error({...request, webContentsId: 2, url: "http://127.0.0.1:6807/api/filetree/getDoc"});
    assert.equal(logs.length, 1);
    targets.delete(2);
    listeners.error({...request, webContentsId: 2, url: "http://127.0.0.1:6807/api/filetree/getDoc"});
    assert.equal(logs.length, 1);
});

test("records failed WebSocket handshakes for HTTPS and HTTP kernels", () => {
    const {listeners, logs, request} = setup();
    listeners.error({...request, url: "wss://127.0.0.1:6806/ws?app=secret&id=private", resourceType: "webSocket"});
    listeners.error({...request, webContentsId: 2, url: "ws://127.0.0.1:6807/ws?app=secret", resourceType: "webSocket"});
    assert.equal(logs.length, 2);
    for (const log of logs) {
        assert.ok(log.includes('"path":"/ws"'));
        assert.ok(!log.includes("secret"));
    }
});

test("redacts resource names and keeps only static API routes", () => {
    const {listeners, logs, request} = setup();
    for (const path of ["/assets/private-document.png", "/stage/private.js", "/appearance/private.css",
        "/plugins/private-plugin/index.js", "/api/file/123456-private", "/private-document"]) {
        listeners.error({...request, url: "https://127.0.0.1:6806" + path});
    }
    assert.equal(logs.length, 6);
    assert.ok(logs.every(log => log.includes("[resource]") && !log.includes("private")));
});

test("records HTTP errors but leaves successful responses unlogged", () => {
    const {listeners, logs, request} = setup();
    for (const statusCode of [200, 202, 204, 304, 401, 403, 404, 500]) {
        listeners.completed({...request, error: undefined, statusCode});
    }
    assert.equal(logs.length, 4);
    assert.ok(logs[3].includes('"statusCode":500'));
});

test("bounds failure bursts and resumes logging in the next interval", () => {
    const {listeners, logs, request, advance} = setup();
    for (let i = 0; i < 100; i++) listeners.error(request);
    assert.equal(logs.length, 31);
    assert.ok(logs[30].includes("suppressed"));
    advance(30000);
    listeners.error(request);
    assert.equal(logs.length, 32);
    assert.ok(logs[31].includes("ERR_CERT_DATABASE_CHANGED"));
});

test("installs session listeners once without replacing them for another window", () => {
    const {session, options} = setup();
    installKernelRequestLog(session, options);
});
