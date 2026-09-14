import {test} from "node:test";
import * as assert from "node:assert/strict";

test("Model initializes before loading UI modules that depend on its subclasses", async () => {
    const globals = ["SIYUAN_VERSION", "NODE_ENV"];
    const descriptors = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
    globals.forEach(name => Object.defineProperty(globalThis, name, {configurable: true, value: "test"}));
    try {
        const {Model} = await import("./Model");
        class Panel extends Model {}
        assert.equal(Object.getPrototypeOf(Panel), Model);
        for (const module of ["../util/processMessage", "../util/reloadSync", "../util/kernelFault"]) {
            assert.equal(require.cache[require.resolve(module)], undefined);
        }
    } finally {
        globals.forEach((name, index) => {
            if (descriptors[index]) {
                Object.defineProperty(globalThis, name, descriptors[index]);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        });
    }
});
