import * as assert from "node:assert/strict";
import test from "node:test";
import {getAgentDefaultModelID, getUsableAgentModels} from "./agentModel";

const config = {
    providers: [
        {
            enabled: false,
            models: [{id: "disabled-provider", enabled: true, name: "Disabled provider model"}],
        },
        {
            enabled: true,
            models: [
                {id: "disabled-model", enabled: false, name: "Disabled model"},
                {id: "first", enabled: true, name: "first-model", displayName: "First"},
                {id: "second", enabled: true, name: "second-model", displayName: "Second"},
            ],
        },
    ],
    agent: {modelId: "second"},
};

test("agent models include enabled models from enabled providers", () => {
    assert.deepEqual(getUsableAgentModels(config), [
        {id: "first", name: "First"},
        {id: "second", name: "Second"},
    ]);
});

test("agent default model uses the configured model", () => {
    const options = getUsableAgentModels(config);
    assert.equal(getAgentDefaultModelID(config, options), "second");
});

test("agent default model falls back to the first usable model", () => {
    const options = getUsableAgentModels(config);
    assert.equal(getAgentDefaultModelID({...config, agent: {modelId: "missing"}}, options), "first");
    assert.equal(getAgentDefaultModelID({...config, providers: []}, []), "");
});
