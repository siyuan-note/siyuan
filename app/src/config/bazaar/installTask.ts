interface IBazaarInstallTask {
    controller: AbortController;
    repoURL: string;
    percent: number;
    installing: boolean;
    batch?: boolean;
}

interface IBazaarBatchUpdate {
    controller: AbortController;
    tasks: IBazaarInstallTask[];
}

let batchUpdate: IBazaarBatchUpdate;
// 按包保留安装状态，切换详情或重新挂载集市时仍能阻止重复请求。
const installTasks = new Map<string, IBazaarInstallTask>();
const buttonsWithTooltip = new WeakSet<HTMLElement>();
const taskKey = (type: TBazaarType, name: string) => `${type}/${name}`;

export const getBazaarInstallTask = (type: TBazaarType, name: string) => installTasks.get(taskKey(type, name));

export const beginBazaarInstall = (type: TBazaarType, name: string, repoURL: string) => {
    const key = taskKey(type, name);
    if (installTasks.has(key) || batchUpdate) {
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
    if (task && !task.installing && !task.batch) {
        task.controller.abort();
    }
};

export const getBazaarBatchUpdate = () => batchUpdate;

export const beginBazaarBatchUpdate = (packages: Array<{type: TBazaarType, item: IUpdatedBazaarItem}>) => {
    if (batchUpdate || installTasks.size > 0 || packages.length === 0) {
        return;
    }
    const controller = new AbortController();
    const tasks = packages.filter(({item}) => !item.available.disallowUpdate).map(({type, item}) => {
        const task: IBazaarInstallTask = {controller, repoURL: item.available.repoURL, percent: 0,
            installing: false, batch: true};
        installTasks.set(taskKey(type, item.installed.name), task);
        return task;
    });
    if (tasks.length === 0) {
        return;
    }
    batchUpdate = {controller, tasks};
    return batchUpdate;
};

export const cancelBazaarBatchUpdate = () => batchUpdate?.controller.abort();

export const finishBazaarBatchUpdate = (batch: IBazaarBatchUpdate) => {
    if (batchUpdate !== batch) {
        return;
    }
    installTasks.forEach((task, key) => {
        if (task.controller === batch.controller) {
            installTasks.delete(key);
        }
    });
    batchUpdate = undefined;
};

const restoreButton = (button: HTMLElement) => {
    if (!button.hasAttribute("data-install-pending")) {
        return;
    }
    if (button.hasAttribute("data-install-original")) {
        button.outerHTML = button.getAttribute("data-install-original");
        return;
    }
    button.innerHTML = button.getAttribute("data-install-label");
    button.toggleAttribute("disabled", button.getAttribute("data-install-disabled") === "true");
    const ariaLabel = button.getAttribute("data-install-aria-label");
    if (ariaLabel) {
        button.setAttribute("aria-label", ariaLabel);
    } else {
        button.removeAttribute("aria-label");
    }
    ["data-install-pending", "data-install-label", "data-install-disabled", "data-install-aria-label", "aria-busy"]
        .forEach(name => button.removeAttribute(name));
    button.classList.remove("b3-button--progress-text");
    button.classList.toggle("ariaLabel", buttonsWithTooltip.has(button));
    buttonsWithTooltip.delete(button);
    button.style.removeProperty("--b3-progress");
};

const prepareButton = (element: HTMLElement) => {
    let button = element;
    if (button.tagName !== "BUTTON") {
        const original = button.outerHTML;
        const replacement = document.createElement("button");
        replacement.className = "b3-button";
        ["fn__hidden", "fn__none"].forEach(name => replacement.classList.toggle(name, button.classList.contains(name)));
        replacement.setAttribute("data-type", button.getAttribute("data-type"));
        replacement.setAttribute("data-install-original", original);
        button.replaceWith(replacement);
        button = replacement;
    }
    if (!button.hasAttribute("data-install-pending")) {
        if (button.classList.contains("ariaLabel")) {
            buttonsWithTooltip.add(button);
        }
        button.setAttribute("data-install-disabled", String(button.hasAttribute("disabled")));
        button.setAttribute("data-install-label", button.innerHTML);
        button.setAttribute("data-install-aria-label", button.getAttribute("aria-label") || "");
    }
    button.setAttribute("data-install-pending", "true");
    button.classList.remove("ariaLabel");
    button.setAttribute("aria-busy", "true");
    return button;
};

export const renderBazaarInstall = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>('[data-type="install"], [data-type="install-t"]').forEach(element => {
        const owner = element.closest("[data-name][data-package-type]");
        const task = owner && installTasks.get(`${owner.getAttribute("data-package-type")}/${owner.getAttribute("data-name")}`);
        if (!task && !batchUpdate) {
            restoreButton(element);
            return;
        }
        const button = prepareButton(element);
        const disabled = !task || task.batch || task.installing || task.controller.signal.aborted;
        button.toggleAttribute("disabled", disabled);
        button.classList.toggle("b3-button--progress-text", !disabled);
        button.style.setProperty("--b3-progress", `${task?.percent || 0}%`);
        button.textContent = task?.controller.signal.aborted ? window.siyuan.languages.cancel : disabled ?
            window.siyuan.languages.bazaarInstalling : `${window.siyuan.languages.cancel} ${task.percent}%`;
        button.setAttribute("aria-label", button.textContent);
    });
    root.querySelectorAll<HTMLElement>('[data-type="install-all"]').forEach(element => {
        if (!batchUpdate) {
            restoreButton(element);
            element.toggleAttribute("disabled", installTasks.size > 0);
            const updateTab = element.closest(".config-bazaar__title")?.querySelector('[data-type="myUpdate"]');
            if (updateTab?.classList.contains("b3-button--outline")) {
                element.classList.add("fn__none");
            }
            return;
        }
        const button = prepareButton(element);
        button.classList.remove("fn__none");
        button.toggleAttribute("disabled", batchUpdate.controller.signal.aborted);
        const percent = Math.floor(batchUpdate.tasks.reduce((total, task) => total + task.percent, 0) / batchUpdate.tasks.length);
        button.classList.add("b3-button--progress-text");
        button.style.setProperty("--b3-progress", `${percent}%`);
        button.textContent = `${window.siyuan.languages.cancel} ${percent}%`;
        button.setAttribute("aria-label", button.textContent);
    });
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
