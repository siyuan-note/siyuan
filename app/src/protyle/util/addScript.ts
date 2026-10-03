const pendingScripts = new Map<string, {promise: Promise<boolean>; reloadOnFailure: boolean}>();

export const addScriptSync = async (path: string, id: string, options: {reloadOnFailure?: boolean} = {}) => {
    if (pendingScripts.has(id)) {
        const pending = pendingScripts.get(id);
        if (options.reloadOnFailure === false) {
            pending.reloadOnFailure = false;
        }
        return pending.promise;
    }
    if (document.getElementById(id)) {
        return false;
    }
    const pending = {promise: undefined as Promise<boolean>, reloadOnFailure: options.reloadOnFailure !== false};
    pending.promise = new Promise<boolean>((resolve) => {
        const scriptElement = document.createElement("script");
        scriptElement.type = "text/javascript";
        scriptElement.src = path;
        scriptElement.async = false;
        scriptElement.id = id;
        scriptElement.onload = () => {
            pendingScripts.delete(id);
            if (id === "protyleLuteScript" && typeof Lute === "undefined") {
                if (!pending.reloadOnFailure) {
                    scriptElement.remove();
                    resolve(false);
                    return;
                }
                // 鸿蒙系统上首次加载可能没有初始化 Lute，重新载入页面恢复编辑器。
                window.location.reload();
            }
            resolve(true);
        };
        scriptElement.onerror = () => {
            pendingScripts.delete(id);
            scriptElement.remove();
            resolve(false);
        };
        document.head.appendChild(scriptElement);
    });
    pendingScripts.set(id, pending);
    return pending.promise;
};

export const addScript = (path: string, id: string) => {
    return new Promise((resolve) => {
        if (document.getElementById(id)) {
            // 脚本加载后再次调用直接返回
            resolve(false);
            return false;
        }
        const scriptElement = document.createElement("script");
        scriptElement.src = path;
        scriptElement.async = true;
        // 循环调用时 Chrome 不会重复请求 js
        document.head.appendChild(scriptElement);
        scriptElement.onload = () => {
            if (document.getElementById(id)) {
                // 循环调用需清除 DOM 中的 script 标签
                scriptElement.remove();
                resolve(false);
                return false;
            }
            scriptElement.id = id;
            resolve(true);
        };
        scriptElement.onerror = () => {
            scriptElement.remove();
            resolve(false);
        };
    });
};
