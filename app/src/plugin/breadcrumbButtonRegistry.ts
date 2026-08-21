export interface IBreadcrumbButtonOptions {
    id: string,
    icon: string,
    title: string,
    callback: (event: MouseEvent, protyle: IProtyle) => void,
}

export class BreadcrumbButtonRegistry {
    private plugins = new Map<string, Map<string, IBreadcrumbButtonOptions>>();

    public set(pluginName: string, options: IBreadcrumbButtonOptions) {
        let buttons = this.plugins.get(pluginName);
        if (!buttons) {
            buttons = new Map();
            this.plugins.set(pluginName, buttons);
        }
        const replaced = buttons.has(options.id);
        buttons.set(options.id, options);
        return replaced;
    }

    public get(pluginName: string, id: string) {
        return this.plugins.get(pluginName)?.get(id);
    }

    public remove(pluginName: string, id: string) {
        return this.plugins.get(pluginName)?.delete(id) || false;
    }

    public removePlugin(pluginName: string) {
        return this.plugins.delete(pluginName);
    }

    public getAll() {
        const result: Array<{ pluginName: string, options: IBreadcrumbButtonOptions }> = [];
        this.plugins.forEach((buttons, pluginName) => {
            buttons.forEach(options => {
                result.push({pluginName, options});
            });
        });
        return result;
    }

    public getNextPluginName(pluginName: string) {
        let found = false;
        for (const [currentPluginName, buttons] of this.plugins) {
            if (found && buttons.size > 0) {
                return currentPluginName;
            }
            if (currentPluginName === pluginName) {
                found = true;
            }
        }
    }
}
