package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPruneListMindmapAppearance(t *testing.T) {
	for _, version := range []string{"1", "2"} {
		_, list, _ := mindmapTestTree()
		appearance := `{"version":1,"palette":["#123456","#abcdef"],"backgroundColor":"#ffffff","extension":9007199254740993}`
		original := `{"version":` + version + `,"appearance":` + appearance +
			`,"nodes":{"child":{"branchColor":2,"lineColor":"red"},"deleted":{}},"relations":[]}`
		list.SetIALAttr(listMindmapMetadataAttr, original)
		next, changed := pruneListMindmapMetadata(list)
		if !changed || strings.Contains(next, "deleted") || !strings.Contains(next, appearance) ||
			!strings.Contains(next, `"branchColor":2`) || !strings.Contains(next, `"lineColor":"red"`) {
			t.Fatalf("appearance or manual colors were lost during pruning: %s", next)
		}
		list.SetIALAttr(listMindmapMetadataAttr, next)
		if again, changed := pruneListMindmapMetadata(list); changed || again != next {
			t.Fatal("appearance normalization is not idempotent")
		}
		for _, invalid := range []string{`null`, `[]`, `{}`, `{"version":2,"palette":[]}`,
			`{"version":1,"palette":["red"]}`, `{"version":1,"palette":[],"backgroundColor":"url(x)"}`} {
			data := strings.Replace(original, appearance, invalid, 1)
			list.SetIALAttr(listMindmapMetadataAttr, data)
			if next, changed := pruneListMindmapMetadata(list); changed || next != data {
				t.Fatalf("invalid or newer appearance was changed: %s", next)
			}
		}
		for _, slot := range []string{`-1`, `0.5`, `null`, `"1"`, `9007199254740992`} {
			data := strings.Replace(original, `"branchColor":2`, `"branchColor":`+slot, 1)
			list.SetIALAttr(listMindmapMetadataAttr, data)
			if next, changed := pruneListMindmapMetadata(list); changed || next != data {
				t.Fatalf("invalid branch color was changed: %s", next)
			}
		}
	}
}

func TestValidListMindmapAppearance(t *testing.T) {
	for _, source := range []string{`{"version":1,"palette":[]}`, `{"version":1,"palette":["#AbCdEf"],"backgroundColor":""}`} {
		var value any
		_ = json.Unmarshal([]byte(source), &value)
		if !validListMindmapAppearance(value) {
			t.Fatalf("valid appearance rejected: %s", source)
		}
	}
	var value any
	_ = json.Unmarshal([]byte(`{"version":1,"palette":[`+strings.Repeat(`"#123456",`, 24)+`"#123456"]}`), &value)
	if validListMindmapAppearance(value) {
		t.Fatal("oversized palette accepted")
	}
}
