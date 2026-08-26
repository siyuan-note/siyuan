import {BreadcrumbButtonRegistry, type IBreadcrumbButtonOptions} from "./breadcrumbButtonRegistry";

const registry = new BreadcrumbButtonRegistry();
const breadcrumbElements = new Map<IProtyle, HTMLElement>();

const getDataID = (pluginName: string, id: string) => {
    return `${encodeURIComponent(pluginName)}:${encodeURIComponent(id)}`;
};

const findButton = (element: HTMLElement, pluginName: string, id: string) => {
    const dataID = getDataID(pluginName, id);
    return Array.from(element.children).find(item => item.getAttribute("data-id") === dataID) as HTMLButtonElement;
};

const updateButton = (button: HTMLButtonElement, pluginName: string, options: IBreadcrumbButtonOptions,
                      protyle: IProtyle) => {
    button.className = "block__icon fn__flex-center ariaLabel";
    button.setAttribute("aria-label", options.title);
    button.setAttribute("data-id", getDataID(pluginName, options.id));
    button.setAttribute("data-plugin-name", pluginName);
    button.type = "button";
    button.innerHTML = options.icon.startsWith("icon") ?
        `<svg><use xlink:href="#${options.icon}"></use></svg>` : options.icon;
    button.onclick = (event) => {
        options.callback(event, protyle);
    };
};

const insertButton = (element: HTMLElement, pluginName: string, options: IBreadcrumbButtonOptions,
                      protyle: IProtyle) => {
    const button = document.createElement("button");
    updateButton(button, pluginName, options, protyle);
    const nextPluginName = registry.getNextPluginName(pluginName);
    const nextPluginButton = nextPluginName ? Array.from(element.children).find(item =>
        item.getAttribute("data-plugin-name") === nextPluginName) : undefined;
    element.insertBefore(button, nextPluginButton || null);
};

export const mountBreadcrumbButtons = (protyle: IProtyle, element: HTMLElement) => {
    breadcrumbElements.set(protyle, element);
    registry.getAll().forEach(item => {
        insertButton(element, item.pluginName, item.options, protyle);
    });
};

export const unmountBreadcrumbButtons = (protyle: IProtyle) => {
    breadcrumbElements.delete(protyle);
};

export const addBreadcrumbButton = (pluginName: string, options: IBreadcrumbButtonOptions) => {
    const replaced = registry.set(pluginName, options);
    breadcrumbElements.forEach((element, protyle) => {
        const button = replaced ? findButton(element, pluginName, options.id) : undefined;
        if (button) {
            updateButton(button, pluginName, options, protyle);
        } else {
            insertButton(element, pluginName, options, protyle);
        }
    });
};

export const removeBreadcrumbButton = (pluginName: string, id: string) => {
    if (!registry.remove(pluginName, id)) {
        return;
    }
    breadcrumbElements.forEach(element => {
        findButton(element, pluginName, id)?.remove();
    });
};

export const removeBreadcrumbButtons = (pluginName: string) => {
    registry.removePlugin(pluginName);
    breadcrumbElements.forEach(element => {
        Array.from(element.children).forEach(item => {
            if (item.getAttribute("data-plugin-name") === pluginName) {
                item.remove();
            }
        });
    });
};
