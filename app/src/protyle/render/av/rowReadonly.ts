import {disabledProtyle, enableProtyle} from "../../util/onGet";

export const inheritDatabaseRowReadonly = (target: IProtyle, source: Partial<IProtyle>) => {
    // 条目面板只继承所属文档的临时编辑状态，不解锁其他文档。
    if (!source?.block?.rootID || source.block.rootID !== target.block.rootID ||
        typeof source.disabled !== "boolean") {
        return;
    }
    if (window.siyuan.config.readonly || window.siyuan.isPublish || source.disabled ||
        source.options?.history?.created || source.options?.history?.snapshot) {
        disabledProtyle(target);
    } else {
        enableProtyle(target);
    }
};
