import {afterEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import type {App} from "../index";
import {destroyEventBus, EventBus} from "../plugin/EventBusCore";
import {
    emitOpenAsset,
    emitOpenLink,
    type IOpenLinkEventDetail,
    resolveOpenLinkEvent,
} from "./openLinkEvent";

const eventBuses: EventBus[] = [];

const createPlugin = (emit: (type: TEventBus, detail: unknown) => boolean,
                       types: TEventBus[] = ["open-link", "open-asset"]) => {
    const eventBus = new EventBus(new EventTarget());
    eventBuses.push(eventBus);
    types.forEach(type => {
        eventBus.on(type, event => {
            if (!emit(type, event.detail)) {
                event.preventDefault();
            }
        });
    });
    return {eventBus};
};

const createApp = (emitters: Array<(type: TEventBus, detail: unknown) => boolean>) => ({
    plugins: emitters.map(emit => createPlugin(emit)),
}) as unknown as App;

describe("link opening plugin events", () => {
    afterEach(() => {
        eventBuses.splice(0).forEach(destroyEventBus);
    });

    it("normalizes external links before emitting", () => {
        assert.deepEqual(resolveOpenLinkEvent({
            href: "example.com",
            originalHref: "example.com",
            isAsset: false,
            isLocal: false,
        }), {
            href: "https://example.com",
            originalHref: "example.com",
            event: undefined,
        });
    });

    it("leaves assets to the dedicated asset event", () => {
        assert.equal(resolveOpenLinkEvent({
            href: "assets/example.pdf",
            originalHref: "assets/example.pdf",
            isAsset: true,
            isLocal: true,
        }), undefined);
    });

    it("stops notifying plugins after a link opening is canceled", () => {
        const calls: number[] = [];
        const detail: IOpenLinkEventDetail = {
            href: "https://example.com",
            originalHref: "example.com",
        };
        const app = createApp([
            (type, receivedDetail) => {
                calls.push(1);
                assert.equal(type, "open-link");
                assert.equal(receivedDetail, detail);
                return true;
            },
            () => {
                calls.push(2);
                return false;
            },
            () => {
                calls.push(3);
                return true;
            },
        ]);

        assert.equal(emitOpenLink(app, detail), false);
        assert.deepEqual(calls, [1, 2]);
    });

    it("notifies every plugin when link opening is allowed", () => {
        const calls: number[] = [];
        const app = createApp([
            () => {
                calls.push(1);
                return true;
            },
            () => {
                calls.push(2);
                return true;
            },
        ]);

        assert.equal(emitOpenLink(app, {href: "siyuan://blocks/id", originalHref: "siyuan://blocks/id"}), true);
        assert.deepEqual(calls, [1, 2]);
    });

    it("skips plugins without a matching subscription", () => {
        const calls: number[] = [];
        const app = {
            plugins: [
                createPlugin(() => {
                    calls.push(1);
                    return false;
                }, ["open-asset"]),
                createPlugin(() => {
                    calls.push(2);
                    return true;
                }, ["open-link"]),
            ],
        } as unknown as App;

        assert.equal(emitOpenLink(app, {href: "https://example.com", originalHref: "example.com"}), true);
        assert.deepEqual(calls, [2]);
    });

    it("uses the same first-canceler-wins behavior for assets", () => {
        const calls: number[] = [];
        const app = createApp([
            () => {
                calls.push(1);
                return false;
            },
            () => {
                calls.push(2);
                return true;
            },
        ]);

        assert.equal(emitOpenAsset(app, "assets/example.pdf", "right"), false);
        assert.deepEqual(calls, [1]);
    });
});
