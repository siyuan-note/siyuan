const assert = require("node:assert/strict");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const settleDockAnimations = require("./helpers/settleDockAnimations");

const run = (state, stalled = false) => {
    let frame = 0;
    let now = 0;
    let expire;
    let cleared = false;
    let cancelled = false;
    const settle = runInNewContext(`(${settleDockAnimations.toString()})`, {
        setTimeout: (resolve, delay) => {
            if (delay === 350) {
                resolve();
            } else {
                expire = resolve;
            }
            return 1;
        },
        clearTimeout: () => { cleared = true; },
        cancelAnimationFrame: () => { cancelled = true; },
        requestAnimationFrame: resolve => {
            frame++;
            now += 16;
            if (now >= 5000) {
                expire();
            }
            if (!stalled) {
                resolve();
            }
            return frame;
        },
        document: {
            getAnimations: () => state(frame).animations || [],
            querySelector: () => state(frame).closing ? {} : null,
            querySelectorAll: () => [{id: "dockRight", className: "dock dock--closing"}],
        },
        getComputedStyle: () => ({opacity: "0", transform: "none"}),
    });
    return {settle, frame: () => frame, expire: () => expire(), cleaned: () => cleared && cancelled};
};

test("dock settling waits for animations created on the next rendering frame", async () => {
    const fixture = run(frame => ({animations: frame < 4 ? [{playState: "running"}] : []}));
    await fixture.settle();
    assert.equal(fixture.frame(), 5);
});

test("dock settling waits for finished-animation cleanup", async () => {
    const fixture = run(frame => ({animations: [{playState: "finished"}], closing: frame < 4}));
    await fixture.settle();
    assert.equal(fixture.frame(), 5);
});

test("dock settling restarts its idle check when another frame creates an animation", async () => {
    const fixture = run(frame => ({animations: frame === 2 ? [{pending: true}] : []}));
    await fixture.settle();
    assert.equal(fixture.frame(), 4);
});

test("dock settling reports stuck closing state instead of hiding a failure", async () => {
    const fixture = run(() => ({closing: true}));
    await assert.rejects(fixture.settle(), /five seconds.*dockRight.*dock--closing/);
    assert.ok(fixture.cleaned());
});

test("dock settling times out and cancels its frame when rendering is suspended", async () => {
    const fixture = run(() => ({}), true);
    const result = fixture.settle();
    await Promise.resolve();
    fixture.expire();
    await assert.rejects(result, /five seconds.*dockRight/);
    assert.ok(fixture.cleaned());
});
