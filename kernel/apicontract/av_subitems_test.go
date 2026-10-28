package apicontract

import (
	"strings"
	"testing"
)

func TestAVSubItemsReadContract(t *testing.T) {
	for _, body := range []string{`{"id":"av"}`, `{"id":"av","nested":null}`, `{"id":"av","nested":{"expandedIDs":["parent"],"groupExpandedIDs":{"group":["parent"]},"childPaging":{"group/parent":{"page":3,"pageSize":50}}}}`} {
		if _, err := RenderAttributeView.Decode(strings.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	request, err := GetAttributeViewRelationCandidates.Decode(strings.NewReader(`{"avID":"av","excludeItemIDs":["parent"]}`))
	if err != nil || len(request.ExcludeItemIDs) != 1 {
		t.Fatalf("excluded candidates: %+v %v", request, err)
	}
	if _, err = RenderHistoryAttributeView.Decode(strings.NewReader(`{"id":"av","created":"1","nested":{}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = RenderSnapshotAttributeView.Decode(strings.NewReader(`{"id":"av","snapshot":"snapshot","page":2,"pageSize":20,"nested":{}}`)); err != nil {
		t.Fatal(err)
	}
}
