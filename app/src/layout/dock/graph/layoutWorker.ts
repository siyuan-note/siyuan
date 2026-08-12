import {GraphForceLayout} from "./layoutCore";
import {TGraphLayoutRequest, TGraphLayoutResponse} from "./types";

type TWorkerScope = {
    onmessage: (event: MessageEvent<TGraphLayoutRequest>) => void;
    postMessage: (message: TGraphLayoutResponse, transfer: Transferable[]) => void;
};

const workerScope = globalThis as unknown as TWorkerScope;
let generation = 0;
let interactive = false;
let layout: GraphForceLayout;
let paused = false;
let scheduled = false;
let stopped = true;
let lastPosted = 0;

const postPositions = (settled: boolean) => {
    const positions = layout.positions.slice();
    workerScope.postMessage({
        type: "positions",
        generation,
        positions,
        settled,
    }, [positions.buffer]);
    lastPosted = performance.now();
};

const schedule = () => {
    if (scheduled || stopped || paused || !layout) {
        return;
    }
    scheduled = true;
    setTimeout(run, 0);
};

const run = () => {
    scheduled = false;
    if (stopped || paused || !layout) {
        return;
    }
    const start = performance.now();
    let settled = false;
    do {
        settled = layout.step();
    } while (!settled && performance.now() - start < 12);
    if (settled || performance.now() - lastPosted >= (interactive ? 16 : 32)) {
        postPositions(settled);
    }
    if (settled) {
        interactive = false;
        stopped = true;
        return;
    }
    schedule();
};

const restart = () => {
    stopped = false;
    schedule();
};

workerScope.onmessage = (event) => {
    const message = event.data;
    if (message.type === "init") {
        generation = message.generation;
        layout = new GraphForceLayout({
            degrees: message.degrees,
            layout: message.options,
            positions: message.positions,
            sizes: message.sizes,
            sources: message.sources,
            targets: message.targets,
        });
        interactive = false;
        paused = false;
        lastPosted = 0;
        restart();
        return;
    }
    if (!layout || message.generation !== generation) {
        return;
    }
    if (message.type === "options") {
        layout.setOptions(message.options);
        restart();
    } else if (message.type === "pin") {
        layout.pin(message.index, message.x, message.y);
        interactive = true;
        restart();
    } else if (message.type === "release") {
        layout.release(message.index);
        interactive = true;
        workerScope.postMessage({
            type: "released",
            generation,
            index: message.index,
            token: message.token,
        }, []);
        restart();
    } else if (message.type === "pause") {
        paused = true;
    } else if (message.type === "resume") {
        paused = false;
        restart();
    } else if (message.type === "stop") {
        stopped = true;
    }
};
