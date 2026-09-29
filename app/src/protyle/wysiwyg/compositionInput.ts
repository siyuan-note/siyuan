// 只将明确提交的文本输入作为恢复信号，避免提前结束仍在更新的输入法候选内容。
export const isCommittedTextInput = (event: Pick<InputEvent, "isComposing" | "inputType">) => {
    return event.isComposing === false &&
        ["insertText", "insertReplacementText", "insertFromComposition"].includes(event.inputType);
};
