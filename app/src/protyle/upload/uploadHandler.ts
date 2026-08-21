export const ASSET_UPLOAD_HANDLER_TIMEOUT = 120_000;

export class AssetUploadHandlerTimeoutError extends Error {
}

export const waitForUploadHandler = <T>(result: PromiseLike<T>, signal: AbortSignal,
                                        timeout = ASSET_UPLOAD_HANDLER_TIMEOUT) => {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: (value: any) => void, value: any) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutId);
            signal.removeEventListener("abort", onAbort);
            callback(value);
        };
        const onAbort = () => finish(reject, signal.reason instanceof Error ? signal.reason :
            new Error("The upload was canceled"));
        const timeoutId = setTimeout(() => finish(reject,
            new AssetUploadHandlerTimeoutError("Custom upload handler timed out")), timeout);
        signal.addEventListener("abort", onAbort, {once: true});
        if (signal.aborted) {
            onAbort();
            return;
        }
        Promise.resolve(result).then(value => finish(resolve, value), error => finish(reject, error));
    });
};
