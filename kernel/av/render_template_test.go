// SiYuan - From thought to insight, with agents
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

package av

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestSuspendRenderedContents(t *testing.T) {
	storedValue := &Value{
		Type:            KeyTypeText,
		Text:            &ValueText{Content: "stored"},
		RenderedContent: "<strong>rendered</strong>",
	}
	nestedValue := &Value{Type: KeyTypeText, Text: &ValueText{Content: "nested"}, RenderedContent: "nested rendered"}
	storedValue.Relation = &ValueRelation{Contents: []*Value{nestedValue}}
	filterValue := &Value{Type: KeyTypeText, Text: &ValueText{Content: "filter"}, RenderedContent: "filter rendered"}
	attrView := &AttributeView{
		KeyValues: []*KeyValues{{Key: &Key{ID: "key", Type: KeyTypeText}, Values: []*Value{storedValue}}},
		Views: []*View{{
			Filters: []*ViewFilter{{Value: filterValue}},
		}},
	}

	valueJSON, err := json.Marshal(storedValue)
	if nil != err {
		t.Fatal(err)
	}
	if !bytes.Contains(valueJSON, []byte(`"renderedContent"`)) {
		t.Fatalf("runtime value does not expose rendered content: %s", valueJSON)
	}

	restore := attrView.suspendRenderedContents()
	data, err := json.Marshal(attrView)
	if nil != err {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("renderedContent")) {
		t.Fatalf("rendered content leaked into persisted attribute view: %s", data)
	}
	if "" != storedValue.RenderedContent || "" != nestedValue.RenderedContent || "" != filterValue.RenderedContent {
		t.Fatal("rendered content was not suspended from every persisted value")
	}

	restore()
	if "<strong>rendered</strong>" != storedValue.RenderedContent || "nested rendered" != nestedValue.RenderedContent ||
		"filter rendered" != filterValue.RenderedContent {
		t.Fatal("rendered content was not restored after serialization")
	}
}

func TestCloneStoredValueRemovesRenderedContents(t *testing.T) {
	value := &Value{
		Type:            KeyTypeRollup,
		RenderedContent: "outer",
		Rollup: &ValueRollup{Contents: []*Value{{
			Type: KeyTypeText, Text: &ValueText{Content: "stored"}, RenderedContent: "inner",
		}}},
	}

	cloned := CloneStoredValue(value)
	if nil == cloned || "" != cloned.RenderedContent || "" != cloned.Rollup.Contents[0].RenderedContent {
		t.Fatalf("rendered content leaked into stored clone: %+v", cloned)
	}
	if "outer" != value.RenderedContent || "inner" != value.Rollup.Contents[0].RenderedContent {
		t.Fatal("cloning a stored value changed the source")
	}
}
