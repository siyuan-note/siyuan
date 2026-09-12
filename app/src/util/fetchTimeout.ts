export const withFetchTimeout = <T>(
    request: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    timeout = 0,
): Promise<T> => {
    if (timeout <= 0) {
        return request(signal);
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) {
        abort();
    } else {
        signal?.addEventListener("abort", abort, {once: true});
    }
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => {
            // 先结束等待，再取消网络请求，确保超时不会被当作用户主动取消。
            reject(new DOMException("Request timed out", "TimeoutError"));
            controller.abort();
        }, timeout);
    });
    return Promise.race([Promise.resolve().then(() => request(controller.signal)), deadline]).finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    });
};
