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

    public getData() {

    }

    public onload() {
        console.log("Hello, world!");
    }
}
