import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {GlobalPluginStateCoordinator, type IGlobalPluginStatePayload} from "./globalStateCoordinator";

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return {promise, resolve};
};

const payload = (revision: number, petalDisabled: boolean): IGlobalPluginStatePayload => ({
    globalPetalEnabled: !petalDisabled,
    globalPetalDisabled: petalDisabled,
    globalPetalRevision: revision,
    globalPetalChanged: true,
});

describe("global plugin state coordinator", () => {
    it("applies each revision once and ignores older state", async () => {
        const revisions: number[] = [];
        const coordinator = new GlobalPluginStateCoordinator({
            initialPetalDisabled: false,
            applyLifecycle: async (state: IGlobalPluginStatePayload) => {
                revisions.push(state.globalPetalRevision);
            },
        });

        await coordinator.apply(payload(2, true));
        await coordinator.apply(payload(2, true));
        await coordinator.apply(payload(1, false));

        assert.deepEqual(revisions, [2]);
    });

    it("keeps the latest revision pending until its lifecycle settles", async () => {
        const first = deferred();
        const second = deferred();
        const snapshots: Array<{pending: boolean, revision: number}> = [];
        const coordinator = new GlobalPluginStateCoordinator({
            initialPetalDisabled: false,
            applyLifecycle: (state: IGlobalPluginStatePayload) =>
                state.globalPetalRevision === 1 ? first.promise : second.promise,
        });
        coordinator.subscribe((state) => snapshots.push({pending: state.pending, revision: state.revision}));

        const firstApply = coordinator.apply(payload(1, true));
        const secondApply = coordinator.apply(payload(2, false));
        first.resolve();
        await firstApply;
        assert.deepEqual(snapshots.at(-1), {pending: true, revision: 2});

        second.resolve();
        await secondApply;
        assert.deepEqual(snapshots.at(-1), {pending: false, revision: 2});
    });

    it("updates configuration state without starting a lifecycle transition", () => {
        let lifecycleCalls = 0;
        let latestDisabled = false;
        const coordinator = new GlobalPluginStateCoordinator({
            initialPetalDisabled: false,
            applyLifecycle: async () => {
                lifecycleCalls++;
            },
        });
        coordinator.subscribe((state) => {
            latestDisabled = state.petalDisabled;
        });

        coordinator.syncConfig(true);

        assert.equal(latestDisabled, true);
        assert.equal(lifecycleCalls, 0);
    });

    it("applies a changed broadcast that follows a same-revision no-change response", async () => {
        const revisions: number[] = [];
        const coordinator = new GlobalPluginStateCoordinator({
            initialPetalDisabled: false,
            applyLifecycle: async (state: IGlobalPluginStatePayload) => {
                revisions.push(state.globalPetalRevision);
            },
        });
        const unchanged = {...payload(3, true), globalPetalChanged: false};

        await coordinator.apply(unchanged);
        await coordinator.apply(payload(3, true));

        assert.deepEqual(revisions, [3]);
    });
});
