import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {PDFNavigationHistory, PDFNavigationStack} from "./navigationHistory";

class TestEventBus {
    private listeners = new Map<string, Array<(event: any) => void>>();
    public lastHistoryState: {canGoBack: boolean, canGoForward: boolean};

    public _on(eventName: string, listener: (event: any) => void, options?: {signal?: AbortSignal}) {
        const listeners = this.listeners.get(eventName) || [];
        listeners.push(listener);
        this.listeners.set(eventName, listeners);
        options?.signal?.addEventListener("abort", () => {
            this.listeners.set(eventName, (this.listeners.get(eventName) || []).filter((item) => item !== listener));
        }, {once: true});
    }

    public dispatch(eventName: string, data: unknown) {
        if (eventName === "pdfhistorystatechanged") {
            this.lastHistoryState = data as {canGoBack: boolean, canGoForward: boolean};
        }
        (this.listeners.get(eventName) || []).forEach((listener) => listener(data));
    }

    public update(page: number, top = 0, rotation = 0) {
        this.updateHash(`page=${page}&zoom=100,0,${top}`, rotation);
    }

    public updateHash(hash: string, rotation = 0) {
        const page = Number.parseInt(new URLSearchParams(hash).get("page"), 10);
        this.dispatch("updateviewarea", {
            location: {
                pageNumber: page,
                pdfOpenParams: `#${hash}`,
                rotation,
            },
        });
    }
}

class TestLinkService {
    public page = 1;
    public pagesCount = 20;
    public autoUpdate = true;
    public lastHash = "";
    public lastDestination: string | unknown[];
    public operations: string[] = [];
    private readonly eventBus: TestEventBus;
    private currentRotation = 0;

    constructor(eventBus: TestEventBus) {
        this.eventBus = eventBus;
    }

    public get rotation() {
        return this.currentRotation;
    }

    public set rotation(rotation: number) {
        this.currentRotation = rotation;
        this.operations.push(`rotation:${rotation}`);
    }

    public async goToDestination(destination: string | unknown[]) {
        this.lastDestination = destination;
        this.operations.push("destination");
        if (this.autoUpdate) {
            this.eventBus.update(this.page, 0, this.rotation);
        }
    }

    public setHash(hash: string) {
        this.lastHash = hash;
        this.operations.push(`hash:${hash}`);
        const page = Number.parseInt(new URLSearchParams(hash).get("page"), 10);
        if (Number.isInteger(page)) {
            this.page = page;
        }
        if (this.autoUpdate) {
            this.eventBus.updateHash(hash, this.rotation);
        }
    }
}

const createHistory = (options: {autoUpdate?: boolean, navigationTimeoutMs?: number} = {}) => {
    const eventBus = new TestEventBus();
    const linkService = new TestLinkService(eventBus);
    linkService.autoUpdate = options.autoUpdate ?? true;
    const history = new PDFNavigationHistory({
        eventBus,
        linkService,
        limit: 64,
        navigationTimeoutMs: options.navigationTimeoutMs,
    });
    history.initialize();
    return {eventBus, history, linkService};
};

describe("PDFNavigationStack", () => {
    it("navigates backward and forward", () => {
        const stack = new PDFNavigationStack(64);
        stack.seed({hash: "page=1"});
        stack.push({hash: "page=8"});

        assert.equal(stack.canGoBack, true);
        assert.equal(stack.canGoForward, false);
        assert.equal(stack.back()?.hash, "page=1");
        assert.equal(stack.canGoForward, true);
        assert.equal(stack.forward()?.hash, "page=8");
    });

    it("drops forward entries after a new jump", () => {
        const stack = new PDFNavigationStack(64);
        stack.seed({hash: "page=1"});
        stack.push({hash: "page=2"});
        stack.push({hash: "page=3"});
        stack.back();
        stack.push({hash: "page=4"});

        assert.equal(stack.current?.hash, "page=4");
        assert.equal(stack.canGoForward, false);
        assert.equal(stack.length, 3);
    });

    it("replaces duplicate positions", () => {
        const stack = new PDFNavigationStack(64);
        stack.seed({hash: "page=1", rotation: 0});

        assert.equal(stack.push({hash: "page=1", rotation: 0}), false);
        assert.equal(stack.length, 1);
    });

    it("limits the number of retained entries", () => {
        const stack = new PDFNavigationStack(3);
        stack.seed({hash: "page=1"});
        stack.push({hash: "page=2"});
        stack.push({hash: "page=3"});
        stack.push({hash: "page=4"});

        assert.equal(stack.length, 3);
        assert.equal(stack.back()?.hash, "page=3");
        assert.equal(stack.back()?.hash, "page=2");
        assert.equal(stack.canGoBack, false);
    });
});

describe("PDFNavigationHistory", () => {
    it("uses a stored position as the previous entry for an initial reference", async () => {
        const {eventBus, history, linkService} = createHistory();
        history.seedPreviousPosition({
            page: 2,
            rotation: 0,
            scrollLeft: 10,
            scrollTop: 200,
            zoom: 125,
        });
        linkService.page = 8;
        eventBus.update(8);

        await history.back();
        assert.equal(linkService.page, 2);
        assert.equal(linkService.lastHash, "page=2&zoom=125,10,200");

        await history.forward();
        assert.equal(linkService.page, 8);
        history.reset();
    });

    it("does not add the same page twice without moving", async () => {
        const {eventBus, history, linkService} = createHistory();
        eventBus.update(1);
        history.pushCurrentPosition();
        history.pushPage(8);
        linkService.page = 8;
        eventBus.update(8);

        history.pushCurrentPosition();
        history.pushPage(8);
        await history.back();
        assert.equal(linkService.page, 1);

        await history.back();
        assert.equal(linkService.page, 1);
        history.reset();
    });

    it("records a same-page jump only after the view position changes", async () => {
        const {eventBus, history, linkService} = createHistory();
        linkService.page = 8;
        eventBus.update(8);
        eventBus.update(8, 400);
        history.pushCurrentPosition();
        history.pushPage(8);
        eventBus.update(8);

        await history.back();
        assert.equal(linkService.lastHash, "page=8&zoom=100,0,400");
        history.reset();
    });

    it("keeps histories isolated between PDF instances", async () => {
        const first = createHistory();
        const second = createHistory();
        first.eventBus.update(1);
        second.linkService.page = 4;
        second.eventBus.update(4);
        first.history.pushCurrentPosition();
        first.history.pushPage(10);
        first.linkService.page = 10;
        first.eventBus.update(10);

        await second.history.back();
        assert.equal(second.linkService.page, 4);
        await first.history.back();
        assert.equal(first.linkService.page, 1);
        first.history.reset();
        second.history.reset();
    });

    it("ignores stale view updates while restoring an entry", async () => {
        const {eventBus, history, linkService} = createHistory({autoUpdate: false});
        eventBus.update(1);
        history.pushCurrentPosition();
        history.pushPage(8);
        linkService.page = 8;
        eventBus.update(8);

        await history.back();
        assert.equal(eventBus.lastHistoryState.canGoForward, false);
        eventBus.update(8);
        assert.equal(eventBus.lastHistoryState.canGoForward, false);

        eventBus.updateHash("page=1&zoom=100,0,0");
        assert.equal(eventBus.lastHistoryState.canGoForward, true);
        await history.forward();
        assert.equal(linkService.lastHash, "page=8&zoom=100,0,0");
        history.reset();
    });

    it("preserves an explicit destination after recording its landing position", async () => {
        const {eventBus, history, linkService} = createHistory();
        const destination = [{num: 12, gen: 0}, {name: "XYZ"}, 0, 200, null];
        eventBus.update(1);
        history.pushCurrentPosition();
        history.push({explicitDest: destination, pageNumber: 8});
        linkService.page = 8;
        eventBus.update(8);

        await history.back();
        linkService.autoUpdate = false;
        await history.forward();
        assert.deepEqual(linkService.lastDestination, destination);
        history.reset();
    });

    it("restores rotation before coordinates", async () => {
        const {eventBus, history, linkService} = createHistory();
        history.seedPreviousPosition({
            page: 2,
            rotation: 90,
            scrollLeft: 10,
            scrollTop: 200,
            zoom: 125,
        });
        linkService.page = 8;
        eventBus.update(8);
        linkService.operations = [];

        await history.back();
        assert.deepEqual(linkService.operations.slice(0, 2), [
            "rotation:90",
            "hash:page=2&zoom=125,10,200",
        ]);
        history.reset();
    });

    it("does not replace an entry when navigation times out", async () => {
        const {eventBus, history, linkService} = createHistory({
            autoUpdate: false,
            navigationTimeoutMs: 5,
        });
        eventBus.update(1);
        history.pushCurrentPosition();
        history.pushPage(8);
        linkService.page = 8;
        eventBus.update(8);

        await history.back();
        eventBus.update(8);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await history.forward();
        eventBus.updateHash("page=8&zoom=100,0,0");
        await history.back();
        assert.equal(linkService.lastHash, "page=1&zoom=100,0,0");
        history.reset();
    });
});
