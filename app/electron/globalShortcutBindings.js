const updateGlobalShortcutBindings = (owner, data, options) => {
    const {workspaces, globalShortcut, convert, getActiveId, toggle, dispatch, reportError} = options;
    const previous = owner.hotkeys || [];
    owner.shortcutsSuspended = data.suspended === true;
    if (!owner.shortcutsSuspended) {
        owner.hotkeys = [...new Set(data.hotkeys.filter(key => typeof key === "string" && key))];
        owner.toggleHotkeys = Array.isArray(data.toggleHotkeys) ? data.toggleHotkeys : data.hotkeys.slice(0, 1);
        owner.hotkeyLanguages = data.languages;
    }
    const keys = workspaces.flatMap(workspace => workspace.hotkeys || []);
    const activeHotkeys = new Set(keys.map(convert));
    if (workspaces.some(workspace => workspace.shortcutsSuspended)) {
        new Set([...previous, ...keys].map(convert)).forEach(key => {
            if (key) {
                globalShortcut.unregister(key);
            }
        });
        return [];
    }
    previous.forEach(key => {
        const accelerator = convert(key);
        if (accelerator && !activeHotkeys.has(accelerator)) {
            globalShortcut.unregister(accelerator);
        }
    });
    const failed = [];
    const registered = new Set();
    keys.forEach(key => {
        const accelerator = convert(key);
        if (!accelerator || registered.has(accelerator)) {
            return;
        }
        registered.add(accelerator);
        globalShortcut.unregister(accelerator);
        let success = false;
        try {
            success = globalShortcut.register(accelerator, () => {
                const eligible = workspaces.filter(workspace =>
                    !workspace.browserWindow.isDestroyed() &&
                    workspace.hotkeys?.some(item => convert(item) === accelerator));
                const activeId = getActiveId();
                const current = eligible.find(workspace => workspace.browserWindow.webContents.id === activeId) ||
                    eligible.find(workspace => workspace === owner) || eligible[0];
                if (!current) {
                    return;
                }
                if (current.toggleHotkeys?.some(item => convert(item) === accelerator)) {
                    toggle(current);
                } else {
                    dispatch(current, current.hotkeys.find(item => convert(item) === accelerator));
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

module.exports = {updateGlobalShortcutBindings};
