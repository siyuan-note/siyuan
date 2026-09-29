package apicontract

import (
	"strings"
	"testing"
)

func TestMindmapSearchContract(t *testing.T) {
	request, err := FullTextSearchBlock.Decode(strings.NewReader(`{"types":{"mindmap":true,"mindmapItem":false}}`))
	if err != nil || !request.Types["mindmap"] || request.Types["mindmapItem"] {
		t.Fatalf("mind map search filters lost: %+v, %v", request, err)
	}
	for _, body := range []string{`{"criterion":{"types":{}}}`, `{"criterion":{"types":{"mindmap":false,"mindmapItem":true}}}`} {
		request, err := SetCriterion.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(body, "mindmap") {
			if request.Criterion.Types.Mindmap == nil || *request.Criterion.Types.Mindmap || request.Criterion.Types.MindmapItem == nil || !*request.Criterion.Types.MindmapItem {
				t.Fatal("explicit criterion choices lost")
			}
		} else if request.Criterion.Types.Mindmap != nil || request.Criterion.Types.MindmapItem != nil {
			t.Fatal("legacy criterion field presence changed")
		}
	}
}
