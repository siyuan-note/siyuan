package model

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAIMemoryNativeEvidenceOnlySourceRows(t *testing.T) {
	database := &av.AttributeView{ID: "database", Name: "project", KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "title", Name: "Title", Type: av.KeyTypeBlock}, Values: []*av.Value{
			{Type: av.KeyTypeBlock, BlockID: "row1", Block: &av.ValueBlock{ID: "source", Content: "allowed"}},
			{Type: av.KeyTypeBlock, BlockID: "row2", Block: &av.ValueBlock{ID: "other-box", Content: "SECRET"}},
		}},
		{Key: &av.Key{ID: "amount", Name: "Amount", Type: av.KeyTypeNumber}, Values: []*av.Value{
			{Type: av.KeyTypeNumber, BlockID: "row1", Number: &av.ValueNumber{Content: 42}},
			{Type: av.KeyTypeNumber, BlockID: "row2", Number: &av.ValueNumber{Content: 999}},
		}},
		{Key: &av.Key{ID: "relation", Name: "Relation", Type: av.KeyTypeRelation}, Values: []*av.Value{
			{Type: av.KeyTypeRelation, BlockID: "row1", RenderedContent: "SECRET"},
		}},
	}}
	evidence, err := memoryDatabaseEvidence(database, map[string]bool{"source": true})
	if err != nil {
		t.Fatal(err)
	}
	if len(evidence.Rows) != 1 || len(evidence.Rows[0].Fields) != 3 {
		t.Fatalf("unexpected rows: %+v", evidence.Rows)
	}
	if evidence.Rows[0].Fields[1].Value.Number.Content != 42 {
		t.Fatal("typed number was lost")
	}
	if !evidence.Rows[0].Fields[2].Excluded {
		t.Fatal("related content not marked excluded")
	}
	data, _ := json.Marshal(evidence)
	if strings.Contains(string(data), "SECRET") || strings.Contains(string(data), "999") {
		t.Fatalf("other source leaked: %s", data)
	}
	if !evidence.OtherRowsExcluded {
		t.Fatal("partial source not disclosed")
	}
}
func TestAIMemoryNativeEvidenceRejectsMalformedAndBudget(t *testing.T) {
	for _, database := range []*av.AttributeView{
		{KeyValues: []*av.KeyValues{nil}},
		{KeyValues: []*av.KeyValues{{Key: &av.Key{Type: av.KeyTypeBlock}, Values: []*av.Value{{Type: av.KeyTypeBlock}}}}},
		{KeyValues: make([]*av.KeyValues, 129)},
	} {
		if _, err := memoryDatabaseEvidence(database, map[string]bool{"source": true}); err == nil {
			t.Fatal("invalid or incomplete data accepted")
		}
	}
}
func TestAIMemoryNativeValueExcludesUnrelatedPayload(t *testing.T) {
	value := &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "allowed"}, Block: &av.ValueBlock{Content: "SECRET"}, RenderedContent: "SECRET"}
	encoded, _ := json.Marshal(memoryNativeValue(value))
	if strings.Contains(string(encoded), "SECRET") {
		t.Fatalf("unexpected payload leaked: %s", encoded)
	}
}
