// 把捕获到的任意值转成 Error，供只接受 Error 的回调使用。
const toError = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));

// 日志与错误窗口使用的文案，与原生 error.message 保持一致。
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export {toError, errorMessage};
