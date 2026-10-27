// Maintained compatibility entry for lazy-loaded PDF.js and Mermaid on WebView 95+.
// Native implementations always take precedence. This file is shared with the PDF worker.
(function () {
    const define = (target, name, value) => Object.defineProperty(target, name, {
        configurable: true, writable: true, value,
    });
    if (typeof URL.parse !== "function") {
        define(URL, "parse", function (input, base) {
            if (!arguments.length || typeof input === "symbol" || typeof base === "symbol") {
                throw new TypeError("Invalid URL argument");
            }
            const value = String(input);
            const baseValue = base === undefined ? undefined : String(base);
            try {
                return new URL(value, baseValue);
            } catch {
                return null;
            }
        });
    }
    if (typeof Promise.withResolvers !== "function") {
        define(Promise, "withResolvers", function () {
            let resolve;
            let reject;
            const promise = new this((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
            return {promise, resolve, reject};
        });
    }
    if (typeof AbortSignal.any !== "function") {
        define(AbortSignal, "any", function (signals) {
            const inputs = Array.from(signals);
            for (const signal of inputs) {
                if (!(signal instanceof AbortSignal)) { throw new TypeError("Expected an AbortSignal"); }
            }
            const controller = new AbortController();
            const listeners = new Map();
            const abort = (signal) => {
                const reason = signal.reason === undefined ? new DOMException("This operation was aborted", "AbortError") : signal.reason;
                if (!("reason" in controller.signal)) {
                    Object.defineProperty(controller.signal, "reason", {value: reason});
                }
                controller.abort(reason);
                for (const [input, listener] of listeners) { input.removeEventListener("abort", listener); }
                listeners.clear();
            };
            const aborted = inputs.find(signal => signal.aborted);
            if (aborted) { abort(aborted); return controller.signal; }
            for (const signal of new Set(inputs)) {
                const listener = () => abort(signal);
                listeners.set(signal, listener);
                signal.addEventListener("abort", listener, {once: true});
            }
            return controller.signal;
        });
    }
    if (typeof Object.groupBy !== "function") {
        define(Object, "groupBy", function (items, callback) {
            if (typeof callback !== "function") { throw new TypeError("Expected a grouping callback"); }
            const groups = Object.create(null);
            let index = 0;
            for (const item of items) {
                const value = callback(item, index++);
                const key = typeof value === "symbol" ? value : String(value);
                if (Object.prototype.hasOwnProperty.call(groups, key)) { groups[key].push(item); }
                else { groups[key] = [item]; }
            }
            return groups;
        });
    }
    if (typeof globalThis.structuredClone !== "function") {
        define(globalThis, "structuredClone", function (value, options) {
            if (!arguments.length) { throw new TypeError("Expected a value to clone"); }
            const transfer = options?.transfer === undefined ? [] : Array.from(options.transfer);
            const seen = new Set();
            for (const item of transfer) {
                // PDF.js transfers ArrayBuffers and ImageBitmaps. Other transfer-only
                // types cannot be synchronously cloned through PerformanceMark.
                if (seen.has(item) || !(item instanceof ArrayBuffer ||
                    (typeof ImageBitmap !== "undefined" && item instanceof ImageBitmap))) {
                    throw new DOMException("Unsupported or duplicate transferable", "DataCloneError");
                }
                seen.add(item);
            }
            // User Timing uses the browser's structured serialization algorithm,
            // retaining cycles, shared references, typed arrays and native objects.
            // Constructing a mark does not add an entry to the performance timeline.
            const clone = new PerformanceMark("siyuan-clone", {detail: value}).detail;
            if (transfer.length) {
                const channel = new MessageChannel();
                try {
                    // Detach originals only after cloning succeeds, using native transfer.
                    channel.port1.postMessage(null, transfer);
                } finally {
                    channel.port1.close();
                    channel.port2.close();
                }
            }
            return clone;
        });
    }
})();
