// IPC 通道名的唯一来源：主进程注册与发送都从这里取值，渲染进程侧的同值常量在
// `app/src/constants.ts` 的 `Constants` 中。两端一致性由 `channelsConsistency.test.ts` 校验，
// 改名时必须同时修改本文件、`src/constants.ts` 与 `static/` 下的启动页脚本。
//
// 命名与前端保持同一规则：通道名转为大写下划线并加 `SIYUAN_` 前缀。
const Channel = {
    // 窗口生命周期与握手
    SIYUAN_EVENT: "siyuan-event",
    SIYUAN_INIT: "siyuan-init",
    SIYUAN_READY_TO_SHOW: "siyuan-ready-to-show",
    SIYUAN_SHOW_WINDOW: "siyuan-show-window",
    SIYUAN_OPEN_WINDOW: "siyuan-open-window",
    SIYUAN_OPEN_WORKSPACE: "siyuan-open-workspace",
    SIYUAN_SAVE_CLOSE: "siyuan-save-close",
    SIYUAN_QUIT: "siyuan-quit",
    SIYUAN_FIRST_QUIT: "siyuan-first-quit",

    // 深链、文件与外部打开
    SIYUAN_OPEN_URL: "siyuan-open-url",
    SIYUAN_OPEN_FILE: "siyuan-open-file",
    SIYUAN_OPEN_MARKDOWN: "siyuan-open-markdown",
    SIYUAN_SYNC_MARKDOWN_KEYMAP: "siyuan-sync-markdown-keymap",
    SIYUAN_OPEN_SETTING: "siyuan-open-setting",
    SIYUAN_OPEN_HELP: "siyuan-open-help",

    // 命令、查询与窗口间消息
    SIYUAN_CMD: "siyuan-cmd",
    SIYUAN_GET: "siyuan-get",
    SIYUAN_HOTKEY: "siyuan-hotkey",
    SIYUAN_BLOCK_DRAG: "siyuan-block-drag",
    SIYUAN_SEND_WINDOWS: "siyuan-send-windows",

    // 同一内核下多个窗口之间的工作空间协同
    SIYUAN_WINDOW_WORKSPACE_SET: "siyuan-window-workspace-set",
    SIYUAN_WINDOW_WORKSPACE_FOCUS: "siyuan-window-workspace-focus",
    SIYUAN_WINDOW_WORKSPACE_GET_OPEN: "siyuan-window-workspace-get-open",
    SIYUAN_WINDOW_WORKSPACE_FLUSH: "siyuan-window-workspace-flush",
    SIYUAN_WINDOW_WORKSPACE_FLUSH_ALL: "siyuan-window-workspace-flush-all",
    SIYUAN_WINDOW_WORKSPACE_SAVED: "siyuan-window-workspace-saved",

    // 托盘、应用菜单与系统集成
    SIYUAN_CONFIG_TRAY: "siyuan-config-tray",
    SIYUAN_SYNC_APP_MENU: "siyuan-sync-app-menu",
    SIYUAN_AUTO_LAUNCH: "siyuan-auto-launch",
    SIYUAN_INSTALL_UPDATE: "siyuan-install-update",
    SIYUAN_TOPBAR_CONTEXT_MENU: "siyuan-topbar-context-menu",

    // 上下文菜单与对话框
    SIYUAN_CONTEXT_MENU: "siyuan-context-menu",
    SIYUAN_SPELLCHECK_CONTEXT: "siyuan-spellcheck-context",
    SIYUAN_SPELLCHECK_ACTION: "siyuan-spellcheck-action",
    SIYUAN_CONFIRM_DIALOG: "siyuan-confirm-dialog",
    SIYUAN_ALERT_DIALOG: "siyuan-alert-dialog",

    // 导出
    SIYUAN_EXPORT_PDF: "siyuan-export-pdf",
    SIYUAN_EXPORT_NEWWINDOW: "siyuan-export-newwindow",

    // 启动页与工作空间选择
    SIYUAN_FIRST_INIT: "siyuan-first-init",
    SIYUAN_SELECT_WORKSPACE: "siyuan-select-workspace",

    // 远端内核连接管理
    SIYUAN_CONNECTIONS: "siyuan-connections",
    SIYUAN_CONNECTION_TARGET: "siyuan-connection-target",
    SIYUAN_MANAGE_CONNECTIONS: "siyuan-manage-connections",

    // 设置窗口
    SIYUAN_SETTINGS_PREPARE: "siyuan-settings-prepare",
    SIYUAN_SETTINGS_READY: "siyuan-settings-ready",
    SIYUAN_SETTINGS_SHOWN: "siyuan-settings-shown",
    SIYUAN_SETTINGS_CLOSED: "siyuan-settings-closed",
    SIYUAN_SETTINGS_CLOSE: "siyuan-settings-close",
    SIYUAN_SETTINGS_CLOSE_SELF: "siyuan-settings-close-self",
    SIYUAN_SETTINGS_OPEN_DIALOG: "siyuan-settings-open-dialog",
    SIYUAN_SETTINGS_COMMAND: "siyuan-settings-command",
    SIYUAN_SETTINGS_GEOMETRY: "siyuan-settings-geometry",
    SIYUAN_SETTINGS_INTERFACE: "siyuan-settings-interface",

    // 设置窗口中的后台任务
    SIYUAN_SETTINGS_TASK_START: "siyuan-settings-task-start",
    SIYUAN_SETTINGS_TASK_READY: "siyuan-settings-task-ready",
    SIYUAN_SETTINGS_TASK_END: "siyuan-settings-task-end",

    // 渲染取页与加密笔记本系统锁
    SIYUAN_WEB_PAGE_FETCH: "siyuan-web-page-fetch",
    SIYUAN_NOTEBOOK_SYSTEM_LOCK_READY: "siyuan-notebook-system-lock-ready",
} as const;

export {Channel};
