import {App} from "../index";
import {EventBus} from "./EventBus";
import {fetchPost} from "../util/fetch";

export class Plugin {
    public i18n: IObject;
    public eventBus: EventBus;
    public data: any = {};
    public name: string;

    constructor(options: {
        app: App,
        name: string,
        i18n: IObject
    }) {
        this.i18n = options.i18n;
        this.name = options.name;
        this.eventBus = new EventBus(options.name);
    }

    public onload() {
    }

    public addTopBar(options: {
        icon: string,
        title: string,
        position?: "right",
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

    public openSetting() {
    }

    public loadData(storageName: string) {
        if (typeof this.data[storageName] === "undefined") {
            this.data[storageName] = "";
        }
        return new Promise((resolve) => {
            fetchPost("/api/file/getFile", {path: `/data/storage/petal/${this.name}/${storageName}`}, (response) => {
                if (response.code === 404) {
                    this.data[storageName] = "";
                } else {
                    this.data[storageName] = response;
                }
                resolve(this.data[storageName]);
            });
        });
    }

    public saveData(storageName: string, data: any) {
        return new Promise((resolve) => {
            const pathString = `/data/storage/petal/${this.name}/${storageName}`;
            const file = new File([new Blob([data])], pathString.split('/').pop());
            const formData = new FormData();
            formData.append('path', pathString);
            formData.append('file', file);
            formData.append('isDir', "false");
            fetchPost("/api/file/putFile", formData, (response) => {
                resolve(response);
            });
        });
    }
}
