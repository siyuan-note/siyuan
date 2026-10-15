import type {ICommandContextSnapshot} from "./types";

export const DATABASE_ROW_COMMANDS = ["previousDatabaseRow", "nextDatabaseRow"] as const;

export const getDatabaseRowNavigationButton = (context: ICommandContextSnapshot, command: string) => {
    if (!DATABASE_ROW_COMMANDS.some(item => item === command) ||
        context.focus === "fileTree" || context.focus === "dock") {
        return;
    }
    const active = context.activeElement;
    const mobileRow = active?.closest(".protyle-db-row--mobile") ||
        (context.environment.endsWith("mobile") ? active?.ownerDocument.querySelector(".protyle-db-row--mobile") : undefined);
    // 字段编辑弹层和其他对话框保持各自的键盘操作，不切换后面的条目。
    if (active?.closest("input, textarea, select, .av__panel, .b3-menu") ||
        (active?.closest(".b3-dialog") && !mobileRow?.contains(active))) {
        return;
    }
    const root = mobileRow || context.activeTab?.element || context.protyle?.element;
    if (!root?.isConnected || root.closest(".fn__none")) {
        return;
    }
    const direction = command === "previousDatabaseRow" ? "previous" : "next";
    return root.querySelector<HTMLButtonElement>(`[data-database-row-navigation] [data-row-navigation="${direction}"]`) || undefined;
};
