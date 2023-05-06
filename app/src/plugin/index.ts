import {App} from "../index";

export class Plugin {
    public i18n: IObject;

    constructor(options: {
        app: App,
        id: string,
        i18n: IObject
    }) {
        this.i18n = options.i18n;
    }

    public getData() {

    }

    public onload() {
        console.log("Hello, world!");
    }
}
