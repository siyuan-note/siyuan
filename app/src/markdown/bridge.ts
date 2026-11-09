import type {MarkdownFormat, MarkdownHost, MarkdownTarget} from "./contracts";
import type {MarkdownSessionState} from "./session";
import type {MarkdownTreeBridge} from "./treeContracts";
import type {SidebarKeymap} from "../util/dockKeymap";

export interface MarkdownPreferences {
    mode: "ir" | "wysiwyg" | "sv";
    theme?: "system" | "light" | "dark";
    fontSize?: number;
    sources?: Partial<Record<MarkdownAppearanceGroup, string>>;
    independent?: MarkdownIndependentAppearance;
    fonts?: MarkdownIndependentAppearance["fonts"];
}

export type MarkdownAppearanceGroup = "theme" | "fontSize" | "fonts";
export interface MarkdownSystemFont {family: string; weight: number; displayName: string; aliases?: string[]; spacing?: string;}
export interface MarkdownFont {family: string; weight: number;}
export interface MarkdownIndependentAppearance {
    theme?: "system" | "light" | "dark";
    fontSize?: number;
    fonts?: {global: MarkdownFont[]; editor: MarkdownFont[]; code: MarkdownFont[]};
}
export interface MarkdownAppearancePatch {
    sources?: Partial<Record<MarkdownAppearanceGroup, string>>;
    independent?: MarkdownIndependentAppearance;
}
export interface MarkdownAppearance {
    theme: "system" | "light" | "dark";
    fontSize: number;
    sources: Record<MarkdownAppearanceGroup, string>;
    workspaces: Array<{id: string; name: string}>;
    fonts: {global: MarkdownFont[]; editor: MarkdownFont[]; code: MarkdownFont[]};
    customFonts: Array<MarkdownFont & {url: string}>;
    independent?: MarkdownIndependentAppearance;
}

export interface MarkdownBootstrap {
    sessionId: string;
    content: string;
    target?: MarkdownTarget;
    format?: MarkdownFormat;
    recovered?: {revision: number; targetGeneration: number};
    preferences: MarkdownPreferences;
    appearance?: MarkdownAppearance;
    capabilities?: {systemFonts?: boolean; workspaceAppearance?: boolean};
    languages: Record<string, string>;
    lang: string;
    platform: string;
    dark: boolean;
    keymap?: SidebarKeymap;
}

export interface MarkdownCommand {
    id: string;
    type: "close" | "prepare-quit" | "cancel-quit" | "external-change" | "theme" | "background" | "tree-change" | "window-state" | "keymap";
    dark?: boolean;
    keymap?: SidebarKeymap;
    windowState?: MarkdownWindowState;
}

export interface MarkdownWindowState {maximized: boolean; fullscreen: boolean;}

export interface MarkdownBridge {
    window?: {
        state(): Promise<MarkdownWindowState>;
        control(action: "minimize" | "maximize" | "close"): Promise<void>;
        overlay(style: {height: number; symbolColor: string}): Promise<boolean>;
    };
    host: MarkdownHost;
    tree: MarkdownTreeBridge;
    bootstrap(): Promise<MarkdownBootstrap>;
    newDocument(): Promise<void>;
    openDocument(): Promise<void>;
    revealFile?(): Promise<void>;
    chooseSaveAs(format: MarkdownFormat): Promise<{kind: "selected"; target: MarkdownTarget} | {kind: "cancelled" | "occupied" | "blocked"}>;
    cancelSaveAs(handle: string): Promise<void>;
    authorizeResources(): Promise<boolean>;
    insertImage(): Promise<{kind: "inserted"; reference: string} | {kind: "cancelled" | "blocked"}>;
    resolveResource(reference: string): Promise<string | undefined>;
    openLink(url: string): Promise<void>;
    preferences(patch: Partial<MarkdownPreferences>): Promise<MarkdownPreferences>;
    systemFonts?(): Promise<MarkdownSystemFont[]>;
    appearance?(patch?: MarkdownAppearancePatch): Promise<MarkdownAppearance>;
    confirm(action: "reload" | "overwrite" | "save-as"): Promise<boolean>;
    confirmClose(): Promise<"keep" | "save-as" | "cancel">;
    recoveries(): Promise<Array<{id: string; displayName: string; updatedAt: number}>>;
    recover(id: string): Promise<void>;
    discardRecovery(id: string): Promise<void>;
    state(state: Pick<MarkdownSessionState, "sessionId" | "status" | "revision" | "savedRevision" | "draftRevision" | "targetGeneration" | "composing">): Promise<void>;
    onCommand(listener: (command: MarkdownCommand) => void): () => void;
    respond(id: string, accepted: boolean): Promise<void>;
}

declare global {
    interface Window {
        siyuanMarkdown: MarkdownBridge;
    }
}
