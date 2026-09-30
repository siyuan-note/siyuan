import {progressLoading} from "../../dialog/processSystem";

const tasks = new Set<string>();
let revision = 0;
let intercepting = false;
const intercept = (event: Event) => {
    if (!tasks.size) return;
    event.preventDefault();
    event.stopImmediatePropagation();
};

// 批量清理和导入期间覆盖当前前端，键盘操作也要遵守任务阻塞。
const applyTask = (data: {id: string; active: boolean; message: string}) => {
    if (data.active) tasks.add(data.id);
    else tasks.delete(data.id);
    if (!intercepting) {
        intercepting = true;
        ["keydown", "beforeinput", "paste", "drop", "click", "pointerdown"].forEach(type => {
            window.addEventListener(type, intercept, {capture: true});
        });
    }
    progressLoading({cmd: "progress", code: data.active ? 1 : 2, msg: data.message,
        data: {current: 1, total: 1}}, "setting-task-" + data.id);
};

export const applySettingTask = (data: {id: string; active: boolean; message: string; revision: number}) => {
    if (data.revision < revision) return;
    revision = data.revision;
    applyTask(data);
};

export const resetSettingTaskRevision = () => { revision = 0; };

export const syncSettingTasks = (snapshot?: {revision: number; tasks: Array<{id: string; active: boolean; message: string}>}) => {
    if ((snapshot?.revision || 0) < revision) return;
    revision = snapshot?.revision || 0;
    const current = new Set(snapshot?.tasks.map(task => task.id));
    for (const id of tasks) {
        if (!id.startsWith("native-") && !current.has(id)) applyTask({id, active: false, message: ""});
    }
    snapshot?.tasks.forEach(applyTask);
};

export const setNativeSettingTask = (id: string, active: boolean) => {
    applyTask({id, active, message: window.siyuan.languages.loading});
};

export const hasNativeSettingTasks = () => Array.from(tasks).some(id => id.startsWith("native-"));
