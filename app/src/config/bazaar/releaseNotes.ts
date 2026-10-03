import {Dialog} from "../../dialog";
import {highlightRender} from "../../protyle/render/highlightRender";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {fetchPost} from "../../util/fetch";
import {isMobile} from "../../util/functions";
import {BAZAAR_README_SANITIZE_OPTIONS} from "../bazaarReadmeSanitize";

interface IBazaarRelease {
    tag: string;
    publishedAt: string;
    html: string;
}

const CLASS = "bazaar-release-notes";

/** 同一时刻只留一个发行说明弹窗：连着点两次不该叠出两个。 */
let currentDialog: Dialog | undefined;

/** 两个版本号是不是同一个：集市里显示的是 v + 清单版本号，tag 可能带 v 也可能不带。 */
export const matchReleaseVersion = (tag: string, version: string): boolean =>
    tag.replace(/^v/i, "") === version.replace(/^v/i, "");

/** 下拉项的文案：列表已按发布时间倒序，第一条就是最新版。 */
export const formatReleaseOption = (release: IBazaarRelease, latestTag: string): string =>
    release.tag === latestTag ?
        `${release.tag} (${window.siyuan.languages.bazaarReleaseNotesLatest})` :
        release.tag;

const renderRelease = (container: HTMLElement, releases: IBazaarRelease[], tag: string) => {
    const release = releases.find((item) => matchReleaseVersion(item.tag, tag)) || releases[0];
    if (!release.html) {
        container.textContent = window.siyuan.languages.bazaarReleaseNotesEmpty;
        return;
    }
    container.innerHTML = window.DOMPurify.sanitize(release.html, BAZAAR_README_SANITIZE_OPTIONS);
    highlightRender(container);
};

/**
 * 打开发行说明弹窗：顶部是历史版本下拉，正文是选中版本的发行说明。
 * 发行说明由内核用 Lute 渲染（与集市 README 同一条路），这里只负责消毒、注入与代码高亮。
 */
export const openReleaseNotesDialog = (repoURL: string, version: string) => {
    currentDialog?.destroy();
    let destroyed = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.changelog,
        width: isMobile() ? "92vw" : "600px",
        containerClassName: CLASS,
        content: `<label class="${CLASS}__head fn__none"></label>
<div class="${CLASS}__body b3-typography">${window.siyuan.languages.loading}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" id="releaseNotesCloseBtn">${window.siyuan.languages.close}</button>
</div>`,
        destroyCallback: () => {
            destroyed = true;
            if (currentDialog === dialog) {
                currentDialog = undefined;
            }
        },
    });
    currentDialog = dialog;
    const closeButton = dialog.element.querySelector("#releaseNotesCloseBtn") as HTMLButtonElement;
    closeButton.addEventListener("click", () => {
        dialog.destroy();
    });

    const headElement = dialog.element.querySelector(`.${CLASS}__head`) as HTMLElement;
    const bodyElement = dialog.element.querySelector(`.${CLASS}__body`) as HTMLElement;
    fetchPost("/api/bazaar/getBazaarPackageReleases", {repoURL}, (response) => {
        // 窗口可能已经关掉，响应回来时不要再动 DOM
        if (destroyed) {
            return;
        }
        const releases: IBazaarRelease[] = response.code === 0 && response.data?.releases ? response.data.releases : [];
        if (releases.length === 0) {
            bodyElement.textContent = window.siyuan.languages.bazaarReleaseNotesUnavailable;
            return;
        }

        const latestTag = releases[0].tag;
        headElement.innerHTML = `<span class="${CLASS}__label">${window.siyuan.languages.version}</span>
<select class="b3-select ${CLASS}__select">${
            releases.map((release) =>
                `<option value="${escapeAttr(release.tag)}"${
                    matchReleaseVersion(release.tag, version) ? " selected" : ""
                }>${escapeHtml(formatReleaseOption(release, latestTag))}</option>`
            ).join("")
        }</select>`;
        headElement.classList.remove("fn__none");

        const selectElement = headElement.querySelector("select") as HTMLSelectElement;
        selectElement.addEventListener("change", () => renderRelease(bodyElement, releases, selectElement.value));
        renderRelease(bodyElement, releases, selectElement.value);
    });
};
