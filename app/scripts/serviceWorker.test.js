const assert = require("node:assert/strict");
const {readFileSync, existsSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../stage/service-worker.js"), "utf8");

test("precache waits for every resource and preserves successes when one request fails", async () => {
    const listeners = {};
    const cached = [];
    const warnings = [];
    let finishPending;
    const pending = new Promise(resolve => {
        finishPending = resolve;
    });
    vm.runInNewContext(source, {
        URL,
        location: {href: "https://example.com/service-worker.js?v=test"},
        self: {
            skipWaiting() {},
            addEventListener(type, listener) {
                listeners[type] = listener;
            }
        },
        caches: {
            async open() {
                return {
                    async add(resource) {
                        if (resource === "/favicon.ico") {
                            throw new Error("HTTP 404");
                        }
                        await pending;
                        cached.push(resource);
                    }
                };
            }
        },
        console: {warn: (...args) => warnings.push(args)}
    });
    let installation;
    listeners.install({waitUntil: promise => { installation = promise; }});
    let completed = false;
    installation.then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    finishPending();
    await installation;
    assert.equal(cached.length, 6);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][1], "/favicon.ico");
    const font = cached.find(resource => resource.endsWith(".woff2"));
    assert.ok(font);
    assert.ok(existsSync(path.join(__dirname, "..", font)));
});
