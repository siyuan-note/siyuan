import type {WorkspaceStorageData} from "../../types/api";
import {fetchSyncPost} from "../../util/fetch";
import {loadECharts} from "../../protyle/util/echarts";
import {escapeHtml} from "../../util/escape";
import {genConfigItemMainHtml} from "../render/fragments";
import {genButtonHtml} from "../render/render";

const mountedStorage = new WeakMap<HTMLElement, () => void>();
const colorVariables = ["--b3-font-color6", "--b3-font-color4", "--b3-font-color2",
    "--b3-font-color9", "--b3-font-color10", "--b3-font-color5"];

export const formatStorageSize = (bytes: number) => {
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
    return `${(bytes / Math.pow(1024, index)).toLocaleString(undefined, {maximumFractionDigits: index === 0 ? 0 : 2})} ${units[index]}`;
};

export const genWorkspaceStorageHtml = () => `<div class="b3-label config-item workspace-storage">
    <div class="b3-label b3-label--inner fn__flex workspace-storage__header">
        ${genConfigItemMainHtml(window.siyuan.languages.workspaceStorage, window.siyuan.languages.workspaceStorageTip)}
        <span class="fn__space"></span>
        ${genButtonHtml("refreshWorkspaceStorage", window.siyuan.languages.refresh, "iconRefresh")}
        <div class="b3-label__text workspace-storage__time" data-storage-time></div>
    </div>
    <div class="b3-label__text" data-storage-status role="status"></div>
    <div class="workspace-storage__content fn__none" data-storage-content>
        <div class="workspace-storage__figure">
            <div class="workspace-storage__chart" data-storage-chart aria-hidden="true"></div>
            <div class="workspace-storage__total">
                <strong><bdi dir="ltr" data-storage-total></bdi></strong>
                <span class="ft__on-surface">${window.siyuan.languages.total}</span>
            </div>
        </div>
        <dl class="workspace-storage__details" data-storage-details></dl>
    </div>
    <div class="b3-label__text fn__none" data-storage-chart-error role="status"></div>
</div>`;

export const unmountWorkspaceStorage = (root: HTMLElement) => {
    mountedStorage.get(root)?.();
    mountedStorage.delete(root);
};

export const mountWorkspaceStorage = (root: HTMLElement) => {
    unmountWorkspaceStorage(root);
    const element = root.querySelector<HTMLElement>(".workspace-storage");
    if (!element) {
        return;
    }
    const refresh = element.querySelector<HTMLButtonElement>("#refreshWorkspaceStorage");
    const refreshIcon = refresh.querySelector("svg");
    const status = element.querySelector<HTMLElement>("[data-storage-status]");
    const content = element.querySelector<HTMLElement>("[data-storage-content]");
    const chartElement = element.querySelector<HTMLElement>("[data-storage-chart]");
    const chartError = element.querySelector<HTMLElement>("[data-storage-chart-error]");
    const total = element.querySelector<HTMLElement>("[data-storage-total]");
    const details = element.querySelector<HTMLElement>("[data-storage-details]");
    const time = element.querySelector<HTMLElement>("[data-storage-time]");
    let disposed = false;
    let pending = false;
    let chartLoading = false;
    let data: WorkspaceStorageData | undefined;
    let chart: ReturnType<typeof window.echarts.init> | undefined;
    const controller = new AbortController();
    const active = () => !disposed && element.isConnected;

    const renderChart = async () => {
        if (!active() || !data || chartLoading || chartElement.clientWidth === 0) {
            return;
        }
        chartLoading = true;
        try {
            if (!window.echarts) {
                await loadECharts();
            }
            if (!active()) {
                return;
            }
            if (!window.echarts) {
                throw new Error("ECharts unavailable");
            }
            const style = getComputedStyle(element);
            chart ??= window.echarts.init(chartElement, window.siyuan.config.appearance.mode === 1 ? "dark" : undefined);
            chart.resize();
            chart.setOption({
                backgroundColor: "transparent",
                animation: false,
                tooltip: {trigger: "item", renderMode: "richText", valueFormatter: formatStorageSize},
                series: [{
                    type: "pie",
                    radius: ["65%", "90%"],
                    label: {show: false},
                    labelLine: {show: false},
                    emptyCircleStyle: {color: style.getPropertyValue("--b3-theme-surface")},
                    data: data.directories.map((entry, index) => ({
                        name: entry.name === "other" ? window.siyuan.languages.workspaceStorageOther : entry.name,
                        value: entry.size,
                        itemStyle: {color: style.getPropertyValue(colorVariables[index])},
                    })).filter(entry => entry.value > 0),
                }],
            });
            chartError.classList.add("fn__none");
        } catch (error) {
            if (active()) {
                chartError.textContent = window.siyuan.languages.workspaceStorageChartFailed;
                chartError.classList.remove("fn__none");
            }
            console.warn("[config] workspace storage chart failed", error);
        } finally {
            chartLoading = false;
        }
    };

    const load = async () => {
        if (pending || disposed) {
            return;
        }
        pending = true;
        refresh.disabled = true;
        refreshIcon.classList.add("fn__rotate");
        status.textContent = "";
        status.classList.remove("ft__error");
        element.setAttribute("aria-busy", "true");
        try {
            const response = await fetchSyncPost("/api/system/getWorkspaceStorage", {}, undefined, false, controller.signal);
            if (!active()) {
                return;
            }
            if (response.code !== 0) {
                throw new Error(response.msg);
            }
            data = response.data;
            total.textContent = formatStorageSize(data.totalSize);
            total.title = `${data.totalSize.toLocaleString()} B`;
            details.innerHTML = data.directories.map((entry, index) => {
                if (entry.size === 0) {
                    return "";
                }
                const name = entry.name === "other" ? window.siyuan.languages.workspaceStorageOther : entry.name;
                const percent = data.totalSize > 0 ? entry.size / data.totalSize : 0;
                return `<div class="workspace-storage__row">
    <dt><span class="workspace-storage__color" style="background-color:var(${colorVariables[index]})"></span><span>${escapeHtml(name)}</span></dt>
    <dd title="${entry.size.toLocaleString()} B"><bdi dir="ltr">${formatStorageSize(entry.size)}</bdi></dd>
    <dd class="workspace-storage__percent ft__on-surface">${percent.toLocaleString(undefined, {style: "percent", maximumFractionDigits: 1})}</dd>
</div>${entry.name === "data" && data.assetsSize > 0 ? `<div class="workspace-storage__row workspace-storage__row--assets ft__on-surface">
    <dt>${escapeHtml(window.siyuan.languages.assets)}</dt>
    <dd title="${data.assetsSize.toLocaleString()} B"><bdi dir="ltr">${formatStorageSize(data.assetsSize)}</bdi></dd>
</div>` : ""}`;
            }).join("");
            time.textContent = `${window.siyuan.languages.updatedTime} ${new Date(data.calculatedAt).toLocaleString()}`;
            content.classList.remove("fn__none");
            status.textContent = "";
            void renderChart();
        } catch (error) {
            if (active()) {
                status.textContent = window.siyuan.languages.workspaceStorageFailed;
                status.classList.add("ft__error");
                console.warn("[config] workspace storage failed", error);
            }
        } finally {
            pending = false;
            refreshIcon.classList.remove("fn__rotate");
            if (active()) {
                refresh.disabled = false;
                element.setAttribute("aria-busy", "false");
            }
        }
    };

    const resizeObserver = new ResizeObserver(() => void renderChart());
    resizeObserver.observe(chartElement);
    const refreshTheme = () => {
        if (chart) {
            window.echarts.dispose(chartElement);
            chart = undefined;
        }
        void renderChart();
    };
    const themeObserver = new MutationObserver(refreshTheme);
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme-mode", "data-light-theme", "data-dark-theme", "style"],
    });
    let themeFrame = 0;
    const onStyleLoad = (event: Event) => {
        if (event.target instanceof HTMLLinkElement && event.target.rel === "stylesheet") {
            // 主题属性先更新，样式表随后加载；等待旧样式表移除后重新读取主题颜色。
            cancelAnimationFrame(themeFrame);
            themeFrame = requestAnimationFrame(refreshTheme);
        }
    };
    document.addEventListener("load", onStyleLoad, true);
    refresh.addEventListener("click", load);
    mountedStorage.set(root, () => {
        disposed = true;
        controller.abort();
        resizeObserver.disconnect();
        themeObserver.disconnect();
        document.removeEventListener("load", onStyleLoad, true);
        cancelAnimationFrame(themeFrame);
        refresh.removeEventListener("click", load);
        if (chart) {
            window.echarts.dispose(chartElement);
        }
    });
    void load();
};
