import type {GlobalShortcut} from "electron";
import type {Workspace} from "../shared/types";

type ShortcutWorkspace = Workspace & {
    hotkeys?: string[];
    toggleHotkeys?: string[];
    shortcutsSuspended?: boolean;
};

type ShortcutBindingsOptions = {
    workspaces: ShortcutWorkspace[];
    globalShortcut: GlobalShortcut;
    convert: (key: string) => string | undefined;
    getActiveId: () => number | undefined;
    toggle: (workspace: ShortcutWorkspace) => void;
    dispatch: (workspace: ShortcutWorkspace, hotkey: string | undefined) => void;
    reportError: (error: unknown) => void;
};

const updateGlobalShortcutBindings = (owner: {
    hotkeys?: string[];
    toggleHotkeys?: string[];
    hotkeyLanguages?: unknown;
    shortcutsSuspended?: boolean;
}, data: {
    suspended?: boolean;
    hotkeys: string[];
    toggleHotkeys?: unknown;
    languages?: unknown;
}, {
    workspaces, globalShortcut, convert, getActiveId, toggle, dispatch, reportError,
}: ShortcutBindingsOptions): string[] => {
    const previous = owner.hotkeys || [];
    owner.shortcutsSuspended = data.suspended === true;
    if (!owner.shortcutsSuspended) {
        owner.hotkeys = [...new Set<string>(data.hotkeys.filter((key: string) => typeof key === "string" && key))];
        owner.toggleHotkeys = Array.isArray(data.toggleHotkeys) ? data.toggleHotkeys : data.hotkeys.slice(0, 1);
        owner.hotkeyLanguages = data.languages;
    }
    const keys = workspaces.flatMap((workspace: ShortcutWorkspace) => workspace.hotkeys || []);
    const activeHotkeys = new Set(keys.map(convert));
    if (workspaces.some((workspace: ShortcutWorkspace) => workspace.shortcutsSuspended)) {
        new Set([...previous, ...keys].map(convert)).forEach((key: string | undefined) => {
            if (key) {
                globalShortcut.unregister(key);
            }
        });
        return [];
    }
    previous.forEach((key: string) => {
        const accelerator = convert(key);
        if (accelerator && !activeHotkeys.has(accelerator)) {
            globalShortcut.unregister(accelerator);
        }
    });
    const failed: string[] = [];
    const registered = new Set<string>();
    keys.forEach((key: string) => {
        const accelerator = convert(key);
        if (!accelerator || registered.has(accelerator)) {
            return;
        }
        registered.add(accelerator);
        globalShortcut.unregister(accelerator);
        let success = false;
        try {
            success = globalShortcut.register(accelerator, () => {
                const eligible = workspaces.filter((workspace: ShortcutWorkspace) =>
                    !workspace.browserWindow.isDestroyed() &&
                    workspace.hotkeys?.some((item: string) => convert(item) === accelerator));
                const activeId = getActiveId();
                const current = eligible.find((workspace: ShortcutWorkspace) => workspace.browserWindow.webContents.id === activeId) ||
                    eligible.find((workspace: ShortcutWorkspace) => workspace === owner) || eligible[0];
                if (!current) {
                    return;
                }
                if (current.toggleHotkeys?.some((item: string) => convert(item) === accelerator)) {
                    toggle(current);
                } else {
                    dispatch(current, (current.hotkeys || []).find((item: string) => convert(item) === accelerator));
                }
            });
        } catch (error) {
            reportError(error);
        }
        if (!success) {
            failed.push(key);
        }
    });
    return failed;
};

export {updateGlobalShortcutBindings};
