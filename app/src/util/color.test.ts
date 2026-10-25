import * as assert from "node:assert/strict";
import test from "node:test";
import {parseCanvasColor} from "./color";

const pixels: Record<string, [number, number, number, number]> = {
    "#123456": [18, 52, 86, 255],
    "color(display-p3 1 0 0)": [255, 0, 0, 255],
    "rgba(255, 0, 0, 0.5)": [255, 0, 0, 128],
};

let created = 0;
let throwOnce = false;

const installCanvas = (saved: Map<string, PropertyDescriptor | undefined>) => {
    created = 0;
    throwOnce = false;
    for (const key of ["CSS", "document"]) {
        saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    const context = {
        fillStyle: "",
        clearRect() {
            this.fillStyle = "";
        },
        fillRect() {},
        getImageData() {
            if (throwOnce) {
                throwOnce = false;
                throw new Error("canvas temporarily unavailable");
            }
            return {data: pixels[this.fillStyle] || [0, 0, 0, 255]};
        },
    };
    Object.assign(globalThis, {
        CSS: {supports: (_property: string, value: string) => Object.hasOwn(pixels, value)},
        document: {createElement: () => {
            created++;
            return {width: 0, height: 0, getContext: () => context};
        }},
    });
};

const restore = (saved: Map<string, PropertyDescriptor | undefined>) => {
    saved.forEach((descriptor, key) => {
        if (descriptor) {
            Object.defineProperty(globalThis, key, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, key);
        }
    });
};

test("canvas colors parse through one reusable canvas and reject unsupported values", () => {
    const saved = new Map<string, PropertyDescriptor | undefined>();
    installCanvas(saved);
    try {
        assert.equal(parseCanvasColor("not-a-color"), undefined, "unsupported colors never touch the canvas");
        assert.equal(created, 0);
        assert.deepEqual(parseCanvasColor("#123456"), [18, 52, 86, 255]);
        assert.equal(created, 1);
        assert.deepEqual(parseCanvasColor("color(display-p3 1 0 0)"), [255, 0, 0, 255]);
        assert.deepEqual(parseCanvasColor("rgba(255, 0, 0, 0.5)"), [255, 0, 0, 128], "alpha stays in 0-255");
        assert.equal(created, 1, "later colors reuse the created canvas");
    } finally {
        restore(saved);
    }
});

test("canvas colors recover from a failed read on the next call", () => {
    const saved = new Map<string, PropertyDescriptor | undefined>();
    installCanvas(saved);
    try {
        throwOnce = true;
        assert.equal(parseCanvasColor("#123456"), undefined, "a failed read reports no color");
        assert.deepEqual(parseCanvasColor("#123456"), [18, 52, 86, 255], "the next call rebuilds the canvas");
        assert.equal(created, 1);
    } finally {
        restore(saved);
    }
});
