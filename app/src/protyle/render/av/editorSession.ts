const sessions = new Set<{owner: HTMLElement}>();

export const hasAVEditorSession = (element: HTMLElement) => {
    return Array.from(sessions).some(session => element.contains(session.owner));
};

// 浮层位于正文之外，使用所属编辑器标记编辑期间，关闭后通知反链处理延迟刷新。
export const beginAVEditorSession = (owner: HTMLElement) => {
    const session = {owner};
    sessions.add(session);
    return () => {
        if (sessions.delete(session)) {
            owner.dispatchEvent(new CustomEvent("av-editor-close", {bubbles: true}));
        }
    };
};
