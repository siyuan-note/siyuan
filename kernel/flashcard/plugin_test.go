// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
