import {CommandRegistry} from "./registry";

const registries = new WeakMap<object, CommandRegistry>();

export const getCommandRegistry = (app: object) => {
    let registry = registries.get(app);
    if (!registry) {
        registry = new CommandRegistry();
        registries.set(app, registry);
    }
    return registry;
};
