import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {AVMapHostOptions} from "./host";
import * as protocol from "./protocol";
import {canLoadMapHost} from "./state";
import {DOMFixture, requireFixture} from "./testDOM";

const compiled = transpileModule(readFileSync("src/protyle/render/av/map/locationPicker.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

const setup = (options: {point?: {longitude: number; latitude: number}; desktop?: boolean; published?: boolean;
    online?: boolean; protocol?: string; supported?: boolean | Promise<boolean>; acceptPick?: boolean;
    failDuringCreate?: boolean; runtime?: () => Promise<unknown>} = {}) => {
    const document = new DOMFixture();
    const canvas = document.createElement("div");
    canvas.classList.add("fn__none");
    document.body.append(canvas);
    const status = document.createElement("div");
    const calls: string[] = [];
    const events = new Map<string, () => void>();
    const observers: Array<{callback: () => void; disconnects: number}> = [];
    const hosts: Array<{options: AVMapHostOptions; points: Array<{points: protocol.AVMapPoint[]; revision: number}>;
        destroys: number; themes: string[]}> = [];
    const selected: Array<{longitude: number; latitude: number}> = [];
    const links: unknown[][] = [];
    const navigator = {onLine: options.online !== false};
    let ownerCurrent = true;
    const createHost = (_canvas: unknown, configuration: AVMapHostOptions) => {
        assert.equal(_canvas, canvas);
        const host = {options: configuration, points: [] as typeof hosts[number]["points"], destroys: 0, themes: [] as string[]};
        hosts.push(host);
        if (options.failDuringCreate) configuration.onError("hostUnavailable");
        return {
            destroy: () => host.destroys++,
            setPoints: (points: protocol.AVMapPoint[], revision: number) =>
                host.points.push({points: JSON.parse(JSON.stringify(points)), revision}),
            resize() {},
            setTheme: (theme: string) => host.themes.push(theme),
        };
    };
    const methods = {} as typeof import("./locationPicker");
    runInNewContext(compiled, {
        exports: methods,
        require: requireFixture({
            "../../../../util/fetch": {fetchSyncPost: async (url: string, payload: unknown) => {
                assert.equal(JSON.stringify(payload), "{}");
                calls.push(url);
                return options.runtime ? options.runtime() : {code: 0, data: {provider: "openfreemap"}};
            }},
            "./host": {
                isAVMapHostEnvironmentSupported: () => { calls.push("browser-capability"); return options.supported ?? true; },
                createAVMapHost: createHost,
            },
            "./desktopTransport": {
                isDesktopAVMapHostSupported: async () => { calls.push("desktop-capability"); return !!options.desktop; },
                createDesktopAVMapHost: (...args: Parameters<typeof createHost>) => {
                    calls.push("desktop-host");
                    return createHost(...args);
                },
            },
            "./protocol": protocol,
            "./state": {canLoadMapHost},
        }),
        window: {
            siyuan: {languages: new Proxy({}, {get: (_target, key) => String(key)}), isPublish: !!options.published},
            location: {protocol: options.protocol || "https:"},
            addEventListener: (type: string, callback: () => void) => events.set(type, callback),
            removeEventListener: (type: string) => events.delete(type),
            open: (...args: unknown[]) => links.push(args),
        },
        document,
        navigator,
        MutationObserver: class {
            record: typeof observers[number];
            constructor(callback: () => void) {
                this.record = {callback, disconnects: 0};
                observers.push(this.record);
            }
            observe() {}
            disconnect() { this.record.disconnects++; }
        },
    });
    const picker = methods.createAVLocationPicker({
        canvas: canvas as unknown as HTMLElement,
        status: status as unknown as HTMLElement,
        point: options.point,
        isCurrent: () => ownerCurrent,
        onPick: point => {
            selected.push(JSON.parse(JSON.stringify(point)));
            return options.acceptPick !== false;
        },
    });
    return {picker, hosts, calls, events, observers, selected, links, navigator, canvas, status, document,
        detach: () => { ownerCurrent = false; },
        settle: () => new Promise<void>(resolve => setImmediate(resolve)),
        click: (point: {longitude: number; latitude: number}, revision?: number) => {
            const host = hosts[0];
            host.options.onPointClick(point, revision ?? host.points[host.points.length - 1].revision);
        }};
};

describe("embedded database location picker", () => {
    it("loads an empty picker without requiring an existing location, on browser and desktop hosts", async () => {
        for (const desktop of [false, true]) {
            const scenario = setup({desktop});
            await scenario.settle();
            assert.equal(scenario.hosts.length, 1);
            assert.deepEqual(scenario.hosts[0].points, [{points: [], revision: 1}]);
            assert.equal(scenario.calls.includes("desktop-host"), desktop);
            assert.equal(scenario.calls.includes("browser-capability"), !desktop);
            assert.equal(scenario.status.textContent, "mapLoading");
            assert.equal(scenario.canvas.classList.contains("fn__none"), false);
            scenario.hosts[0].options.onReady();
            assert.equal(scenario.status.textContent, "");
        }
    });

    it("sends only the coordinate draft and updates its marker with strictly increasing revisions", async () => {
        const scenario = setup({point: {longitude: 30, latitude: 20, name: "Private name",
            originalInput: "Private source"} as {longitude: number; latitude: number}});
        await scenario.settle();
        const host = scenario.hosts[0];
        assert.deepEqual(host.points[0], {points: [{id: "location-draft", longitude: 30, latitude: 20}], revision: 1});
        scenario.click({longitude: 40, latitude: 10});
        scenario.click({longitude: 0, latitude: 0});
        assert.deepEqual(scenario.selected, [{longitude: 40, latitude: 10}, {longitude: 0, latitude: 0}]);
        assert.deepEqual(host.points[2], {points: [{id: "location-draft", longitude: 0, latitude: 0}], revision: 3});
        assert.equal(scenario.hosts.length, 1);
        scenario.picker.setPoint({longitude: 50, latitude: 25});
        assert.deepEqual(host.points[3], {points: [{id: "location-draft", longitude: 50, latitude: 25}], revision: 4});
        assert.equal(JSON.stringify(host.points).includes("Private"), false);
    });

    it("ignores stale or invalid point clicks and leaves a rejected draft unchanged", async () => {
        const scenario = setup();
        await scenario.settle();
        for (const point of [{longitude: 181, latitude: 0}, {longitude: 0, latitude: 86},
            {longitude: NaN, latitude: 0}, {longitude: 0, latitude: Infinity}]) scenario.click(point);
        scenario.click({longitude: 40, latitude: 10}, 0);
        scenario.click({longitude: 40, latitude: 10}, 2);
        assert.equal(scenario.selected.length, 0);
        assert.equal(scenario.hosts[0].points.length, 1);
        const rejected = setup({acceptPick: false});
        await rejected.settle();
        rejected.click({longitude: 40, latitude: 10});
        assert.equal(rejected.hosts[0].points.length, 1);
    });

    it("removes the selected marker for invalid manual coordinates without changing the form draft", async () => {
        const scenario = setup({point: {longitude: 30, latitude: 20}});
        await scenario.settle();
        scenario.picker.setPoint({longitude: 30, latitude: 90});
        scenario.picker.setPoint();
        assert.deepEqual(scenario.hosts[0].points.slice(1), [{points: [], revision: 2}, {points: [], revision: 3}]);
        assert.equal(scenario.selected.length, 0);
    });

    it("shows a local fallback and makes no runtime request for unsupported, published or offline clients", async () => {
        for (const [options, message] of [
            [{protocol: "file:"}, "mapUnsupportedClient"], [{published: true}, "mapPublicFallback"],
            [{online: false}, "mapOffline"], [{supported: false}, "mapUnsupportedClient"],
        ] as const) {
            const scenario = setup(options);
            await scenario.settle();
            assert.equal(scenario.calls.includes("/api/map/getRuntime"), false);
            assert.equal(scenario.hosts.length, 0);
            assert.equal(scenario.status.textContent, message);
            assert.equal(scenario.events.size, 0);
            assert.equal(scenario.canvas.classList.contains("fn__none"), true);
        }
    });

    it("retains the newest manual draft while capability and runtime checks are pending", async () => {
        let resolveCapability: (value: boolean) => void;
        const scenario = setup({supported: new Promise(resolve => resolveCapability = resolve)});
        scenario.picker.setPoint({longitude: 40, latitude: 10});
        resolveCapability(true);
        await scenario.settle();
        assert.deepEqual(scenario.hosts[0].points[0].points, [{id: "location-draft", longitude: 40, latitude: 10}]);
    });

    it("does not create a late host after disposal, owner invalidation or going offline during runtime loading", async () => {
        for (const action of ["destroy", "detach", "offline"]) {
            let complete: (value: unknown) => void;
            const scenario = setup({runtime: () => new Promise(resolve => complete = resolve)});
            await scenario.settle();
            if (action === "destroy") scenario.picker.destroy();
            else if (action === "detach") scenario.detach();
            else {
                scenario.navigator.onLine = false;
                scenario.events.get("offline")();
            }
            complete({code: 0, data: {provider: "openfreemap"}});
            await scenario.settle();
            assert.equal(scenario.hosts.length, 0);
            assert.equal(scenario.events.size, 0);
        }
    });

    it("does not fetch runtime after a capability result returns to a disposed picker", async () => {
        let complete: (value: boolean) => void;
        const scenario = setup({supported: new Promise(resolve => complete = resolve)});
        await scenario.settle();
        scenario.picker.destroy();
        complete(true);
        await scenario.settle();
        assert.equal(scenario.calls.includes("/api/map/getRuntime"), false);
    });

    it("handles authentication, provider, request and synchronous host failures without exposing errors", async () => {
        for (const [options, message] of [
            [{runtime: async () => ({code: -1, msg: "mapAuthenticationBypass"})}, "mapAuthenticationBypass"],
            [{runtime: async () => ({code: 0, data: {provider: "untrusted"}})}, "mapLoadError"],
            [{runtime: async () => { throw new Error("Private runtime detail"); }}, "mapLoadError"],
            [{failDuringCreate: true}, "mapLoadError"],
        ] as const) {
            const scenario = setup(options);
            await scenario.settle();
            assert.equal(scenario.status.textContent, message);
            assert.equal(scenario.canvas.classList.contains("fn__none"), true);
            assert.equal(scenario.events.size, 0);
            assert.equal(scenario.observers.length, 0);
            if (scenario.hosts.length) assert.equal(scenario.hosts[0].destroys, 1);
        }
    });

    it("disposes the host and all listeners once and ignores late events after close, error or owner loss", async () => {
        for (const action of ["destroy", "detach", "offline", "error"]) {
            const scenario = setup();
            await scenario.settle();
            const host = scenario.hosts[0];
            if (action === "destroy") scenario.picker.destroy();
            else if (action === "detach") {
                scenario.detach();
                scenario.click({longitude: 40, latitude: 10});
            } else if (action === "offline") {
                scenario.navigator.onLine = false;
                scenario.events.get("offline")();
            } else host.options.onError("hostUnavailable");
            scenario.click({longitude: 40, latitude: 10});
            host.options.onReady();
            scenario.observers[0].callback();
            scenario.picker.destroy();
            assert.equal(host.destroys, 1);
            assert.equal(scenario.selected.length, 0);
            assert.equal(scenario.observers[0].disconnects, 1);
            assert.equal(scenario.events.size, 0);
        }
    });

    it("updates theme and opens only fixed attribution destinations while active", async () => {
        const scenario = setup();
        await scenario.settle();
        scenario.document.documentElement.setAttribute("data-theme-mode", "dark");
        scenario.observers[0].callback();
        assert.deepEqual(scenario.hosts[0].themes, ["dark"]);
        const link = protocol.AV_MAP_ATTRIBUTION_LINKS.openfreemap[0];
        scenario.hosts[0].options.onAttributionClick(link.id);
        assert.deepEqual(scenario.links, [[link.href, "_blank", "noopener,noreferrer"]]);
        scenario.picker.destroy();
        scenario.hosts[0].options.onAttributionClick(link.id);
        assert.equal(scenario.links.length, 1);
    });
});
