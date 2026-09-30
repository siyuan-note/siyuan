// 维护任务先阻塞同一内核的原生窗口并提交待保存输入，任一窗口失败时取消任务。
const createSettingsTaskBridge = ({ipcMain, getTarget, getWindows}) => {
    const tasks = new Map();
    const disabled = new Map();
    let sequence = 0;
    const finish = task => {
        if (!tasks.delete(task.id)) return;
        clearTimeout(task.timer);
        task.owner.removeListener("destroyed", task.close);
        for (const win of task.blockedWindows) {
            const state = disabled.get(win);
            if (state && --state.count === 0) {
                disabled.delete(win);
                if (!win.isDestroyed()) win.setEnabled(state.enabled);
            }
            if (!win.isDestroyed()) {
                win.webContents.send("siyuan-send-windows", {cmd: "endSettingTask", data: task.id});
            }
        }
    };
    ipcMain.on("siyuan-settings-task-ready", (event, data) => {
        const task = tasks.get(data?.id);
        if (!task || event.senderFrame !== event.sender.mainFrame || !task.pending.has(event.sender.id)) return;
        if (data.saved !== true) {
            finish(task);
            task.reject(new Error("Could not save pending editor input"));
            return;
        }
        task.pending.delete(event.sender.id);
        if (!task.pending.size) {
            clearTimeout(task.timer);
            task.resolve(task.id);
        }
    });
    ipcMain.handle("siyuan-settings-task-start", (event) => {
        const target = getTarget(event.sender.id);
        if (!target || event.senderFrame !== event.sender.mainFrame) throw new Error("Unregistered settings task sender");
        const windows = getWindows(target.origin).filter(win => !win.isDestroyed());
        if (!windows.some(win => win.webContents.id === event.sender.id)) throw new Error("Settings window is not initialized");
        return new Promise((resolve, reject) => {
            const id = "native-" + (++sequence);
            const task = {id, owner: event.sender, blockedWindows: new Set(), pending: new Set(windows.map(win => win.webContents.id)), resolve, reject};
            task.close = () => { finish(task); reject(new Error("Settings task owner closed")); };
            task.timer = setTimeout(() => { finish(task); reject(new Error("Editor preparation timed out")); }, 10000);
            tasks.set(id, task);
            event.sender.once("destroyed", task.close);
            try {
                for (const win of windows) {
                    const state = disabled.get(win) || {count: 0, enabled: win.isEnabled()};
                    state.count++;
                    disabled.set(win, state);
                    task.blockedWindows.add(win);
                    win.setEnabled(false);
                    win.webContents.send("siyuan-send-windows", {cmd: "prepareSettingTask", data: id});
                }
            } catch (error) {
                finish(task);
                reject(error);
            }
        });
    });
    ipcMain.handle("siyuan-settings-task-end", (event, id) => {
        const task = tasks.get(id);
        if (task?.owner === event.sender && event.senderFrame === event.sender.mainFrame) finish(task);
    });
};

module.exports = {createSettingsTaskBridge};
