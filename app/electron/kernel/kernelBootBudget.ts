// 内核启动期间的等待与重试上限。这些判定不含 I/O，调用方只按结果决定是否继续。
// 版本查询最多重试该次数，实际请求次数为该值加一。
const VERSION_QUERY_ATTEMPTS = 14;
// 进度查询连续失败累计到该值即放弃，实际请求次数等于该值。
const PROGRESS_FAILURE_LIMIT = 15;
const BOOT_TIMEOUT_MS = 300000;
const LOCK_RETRY_DEADLINE_MS = 90000;
const VERSION_RETRY_INTERVAL_MS = 500;
const PROGRESS_POLL_INTERVAL_MS = 100;
const PROGRESS_RETRY_INTERVAL_MS = 500;
const BOOT_ANIMATION_SETTLE_MS = 200;

// 证书与网络配置变化属于可恢复的瞬时错误，与本机请求超时一并有限重试。
const RETRYABLE_PROGRESS_ERRORS = new Set([
    "net::ERR_CERT_DATABASE_CHANGED",
    "net::ERR_CERT_VERIFIER_CHANGED",
    "net::ERR_NETWORK_CHANGED",
]);

// 本机请求超时的错误名：内核可能已监听端口，但本机请求既不会成功也不会失败，调用方据此单独提示。
const LOCAL_KERNEL_TIMEOUT_ERROR = "LocalKernelRequestTimeoutError";

const isLocalKernelRequestTimeout = (error: {name?: unknown} | null | undefined): boolean =>
    LOCAL_KERNEL_TIMEOUT_ERROR === error?.name;

const exhaustedVersionAttempts = (attempts: number): boolean => VERSION_QUERY_ATTEMPTS < attempts;

// 连续失败达到上限后放弃；成功的响应会重置计数。
const canRetryProgress = (error: unknown, consecutiveFailures: number): boolean => {
    const message = (error as {message?: string} | null | undefined)?.message;
    if (!RETRYABLE_PROGRESS_ERRORS.has(message as string) && !isLocalKernelRequestTimeout(error as {name?: unknown})) {
        return false;
    }
    return consecutiveFailures < PROGRESS_FAILURE_LIMIT;
};

const bootTimedOut = (now: number, startedAt: number): boolean => BOOT_TIMEOUT_MS < now - startedAt;

const lockRetryExpired = (now: number, deadline?: number): boolean => deadline !== undefined && now >= deadline;

export {
    VERSION_QUERY_ATTEMPTS,
    PROGRESS_FAILURE_LIMIT,
    BOOT_TIMEOUT_MS,
    LOCK_RETRY_DEADLINE_MS,
    VERSION_RETRY_INTERVAL_MS,
    PROGRESS_POLL_INTERVAL_MS,
    PROGRESS_RETRY_INTERVAL_MS,
    BOOT_ANIMATION_SETTLE_MS,
    LOCAL_KERNEL_TIMEOUT_ERROR,
    isLocalKernelRequestTimeout,
    exhaustedVersionAttempts,
    canRetryProgress,
    bootTimedOut,
    lockRetryExpired,
};
