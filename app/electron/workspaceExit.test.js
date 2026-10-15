const assert = require("node:assert/strict");
const {test} = require("node:test");
const {waitForPreviousWorkspaceExit, requestWorkspaceExitRecovery} = require("./workspaceExit");

const fixture = (overrides = {}) => {
    let time = 1000;
    let waiting = 0;
    let polls = 0;
    const options = {
        canceled: () => false,
        onWaiting: () => { waiting++; },
        readFile: () => JSON.stringify({version: 1, pid: 123, startedAt: 1000}),
        alive: () => polls < 4,
        now: () => time,
        sleep: async ms => { polls++; time += ms; },
        ...overrides,
    };
    return {run: () => waitForPreviousWorkspaceExit("workspace", options), options,
        waiting: () => waiting, polls: () => polls};
};

test("waits for the exiting process before allowing a new kernel", async () => {
    const state = fixture();
    assert.equal(await state.run(), true);
    assert.equal(state.waiting(), 1);
    assert.equal(state.polls(), 4);
});

test("ordinary occupied workspaces and stale or invalid markers retain the normal lock check", async () => {
    for (const marker of [null, {}, {version: 3, pid: 123, startedAt: 1000},
        {version: 1, pid: -1, startedAt: 1000}, {version: 1, pid: "123", startedAt: 1000},
        {version: 1, pid: 123, startedAt: 1001}, {version: 1, pid: 123, startedAt: -600000}]) {
        const state = fixture({readFile: () => JSON.stringify(marker)});
        assert.equal(await state.run(), true);
        assert.equal(state.waiting(), 0);
    }
    for (const readFile of [() => "{", () => { throw Object.assign(new Error("missing"), {code: "ENOENT"}); }]) {
        const state = fixture({readFile});
        assert.equal(await state.run(), true);
        assert.equal(state.waiting(), 0);
    }
});

test("a crashed kernel does not cause a wait", async () => {
    const state = fixture({alive: () => false});
    assert.equal(await state.run(), true);
    assert.equal(state.waiting(), 0);
});

test("closing or replacing the waiting window cancels startup", async () => {
    let canceled = false;
    const state = fixture({canceled: () => canceled, sleep: async () => { canceled = true; }});
    assert.equal(await state.run(), false);
    assert.equal(state.waiting(), 1);
});

test("waiting has a deadline and does not kill the old process or remove its lock", async () => {
    let time = 1000;
    const state = fixture({alive: () => true, now: () => time, sleep: async () => { time += 600000; }});
    await assert.rejects(state.run(), /timed out/);
    assert.equal(state.waiting(), 1);
});

test("filesystem and process inspection failures do not silently authorize startup", async () => {
    for (const override of [{readFile: () => { throw new Error("permission"); }},
        {alive: () => { throw new Error("permission"); }}]) {
        await assert.rejects(fixture(override).run(), /permission/);
    }
});

const recoveryFixture = (overrides = {}) => {
    let time = 1000;
    let living = true;
    let phase = "exiting";
    let calls = 0;
    let aborted = false;
    const options = {
        canceled: () => false,
        onWaiting: () => {},
        readFile: () => JSON.stringify({version: 2, pid: 123, startedAt: 1000, phase, port: "6806"}),
        alive: () => living,
        now: () => time,
        sleep: async ms => { time += ms; phase = "waiting"; },
        recover: async (_marker, signal) => {
            calls++;
            signal.addEventListener("abort", () => { aborted = true; });
            living = false;
            return 0;
        },
        ...overrides,
    };
    return {run: () => waitForPreviousWorkspaceExit("workspace", options), options,
        calls: () => calls, aborted: () => aborted, stop: () => { living = false; }, time: () => time};
};

test("an abandoned confirmation progresses only after a guarded exit request", async () => {
    const state = recoveryFixture();
    assert.equal(await state.run(), true);
    assert.equal(state.calls(), 1);
    assert.equal(state.aborted(), true);
});

test("a living original window retains its update choice", async () => {
    const state = recoveryFixture({hasActiveWindow: () => true});
    const sleep = state.options.sleep;
    state.options.sleep = async ms => {
        await sleep(ms);
        if (state.time() > 10000) state.stop();
    };
    assert.equal(await state.run(), true);
    assert.equal(state.calls(), 0);
});

test("kernel session guard defers takeover until the old UI disconnects", async () => {
    const state = recoveryFixture();
    let calls = 0;
    state.options.recover = async () => {
        if (++calls < 2) return 3;
        state.stop();
        return 0;
    };
    assert.equal(await state.run(), true);
    assert.equal(calls, 2);
});

test("recovery sync failures and transport failures require an explicit retry or cancel", async () => {
    for (const retry of [true, false]) {
        for (const network of [true, false]) {
            const state = recoveryFixture();
            let calls = 0;
            state.options.recover = async () => {
                if (++calls === 1) {
                    if (network) throw new Error("offline");
                    return 1;
                }
                state.stop();
                return 0;
            };
            state.options.onRecoveryFailed = async syncFailed => {
                assert.equal(syncFailed, !network);
                return retry;
            };
            assert.equal(await state.run(), retry);
            assert.equal(calls, retry ? 2 : 1);
        }
    }
});

test("a stalled recovery is aborted when startup is closed or times out", async () => {
    for (const cancel of [false, true]) {
        let signal;
        const state = recoveryFixture({recover: async (_marker, value) => {
            signal = value;
            return new Promise(() => {});
        }});
        state.options.canceled = () => cancel && !!signal;
        if (cancel) assert.equal(await state.run(), false);
        else await assert.rejects(state.run(), /timed out/);
        assert.equal(signal.aborted, true);
    }
});

test("forced recovery requires a sync failure and an explicit choice for the same batch", async () => {
    for (const changed of [false, true]) {
        const state = recoveryFixture();
        const calls = [];
        let batch = 1000;
        state.options.readFile = () => JSON.stringify({version: 2, pid: 123, startedAt: batch, phase: "waiting", port: "6806"});
        state.options.recover = async (_marker, _signal, force) => {
            calls.push(force);
            if (calls.length === 1) return 1;
            state.stop();
            return 0;
        };
        state.options.onRecoveryFailed = async syncFailed => {
            assert.equal(syncFailed, true);
            if (changed) batch++;
            return "force";
        };
        assert.equal(await state.run(), true);
        assert.deepEqual(calls, [false, !changed]);
    }
});

test("transport failures cannot authorize skipping exit sync", async () => {
    const state = recoveryFixture();
    let calls = 0;
    state.options.recover = async (_marker, _signal, force) => {
        assert.equal(force, false);
        if (++calls === 1) throw new Error("offline");
        state.stop();
        return 0;
    };
    state.options.onRecoveryFailed = async () => "force";
    assert.equal(await state.run(), true);
    assert.equal(calls, 2);
});

test("retry after a failed forced request restores normal sync recovery", async () => {
    const state = recoveryFixture();
    const calls = [];
    state.options.recover = async (_marker, _signal, force) => {
        calls.push(force);
        if (calls.length === 1) return 1;
        if (calls.length === 2) throw new Error("offline");
        state.stop();
        return 0;
    };
    state.options.onRecoveryFailed = async syncFailed => syncFailed ? "force" : true;
    assert.equal(await state.run(), true);
    assert.deepEqual(calls, [false, true, false]);
});

test("forced recovery sends its choice inside the guarded exit request", async () => {
    const marker = {version: 2, pid: 123, startedAt: 1000, port: "6806"};
    const result = await requestWorkspaceExitRecovery("workspace", marker, new AbortController().signal,
        async (_url, options) => {
            assert.deepEqual(JSON.parse(options.body), {recoverExit: {pid: 123, startedAt: 1000, force: true}});
            return {ok: true, json: async () => ({code: 0})};
        }, () => "{}", true);
    assert.equal(result, 0);
});

test("recovery does not repeat a successful exit while the process finishes", async () => {
    const state = recoveryFixture();
    let calls = 0;
    state.options.recover = async () => { calls++; return 0; };
    const sleep = state.options.sleep;
    state.options.sleep = async ms => {
        await sleep(ms);
        if (state.time() > 10000) state.stop();
    };
    assert.equal(await state.run(), true);
    assert.equal(calls, 1);
});

test("recovery rejects a replaced marker and permits an old but live v2 waiting batch", async () => {
    const state = recoveryFixture();
    state.options.readFile = () => JSON.stringify({version: 2, pid: state.time() > 1000 ? 124 : 123,
        startedAt: 1, phase: "waiting", port: "6806"});
    await assert.rejects(state.run(), /owner changed/);
    const old = recoveryFixture({now: () => 700000});
    let calls = 0;
    old.options.now = () => 700000 + calls++ * 1000;
    assert.equal(await old.run(), true);
    assert.equal(old.calls(), 1);
});

test("recovery HTTP uses only the marked loopback port, authenticated identity and graceful options", async () => {
    for (const config of [{api: {token: "test-token"}}, {accessAuthCode: "test-password"}, {}]) {
        const controller = new AbortController();
        let calls = 0;
        const fetch = async (url, options) => {
            calls++;
            assert.equal(url, "https://127.0.0.1:6806/api/system/exit");
            assert.deepEqual(JSON.parse(options.body), {recoverExit: {pid: 123, startedAt: 1000}});
            assert.equal(options.redirect, "error");
            assert.equal(options.signal, controller.signal);
            assert.equal(options.headers.Authorization, config.api ? "Token test-token" : config.accessAuthCode ?
                "Basic " + Buffer.from("workspace:test-password").toString("base64") : undefined);
            return {ok: true, json: async () => ({code: 0})};
        };
        assert.equal(await requestWorkspaceExitRecovery("workspace", {version: 2, pid: 123, startedAt: 1000, port: "6806"},
            controller.signal, fetch, () => JSON.stringify(config)), 0);
        assert.equal(calls, 1);
        await assert.rejects(requestWorkspaceExitRecovery("workspace", {version: 2, port: "6806/other"},
            controller.signal, fetch), /Invalid/);
        assert.equal(calls, 1);
    }
});

test("a real orphan process exits only after the recovery HTTP request", {timeout: 15000}, async t => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const {spawn} = require("node:child_process");
    const {once} = require("node:events");
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-exit-recovery-test-"));
    const startedAt = Date.now();
    const child = spawn(process.execPath, ["-e", `
        const http = require("node:http");
        const server = http.createServer((request, response) => {
            let body = "";
            request.on("data", chunk => body += chunk);
            request.on("end", () => {
                const data = JSON.parse(body);
                if (request.url !== "/api/system/exit" || request.headers.authorization !== "Token fixture-token" ||
                    data.recoverExit.pid !== process.pid || data.recoverExit.startedAt !== ${startedAt} || data.force) {
                    response.writeHead(400).end();
                    return;
                }
                response.setHeader("Connection", "close");
                response.end(JSON.stringify({code: 0}));
                server.close(() => process.disconnect());
            });
        });
        server.listen(0, "127.0.0.1", () => process.send(server.address().port));
    `], {windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"]});
    const closed = once(child, "close");
    try {
        const [port] = await once(child, "message", {signal: t.signal});
        fs.mkdirSync(path.join(workspace, "temp"));
        fs.mkdirSync(path.join(workspace, "conf"));
        fs.writeFileSync(path.join(workspace, "conf", "conf.json"), JSON.stringify({api: {token: "fixture-token"}}));
        fs.writeFileSync(path.join(workspace, "temp", "kernel-exit.json"), JSON.stringify({
            version: 2, pid: child.pid, startedAt, port: String(port), phase: "waiting",
        }));
        let requests = 0;
        const ready = await waitForPreviousWorkspaceExit(workspace, {
            canceled: () => t.signal.aborted, onWaiting: () => {},
            recover: (marker, signal) => {
                requests++;
                return requestWorkspaceExitRecovery(workspace, marker, signal,
                    (url, options) => fetch(url.replace("https:", "http:"), options));
            },
        });
        assert.equal(ready, true);
        assert.equal(requests, 1);
        assert.equal((await closed)[0], 0);
    } finally {
        if (child.exitCode === null) child.kill();
        await closed;
        const relative = path.relative(os.tmpdir(), workspace);
        assert.ok(relative.startsWith("siyuan-exit-recovery-test-") && !path.isAbsolute(relative) && !relative.includes(".."));
        fs.rmSync(workspace, {recursive: true, force: true});
    }
});
