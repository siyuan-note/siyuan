package apicontract

import (
	"reflect"
	"strings"
	"testing"
)

func TestTransferBlockRefCompatibility(t *testing.T) {
	for _, body := range []string{`{"fromID":"from","toID":"to"}`, `{"fromID":"from","toID":"to","reloadUI":null,"refIDs":null}`} {
		request, err := TransferBlockRef.Decode(strings.NewReader(body))
		if err != nil || request.ReloadUI != nil || request.RefIDs != nil {
			t.Fatalf("reference transfer defaults changed: %+v, %v", request, err)
		}
	}
	request, err := TransferBlockRef.Decode(strings.NewReader(`{"fromID":"from","toID":"to","reloadUI":false,"refIDs":["ref","ref"]}`))
	if err != nil || request.ReloadUI == nil || *request.ReloadUI || !reflect.DeepEqual(request.RefIDs, []string{"ref", "ref"}) {
		t.Fatalf("reference transfer input changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{"fromID":"from","toID":"to","reloadUI":0}`, `{"fromID":"from","toID":"to","refIDs":[null]}`} {
		if _, err := TransferBlockRef.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid reference transfer accepted: %s", body)
		}
	}
}

func TestMoveBlockCompatibility(t *testing.T) {
	for _, body := range []string{`{"id":" raw "}`, `{"id":" raw ","parentID":null,"previousID":null}`} {
		request, err := MoveBlock.Decode(strings.NewReader(body))
		if err != nil || request.ID != " raw " || request.ParentID != nil || request.PreviousID != nil {
			t.Fatalf("move defaults changed: %+v, %v", request, err)
		}
	}
	request, err := MoveBlock.Decode(strings.NewReader(`{"id":"id","parentID":"","previousID":""}`))
	if err != nil || request.ParentID == nil || *request.ParentID != "" || request.PreviousID == nil || *request.PreviousID != "" {
		t.Fatalf("explicit empty move targets changed: %+v, %v", request, err)
	}
}
