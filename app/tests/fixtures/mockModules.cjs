const createMockRequire = modules => name => {
    if (!Object.hasOwn(modules, name)) {
        throw new Error("Unexpected fixture module: " + name);
    }
    return modules[name];
};

module.exports = {createMockRequire};
