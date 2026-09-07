import {TemplateEntry} from "./fileTree";

export const getTemplateActionState = (action: string, selected: TemplateEntry | undefined, dirty: boolean, busy: boolean,
                                       hasPreviewContext = true) => {
    const packageMove = !!selected?.isPackage && ["rename", "move"].includes(action);
    const disabled = (["save", "preview"].includes(action) && (!selected || selected.isDir)) ||
        (action === "save" && !dirty) || (action === "preview" && !hasPreviewContext) || packageMove ||
        (["rename", "move", "remove"].includes(action) && !selected);
    // 忙碌状态仅影响操作可用性，不切换原生禁用样式。
    return {disabled, ariaDisabled: busy || disabled, packageMove};
};
