export type TCommandSource =
    "commandPanel" |
    "shortcut" |
    "editorShortcut" |
    "fileTreeShortcut" |
    "dockShortcut" |
    "globalShortcut" |
    "keymap" |
    "menu" |
    "api";

export type TCommandFocus = "global" | "editor" | "fileTree" | "dock";

export type TCommandEnvironment =
    "desktop" |
    "desktop-window" |
    "mobile" |
    "browser-desktop" |
    "browser-mobile";

export interface ICommandDocumentContext {
    id?: string;
    rootId?: string;
    notebookId?: string;
    path?: string;
}

export interface ICommandBlockContext {
    id: string;
    element: HTMLElement;
}

export interface ICommandTableCellContext {
    element: HTMLTableCellElement;
    row: number;
    column: number;
}

export interface ICommandFileTreeContext {
    model?: unknown;
    elements: Element[];
    ids: string[];
    paths: string[];
}

export interface ICommandTabContext {
    id?: string;
    model?: unknown;
    element?: HTMLElement;
}

export interface ICommandDockContext {
    type?: string;
    element: HTMLElement;
}

export interface ICommandContextSnapshot {
    app: object;
    source: TCommandSource;
    environment: TCommandEnvironment;
    focus: TCommandFocus;
    range?: Range;
    activeElement?: Element;
    protyle?: IProtyle;
    document?: ICommandDocumentContext;
    block?: ICommandBlockContext;
    selectedBlocks: ICommandBlockContext[];
    tableCell?: ICommandTableCellContext;
    fileTree?: ICommandFileTreeContext;
    activeTab?: ICommandTabContext;
    dock?: ICommandDockContext;
}

export type TCommandKeymapPath =
    readonly ["general", string] |
    readonly ["editor", string, string] |
    readonly ["plugin", string, string];

export interface ICommandDefinition {
    id: string;
    category: "core" | "plugin";
    label: () => string;
    englishLabel?: () => string | undefined;
    keywords?: () => readonly string[];
    icon?: string;
    keymapPath?: TCommandKeymapPath;
    hotkey?: () => string;
    surfaces?: readonly TCommandSource[];
    order?: number;
    platform?: (environment: TCommandEnvironment) => boolean;
    when?: (context: ICommandContextSnapshot) => boolean;
    enabled?: (context: ICommandContextSnapshot) => boolean;
    execute: (context: ICommandContextSnapshot, args?: unknown) => unknown | Promise<unknown>;
}

export type TCommandExecutionStatus = "executed" | "notFound" | "unavailable" | "disabled";

export interface ICommandExecutionResult {
    status: TCommandExecutionStatus;
    command?: ICommandDefinition;
    value?: unknown;
}
