export class MobileCustom {
    public element: Element;
    public data: any;
    public type: string;
    public init: (this: MobileCustom, custom: MobileCustom) => void;
    public destroy: (this: MobileCustom) => void;
    public update: (this: MobileCustom) => void;

    constructor(options: {
        element: Element,
        type: string,
        data: any,
        destroy?: (this: MobileCustom) => void,
        update?: (this: MobileCustom) => void,
        init: (this: MobileCustom, custom: MobileCustom) => void
    }) {
        this.element = options.element;
        this.data = options.data;
        this.type = options.type;
        this.init = options.init;
        this.destroy = options.destroy;
        this.update = options.update;
        this.element.innerHTML = "";
        this.init(this);
    }
}
