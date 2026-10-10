const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const setup = (isMainFrame = true) => {
    const listeners = {}, exposed = {}, posted = [], map = {style: {}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "mapHostPreload.js"), "utf8"), {
        require: name => {
            assert.equal(name, "electron");
            return {contextBridge: {exposeInMainWorld: (name, value) => { exposed[name] = value; }}, ipcRenderer: {
                once: (name, listener) => { listeners[name] = (...args) => { delete listeners[name]; listener(...args); }; },
                on: (name, listener) => { listeners[name] = listener; },
            }};
        },
        process: {isMainFrame}, window: {postMessage: (...args) => posted.push(args)}, document: {getElementById: () => map},
    });
    return {listeners, exposed, posted, map};
};

test("sandbox preload exposes only a frozen version capability and one transferred map port", () => {
    const s = setup();
    assert.deepEqual(Object.keys(s.exposed), ["siyuanMapDesktop"]);
    assert.deepEqual(Object.keys(s.exposed.siyuanMapDesktop), ["version"]);
    assert.equal(Object.isFrozen(s.exposed.siyuanMapDesktop), true);
    const data = {version: 1, instanceID: "a".repeat(48), nonce: "b".repeat(48), provider: "openfreemap", secret: "never"};
    const port = {};
    s.listeners["siyuan-map-port"]({ports: [port]}, data);
    assert.equal(s.listeners["siyuan-map-port"], undefined);
    assert.equal(s.posted[0][0].type, "siyuan-map-desktop-connect");
    assert.equal(s.posted[0][0].secret, undefined);
    assert.equal(s.posted[0][2][0], port);
});

test("invalid port metadata closes the port and subframes receive no capability", () => {
    const s = setup(); let closed = false;
    s.listeners["siyuan-map-port"]({ports: [{close() { closed = true; }}]}, {version: 2});
    assert.equal(closed, true); assert.equal(s.posted.length, 0);
    const subframe = setup(false);
    assert.deepEqual(subframe.exposed, {}); assert.deepEqual(subframe.listeners, {});
});

test("the transferred map port only admits the fixed OpenFreeMap provider", () => {
    for (const provider of ["amap", "tencent", "baidu", "__proto__", undefined]) {
        const s = setup(); let closed = false;
        s.listeners["siyuan-map-port"]({ports: [{close() { closed = true; }}]}, {
            version: 1, instanceID: "a".repeat(48), nonce: "b".repeat(48), provider,
        });
        assert.equal(closed, true);
        assert.equal(s.posted.length, 0);
    }
});

test("viewport accepts only bounded numeric dimensions and crop, without exposing IPC", () => {
    const s = setup();
    s.listeners["siyuan-map-viewport"]({}, {logicalSize: {width: 500, height: 400}, crop: {x: 20, y: 40}});
    assert.equal(s.map.style.width, "500px"); assert.equal(s.map.style.height, "400px");
    assert.equal(s.map.style.transform, "translate(-20px,-40px)");
    s.listeners["siyuan-map-viewport"]({}, {logicalSize: {width: "url(secret)", height: 400}, crop: {x: 0, y: 0}});
    assert.equal(s.map.style.width, "500px");
});
