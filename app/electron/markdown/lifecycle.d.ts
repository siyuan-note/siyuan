// `markdown/lifecycle.js` 的声明：把窗口管理器的退出能力收成一个可空转的前置检查。
import type {MarkdownWindows} from "./windows";

export type MarkdownLifecycle = {
    /** 正在执行一次退出协调。 */
    busy: () => boolean;
    hasWindows: () => boolean;
    /** 还有窗口或恢复任务未完成。 */
    hasPendingWork: () => boolean;
    /** 请求窗口保存并准备退出；没有待处理窗口时直接返回 true。 */
    prepare: (reason: string) => Promise<boolean>;
    /** 关闭全部窗口；没有待处理窗口时直接返回 true。 */
    finish: () => Promise<boolean>;
    /** 撤销上一次退出请求。 */
    cancel: () => void;
    /** 拦截一次应用退出并异步收尾；返回 true 表示已接管本次退出。 */
    beforeQuit: (event: {preventDefault: () => void}) => boolean;
};

export declare const createMarkdownLifecycle: (options: {
    getManager: () => MarkdownWindows | undefined;
    quit: () => void;
    log?: (message: string) => void;
}) => MarkdownLifecycle;
