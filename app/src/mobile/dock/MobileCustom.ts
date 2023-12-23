export class MobileCustom {
    public element: Element;
    public data: any;
    public type: string;
    public init: (custom: MobileCustom) => void;
    public destroy: () => void;
    public update: () => void;

    constructor(options: {
        element: Element,
        type: string,
        data: any,
        destroy?: () => void,
        update?: () => void,
        init: (custom: MobileCustom) => void
    }) {
        this.element = options.element;
        this.data = options.data;
        this.type = options.type;
        this.init = options.init;
        this.destroy = options.destroy;
        this.update = options.update;
        this.init(this);
    }
}
