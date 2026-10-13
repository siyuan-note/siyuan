const assert = require("node:assert/strict");
const {test} = require("node:test");
const {waitForPreviousWorkspaceExit} = require("./workspaceExit");

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
    for (const marker of [null, {}, {version: 2, pid: 123, startedAt: 1000},
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
