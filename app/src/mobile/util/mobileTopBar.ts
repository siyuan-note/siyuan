const MOBILE_TOP_BAR_ELEMENT_IDS = ["toolbarName", "toolbarNameReadonly", "toolbarSync"] as const;

let topBarElements: HTMLElement[];
let mergedBreadcrumbSpace: HTMLElement | undefined;

const getTopBarElements = () => {
    if (!topBarElements) {
        topBarElements = MOBILE_TOP_BAR_ELEMENT_IDS
            .map((id) => document.getElementById(id))
            .filter((element): element is HTMLElement => Boolean(element));
    }
    return topBarElements;
};

export const restoreMobileTopBarLayout = () => {
    const topBarElement = document.getElementById("mobileTopBar");
    if (!topBarElement) {
        return;
    }
    if (mergedBreadcrumbSpace) {
        mergedBreadcrumbSpace.classList.remove("protyle-breadcrumb__space--mobile-title");
        mergedBreadcrumbSpace = undefined;
    }
    getTopBarElements().forEach((element) => {
        if (element.parentElement !== topBarElement) {
            topBarElement.appendChild(element);
        }
    });
    document.body.classList.remove("mobile-topbar--merged");
};

export const updateMobileTopBarLayout = () => {
    const topBarElement = document.getElementById("mobileTopBar");
    const editorElement = document.getElementById("editor");
    if (!topBarElement || !editorElement) {
        return;
    }

    const breadcrumbSpace = editorElement.querySelector<HTMLElement>(".protyle-breadcrumb__space");
    const merged = window.matchMedia("(orientation: landscape)").matches &&
        !editorElement.classList.contains("fn__none") && Boolean(breadcrumbSpace);
    const targetElement = merged ? breadcrumbSpace : topBarElement;
    if (!targetElement) {
        return;
    }

    if (mergedBreadcrumbSpace && mergedBreadcrumbSpace !== targetElement) {
        mergedBreadcrumbSpace.classList.remove("protyle-breadcrumb__space--mobile-title");
        mergedBreadcrumbSpace = undefined;
    }
    getTopBarElements().forEach((element) => {
        if (element.parentElement !== targetElement) {
            targetElement.appendChild(element);
        }
    });
    if (merged && breadcrumbSpace) {
        breadcrumbSpace.classList.add("protyle-breadcrumb__space--mobile-title");
        mergedBreadcrumbSpace = breadcrumbSpace;
    }
    document.body.classList.toggle("mobile-topbar--merged", merged);
};
