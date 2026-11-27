// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"encoding/json"
	"testing"
)

func TestPluginCardSourceRequiresNamespacedVersionedFallback(t *testing.T) {
	source := CardSource{ID: "plugin-source", SchemaID: "plugin-schema",
		SourceType: "plugin:example:diagram", PrimaryRefID: "primary", GenerationConfig: json.RawMessage(`{}`),
		Status: "active", PluginNamespace: "example", PluginDataVersion: 1,
		PluginData: json.RawMessage(`{"textFallback":"Diagram question","value":{"node":"a"}}`)}
	if _, err := NewOperationEntityRevision("plugin-source-valid", EntityCardSource, source.ID, nil, 1, false,
		source); err != nil {
		t.Fatal(err)
	}

	missingFallback := source
	missingFallback.PluginData = json.RawMessage(`{"value":{}}`)
	if _, err := NewOperationEntityRevision("plugin-source-missing-fallback", EntityCardSource, source.ID, nil, 1,
		false, missingFallback); err == nil {
		t.Fatal("plugin source without a text fallback was accepted")
	}

	wrongNamespace := source
	wrongNamespace.PluginNamespace = "another"
	if _, err := NewOperationEntityRevision("plugin-source-wrong-namespace", EntityCardSource, source.ID, nil, 1,
		false, wrongNamespace); err == nil {
		t.Fatal("plugin source with a mismatched namespace was accepted")
	}
}
