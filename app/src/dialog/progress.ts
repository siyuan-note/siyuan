export const getProgressContentHTML = () => `<div class="b3-dialog__progress-label"></div>
<div class="b3-dialog__progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="b3-dialog__progressbar"></div></div>
<div data-type="message" class="ft__breakword" role="status"></div>`;

export const updateProgressContent = (element: Element, message: string, current?: number, total?: number,
                                      label: "count" | "percent" = "count") => {
    const safeCurrent = Number.isFinite(Number(current)) ? Math.max(0, Number(current)) : 0;
    const safeTotal = Number(total);
    const determinate = Number.isFinite(safeTotal) && safeTotal > 0;
    const percent = determinate ? Math.max(0, Math.min(100, safeCurrent / safeTotal * 100)) : 0;
    const counter = element.querySelector(".b3-dialog__progress-label");
    counter.classList.toggle("fn__none", !determinate);
    counter.textContent = determinate ? label === "percent" ? `${Math.floor(percent)}%` : `${safeCurrent}/${safeTotal}` : "";
    const progress = element.querySelector<HTMLElement>(".b3-dialog__progress");
    progress.classList.toggle("b3-dialog__progress--indeterminate", !determinate);
    if (determinate) progress.setAttribute("aria-valuenow", String(percent));
    else progress.removeAttribute("aria-valuenow");
    progress.querySelector<HTMLElement>(".b3-dialog__progressbar").style.width = determinate ? `${percent}%` : "100%";
    element.querySelector('[data-type="message"]').textContent = message;
};

export const progressLoading = (data: IWebSocketData, id = "progress", action?: {label: string, callback: () => void}) => {
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
        progressElement.innerHTML = `<div class="b3-dialog__scrim b3-dialog__scrim--progress" style="opacity: 1"></div>
<div class="b3-dialog__loading">${getProgressContentHTML()}</div>`;
        updateProgressContent(progressElement.lastElementChild, data.msg, data.data.current, data.data.total);
    } else if (data.code === 1) {
        if (progressElement.lastElementChild) {
            progressElement.querySelector('[data-type="message"]').textContent = data.msg;
        } else {
            progressElement.innerHTML = `<div class="b3-dialog__scrim b3-dialog__scrim--progress" style="opacity: 1"></div>
<div class="b3-dialog__loading">${getProgressContentHTML()}</div>`;
            updateProgressContent(progressElement.lastElementChild, data.msg);
        }
    }
    if (action && !progressElement.querySelector("button")) {
        const footer = document.createElement("div");
        footer.className = "b3-dialog__action";
        const button = document.createElement("button");
        button.className = "b3-button b3-button--text b3-button--wrap";
        button.textContent = action.label;
        button.addEventListener("click", action.callback);
        footer.appendChild(button);
        progressElement.lastElementChild.appendChild(footer);
        button.focus({preventScroll: true});
    }
};
