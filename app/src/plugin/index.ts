import {App} from "../index";
import {EventBus} from "./EventBus";

export class Plugin {
    public i18n: IObject;
    public eventBus: EventBus;

    constructor(options: {
        app: App,
        id: string,
        name: string,
        i18n: IObject
    }) {
        this.i18n = options.i18n;
        this.eventBus = new EventBus(options.name);
    }

    public addTopBar(options: {
        icon: string,
        title: string,
        position: "right",
        callback: (evt: MouseEvent) => void
    }) {
        const iconElement = document.createElement("div");
        iconElement.className = "toolbar__item b3-tooltips b3-tooltips__sw";
        iconElement.setAttribute("aria-label", options.title);
        iconElement.setAttribute("data-menu", "true");
        iconElement.innerHTML = options.icon.startsWith("icon") ? `<svg><use xlink:href="#${options.icon}"></use></svg>` : options.icon;
        iconElement.addEventListener("click", options.callback);
        document.querySelector("#" + (options.position === "right" ? "barSearch" : "drag")).before(iconElement);
        return iconElement;
    }

    public onload() {
        console.log("Hello, world!");
    }
}
