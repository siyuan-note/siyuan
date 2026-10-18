interface IBazaarInstallTask {
    controller: AbortController;
    repoURL: string;
    percent: number;
    installing: boolean;
}

// 按包保留安装状态，切换详情或重新挂载集市时仍能阻止重复请求。
const installTasks = new Map<string, IBazaarInstallTask>();
const taskKey = (type: TBazaarType, name: string) => `${type}/${name}`;

export const getBazaarInstallTask = (type: TBazaarType, name: string) => installTasks.get(taskKey(type, name));

export const beginBazaarInstall = (type: TBazaarType, name: string, repoURL: string) => {
    const key = taskKey(type, name);
    if (installTasks.has(key)) {
        return;
    }
    const task: IBazaarInstallTask = {controller: new AbortController(), repoURL, percent: 0, installing: false};
    installTasks.set(key, task);
    return task;
};

export const finishBazaarInstall = (type: TBazaarType, name: string, task: IBazaarInstallTask) => {
    const key = taskKey(type, name);
    if (installTasks.get(key) === task) {
        installTasks.delete(key);
    }
};

export const cancelBazaarInstall = (type: TBazaarType, name: string) => {
    const task = getBazaarInstallTask(type, name);
    if (task && !task.installing) {
        task.controller.abort();
    }
};

export const renderBazaarInstall = (root: ParentNode) => {
    const side = root.querySelector("#configBazaarReadme .item__side");
    if (!side) {
        return;
    }
    const task = installTasks.get(`${side.getAttribute("data-package-type")}/${side.getAttribute("data-name")}`);
    const button = root.querySelector<HTMLButtonElement>('#configBazaarReadme [data-type="install"]');
    if (!button) {
        return;
    }
    if (!task) {
        if (button.hasAttribute("data-install-pending")) {
            button.removeAttribute("data-install-pending");
            button.removeAttribute("aria-busy");
            button.classList.remove("b3-button--progress-text");
            button.style.removeProperty("--b3-progress");
            button.disabled = button.getAttribute("data-install-disabled") === "true";
            button.removeAttribute("data-install-disabled");
            button.textContent = window.siyuan.languages.download;
        }
        return;
    }
    if (!button.hasAttribute("data-install-pending")) {
        button.setAttribute("data-install-disabled", String(button.disabled));
    }
    button.setAttribute("data-install-pending", "true");
    button.setAttribute("aria-busy", "true");
    button.disabled = task.installing || task.controller.signal.aborted;
    button.classList.toggle("b3-button--progress-text", !button.disabled);
    button.style.setProperty("--b3-progress", `${task.percent}%`);
    button.textContent = button.disabled ? window.siyuan.languages.loading : `${window.siyuan.languages.cancel} ${task.percent}%`;
};

export const updateBazaarInstallProgress = (data: {id: string, percent: number}) => {
    let handled = false;
    installTasks.forEach(task => {
        if (task.repoURL !== data.id) {
            return;
        }
        handled = true;
        if (task.controller.signal.aborted || !Number.isFinite(data.percent)) {
            return;
        }
        task.percent = Math.max(task.percent, Math.floor(Math.max(0, Math.min(1, data.percent)) * 100));
        task.installing = task.percent === 100;
    });
    return handled;
};
