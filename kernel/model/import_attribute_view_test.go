package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestIsolateImportedAttributeViewBindings(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, false)
	externalID := fixture.tree.Root.ID
	internalID := ast.NewNodeID()
	data := []byte(`{"spec":8,"extra":9007199254740993,"keyValues":[{"key":{"type":"block"},"values":[` +
		`{"id":"value-external","blockID":"row-external","block":{"id":"` + externalID + `","content":"External title","icon":"icon","refSubtype":"s","extra":9007199254740993}},` +
		`{"id":"value-internal","blockID":"row-internal","block":{"id":"` + internalID + `","content":"Internal title"}},` +
		`{"id":"value-detached","blockID":"row-detached","isDetached":true,"block":{"content":"Detached title"}}]},` +
		`{"key":{"type":"number"},"values":[{"blockID":"row-external","number":{"content":123}}]}],"views":[{"itemIds":["row-external","row-internal","row-detached"]}]}`)

	for _, encrypted := range []bool{false, true} {
		got, err := isolateImportedAttributeViewBindings(data, map[string]bool{internalID: true}, encrypted)
		if err != nil {
			t.Fatal(err)
		}
		if !encrypted && !bytes.Equal(data, got) {
			t.Fatal("ordinary external bindings should remain byte-for-byte unchanged")
		}
		var parsed av.AttributeView
		if err = json.Unmarshal(got, &parsed); err != nil {
			t.Fatal(err)
		}
		values := parsed.GetBlockKeyValues().Values
		if values[0].IsDetached != encrypted || (encrypted && values[0].Block.ID != "") {
			t.Fatalf("external binding was not isolated: %+v", values[0])
		}
		if values[0].Block.Content != "External title" || values[0].Block.Icon != "icon" || values[0].BlockID != "row-external" {
			t.Fatal("detaching lost row identity or content")
		}
		if values[1].IsDetached || values[1].Block.ID != internalID || !values[2].IsDetached {
			t.Fatal("internal or detached row was changed")
		}
		if !bytes.Contains(got, []byte(`"extra":9007199254740993`)) || parsed.Spec != 8 || parsed.KeyValues[1].Values[0].Number.Content != 123 {
			t.Fatal("unrelated fields or storage format changed")
		}
	}

	missingID := ast.NewNodeID()
	missing := bytes.ReplaceAll(data, []byte(externalID), []byte(missingID))
	got, err := isolateImportedAttributeViewBindings(missing, map[string]bool{internalID: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(got, []byte(missingID)) {
		t.Fatal("unresolvable external binding survived import")
	}
	if _, err = isolateImportedAttributeViewBindings([]byte(`{"keyValues":`), nil, true); err == nil {
		t.Fatal("invalid source data was accepted")
	}
	if _, err = isolateImportedAttributeViewBindings(bytes.Replace(data, []byte(`"spec":8`), []byte(`"spec":999`), 1), nil, true); !errors.Is(err, av.ErrSpecTooNew) {
		t.Fatalf("unsupported source format was accepted: %v", err)
	}
}

func TestRetainImportedAttributeViewBindings(t *testing.T) {
	node := treenode.NewParagraph("")
	node.SetIALAttr(av.NodeAttrNameAvs, "external,new-a,new-b")
	node.SetIALAttr(av.NodeAttrViewNames, "External, A, B")
	node.SetIALAttr(av.NodeAttrViewStaticText+"-external", "External text")
	node.SetIALAttr(av.NodeAttrViewStaticText+"-new-a", "Internal text")
	retainImportedAttributeViewBindings(node, map[string]string{"old-a": "new-a", "old-b": "new-b"})
	if node.IALAttr(av.NodeAttrNameAvs) != "new-a,new-b" || node.IALAttr(av.NodeAttrViewNames) != "" ||
		node.IALAttr(av.NodeAttrViewStaticText+"-external") != "" || node.IALAttr(av.NodeAttrViewStaticText+"-new-a") != "Internal text" {
		t.Fatalf("unexpected imported attributes: %v", node.KramdownIAL)
	}
}
