// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	emptyValue := &Value{Type: KeyTypeBlock, Block: &ValueBlock{Content: "original"}, HasRenderTemplate: true}
	storedValue.Relation = &ValueRelation{Contents: []*Value{nestedValue, emptyValue}}
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
	if bytes.Contains(data, []byte("renderedContent")) || bytes.Contains(data, []byte("hasRenderTemplate")) {
		t.Fatalf("rendered content leaked into persisted attribute view: %s", data)
	}
	if "" != storedValue.RenderedContent || "" != nestedValue.RenderedContent || "" != filterValue.RenderedContent {
		t.Fatal("rendered content was not suspended from every persisted value")
	}

	restore()
	if !emptyValue.HasRenderTemplate {
		t.Fatal("empty template result marker was not restored")
	}
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
			Type: KeyTypeText, Text: &ValueText{Content: "stored"}, RenderedContent: "inner", HasRenderTemplate: true,
		}}},
	}

	cloned := CloneStoredValue(value)
	if nil == cloned || "" != cloned.RenderedContent || "" != cloned.Rollup.Contents[0].RenderedContent ||
		cloned.Rollup.Contents[0].HasRenderTemplate {
		t.Fatalf("rendered content leaked into stored clone: %+v", cloned)
	}
	if "outer" != value.RenderedContent || "inner" != value.Rollup.Contents[0].RenderedContent {
		t.Fatal("cloning a stored value changed the source")
	}
}
