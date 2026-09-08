import type {
    ICommandContextSnapshot,
    ICommandDefinition,
    ICommandExecutionResult,
} from "./types";

interface ICommandEntry {
    command: ICommandDefinition;
    owner: object | string | symbol;
    sequence: number;
}

const isAvailable = (command: ICommandDefinition, context: ICommandContextSnapshot) => {
    if (command.surfaces && !command.surfaces.includes(context.source)) {
        return false;
    }
    if (command.platform && !command.platform(context.environment)) {
        return false;
    }
    return !command.when || command.when(context);
};

export class CommandRegistry {
    private readonly entries = new Map<string, ICommandEntry>();
    private sequence = 0;

    public register(command: ICommandDefinition, owner: object | string | symbol) {
        if (!command.id || command.id !== command.id.trim()) {
            throw new Error("Command ID must be a non-empty trimmed string");
        }
        if (this.entries.has(command.id)) {
            throw new Error(`Command ID "${command.id}" is already registered`);
        }
        const id = command.id;
        const entry: ICommandEntry = {
            command: Object.freeze({...command}),
            owner,
            sequence: this.sequence++,
        };
        this.entries.set(id, entry);
        let disposed = false;
        return () => {
            if (disposed) {
                return false;
            }
            disposed = true;
            if (this.entries.get(id) !== entry) {
                return false;
            }
            this.entries.delete(id);
            return true;
        };
    }

    public unregisterOwner(owner: object | string | symbol) {
        let count = 0;
        this.entries.forEach((entry, id) => {
            if (entry.owner === owner) {
                this.entries.delete(id);
                count++;
            }
        });
        return count;
    }

    public get(id: string) {
        return this.entries.get(id)?.command;
    }

    public list(context: ICommandContextSnapshot) {
        return Array.from(this.entries.values())
            .filter(entry => {
                try {
                    return isAvailable(entry.command, context);
                } catch (error) {
                    console.error(`Command "${entry.command.id}" availability check failed:`, error);
                    return false;
                }
            })
            .sort((first, second) => {
                const order = (first.command.order ?? 0) - (second.command.order ?? 0);
                return order || first.sequence - second.sequence;
            })
            .map(entry => entry.command);
    }

    public async execute(id: string, context: ICommandContextSnapshot, args?: unknown): Promise<ICommandExecutionResult> {
        const prepared = this.prepare(id, context, args);
        return prepared.run ? prepared.run() : prepared.result;
    }

    public prepare(id: string, context: ICommandContextSnapshot, args?: unknown): {
        result: ICommandExecutionResult;
        run?: () => Promise<ICommandExecutionResult>;
    } {
        const command = this.get(id);
        if (!command) {
            return {result: {status: "notFound"}};
        }
        if (!isAvailable(command, context)) {
            return {result: {status: "unavailable", command}};
        }
        if (command.enabled && !command.enabled(context)) {
            return {result: {status: "disabled", command}};
        }
        return {
            result: {status: "executed", command},
            run: async () => ({status: "executed", command, value: await command.execute(context, args)}),
        };
    }
}
