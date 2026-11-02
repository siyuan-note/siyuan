// 本机内核的只读请求。本机通道异常时请求可能既不成功也不失败，因此超时同时覆盖响应头与响应体读取，
// 超时错误带独立名称，调用方据此与防火墙拦截区分提示。
import {LOCAL_KERNEL_TIMEOUT_ERROR} from "./kernelBootBudget";

type LocalKernelResponse = {json: () => Promise<Record<string, any>>};

const localKernelTimeoutError = (): Error => {
    const error = new Error("local kernel request timed out");
    error.name = LOCAL_KERNEL_TIMEOUT_ERROR;
    return error;
};

const createLocalKernelRequest = ({fetch: fetchKernel, timeoutMs, scheduleTimer, cancelTimer}:
    {
        fetch: (url: string, init: {signal: AbortSignal}) => Promise<LocalKernelResponse>;
        timeoutMs: number;
        scheduleTimer: (callback: () => void, ms: number) => unknown;
        cancelTimer: (timer: unknown) => void;
    }) => {
    const fetchJSON = async (url: string): Promise<Record<string, any>> => {
        const abortController = new AbortController();
        const timer = scheduleTimer(() => abortController.abort(), timeoutMs);
        try {
            const response = await fetchKernel(url, {signal: abortController.signal});
            return await response.json();
        } catch (error) {
            if (abortController.signal.aborted) {
                throw localKernelTimeoutError();
            }
            throw error;
        } finally {
            cancelTimer(timer);
        }
    };

    return fetchJSON;
};

export {createLocalKernelRequest};
