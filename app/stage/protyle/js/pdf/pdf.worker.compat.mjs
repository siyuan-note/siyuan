if (typeof Promise.withResolvers !== "function") {
    Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        writable: true,
        value() {
            let resolve;
            let reject;
            const promise = new Promise((promiseResolve, promiseReject) => {
                resolve = promiseResolve;
                reject = promiseReject;
            });
            return {promise, resolve, reject};
        },
    });
}

const {WorkerMessageHandler} = await import("./pdf.worker.min.mjs?v=6.4.299-siyuan.1");

export {WorkerMessageHandler};
