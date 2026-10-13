import {escapeHtml} from "../util/escape";

export const progressLoading = (data: IWebSocketData, id = "progress") => {
    let progressElement = document.getElementById(id);
    // 关闭时只移除对应任务的遮罩。
    if (data.code === 2) {
        progressElement?.remove();
        return;
    }
    if (!progressElement) {
        progressElement = document.createElement("div");
        progressElement.id = id;
        progressElement.style.zIndex = String(++window.siyuan.zIndex);
        document.body.appendChild(progressElement);
    }
    // code 0: 有进度；1: 无进度；2: 关闭
    if (data.code === 0) {
        const current = Number(data.data.current);
        const total = Number(data.data.total);
        const safeCurrent = Number.isFinite(current) ? current : 0;
        const safeTotal = Number.isFinite(total) && total > 0 ? total : 1;
        progressElement.innerHTML = `<div class="b3-dialog__scrim" style="opacity: 1"></div>
<div class="b3-dialog__loading">
    <div style="text-align: right">${safeCurrent}/${safeTotal}</div>
    <div style="margin: 8px 0;height: 8px;border-radius: var(--b3-border-radius);overflow: hidden;background-color:#fff;"><div style="width: ${safeCurrent / safeTotal * 100}%;transition: var(--b3-transition);background-color: var(--b3-theme-primary);height: 8px;"></div></div>
    <div class="ft__breakword">${escapeHtml(data.msg)}</div>
</div>`;
    } else if (data.code === 1) {
        if (progressElement.lastElementChild) {
            progressElement.lastElementChild.lastElementChild.innerHTML = escapeHtml(data.msg);
        } else {
            progressElement.innerHTML = `<div class="b3-dialog__scrim" style="opacity: 1"></div>
<div class="b3-dialog__loading">
    <div style="margin: 8px 0;height: 8px;border-radius: var(--b3-border-radius);overflow: hidden;background-color:#fff;"><div style="background-color: var(--b3-theme-primary);height: 8px;background-image: linear-gradient(-45deg, rgba(255, 255, 255, 0.2) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.2) 50%, rgba(255, 255, 255, 0.2) 75%, transparent 75%, transparent);animation: stripMove 450ms linear infinite;background-size: 50px 50px;"></div></div>
    <div class="ft__breakword">${escapeHtml(data.msg)}</div>
</div>`;
        }
    }
};
