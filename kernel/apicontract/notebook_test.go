package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReorderNotebookCompatibility(t *testing.T) {
	request, err := ReorderNotebooks.Decode(strings.NewReader(`{"SOURCEIDS":[null,"id"],"TARGETID":"target","POSITION":"before"}`))
	if err != nil || len(request.SourceIDs) != 2 || request.SourceIDs[0] != "" || request.TargetID != "target" || request.Position != "before" {
		t.Fatalf("struct decoding compatibility changed: %+v, %v", request, err)
	}
	for _, body := range []string{`null`, `{}`, `{"sourceIDs":null,"targetID":null,"position":null}`} {
		if _, err := ReorderNotebooks.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("business validation must handle missing fields: %v", err)
		}
	}
	if _, err := ReorderNotebooks.Decode(strings.NewReader("")); err == nil || err.Error() != "Parses request [/api/notebook/reorder] failed: EOF" {
		t.Fatalf("empty request error changed: %v", err)
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	response, err := json.Marshal(ReorderNotebooks.FailureWithData(-1, "failed", &ReorderData{}))
	if err != nil {
		t.Fatal(err)
	}
	if err := bundle.ValidateResponse("POST", "/api/notebook/reorder", response); err != nil {
		t.Fatal(err)
	}
}

func TestNotebookCryptoRequestCompatibility(t *testing.T) {
	request, err := UnlockNotebook.Decode(strings.NewReader(`{"notebook":" 20260101000000-abcdefg ","password":" secret "}`))
	if err != nil || request.Notebook != "20260101000000-abcdefg" || request.Password != "secret" {
		t.Fatalf("notebook and password trimming changed: %v", err)
	}
	for _, body := range []string{`{}`, `{"password":null}`, `{"password":" "}`, `{"password":123}`} {
		if _, err := EnableEncryptedNotebooks.Decode(strings.NewReader(body)); err == nil {
			t.Fatal("invalid password accepted")
		}
	}
	for _, body := range []string{`{"autoLockMinutes":1.9}`, `{"autoLockMinutes":-2}`, `{"autoLockMinutes":0}`} {
		if _, err := SetNotebookCryptoAutoLock.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("numeric minutes rejected: %v", err)
		}
	}
	if _, err := SetNotebookCryptoAutoLock.Decode(strings.NewReader(`{"autoLockMinutes":"1"}`)); err == nil {
		t.Fatal("string minutes accepted")
	}
	if _, err := TouchEncryptedNotebooks.Decode(strings.NewReader("not JSON")); err != nil {
		t.Fatalf("bodyless endpoint began parsing a request body: %v", err)
	}
}

func TestNotebookRequestCompatibility(t *testing.T) {
	request, err := RenameNotebook.Decode(strings.NewReader(`{"notebook":" 20260101000000-abcdefg ","name":" "}`))
	if err != nil || request.Notebook != "20260101000000-abcdefg" || request.Name != " " {
		t.Fatalf("notebook trimming must preserve the name: %+v, %v", request, err)
	}
	closed, err := CloseNotebook.Decode(strings.NewReader(`{"notebook":" 20260101000000-abcdefg "}`))
	if err != nil || closed.Notebook != " 20260101000000-abcdefg " {
		t.Fatalf("close must preserve whitespace for ID validation: %+v, %v", closed, err)
	}
	icon, err := SetNotebookIcon.Decode(strings.NewReader(`{"notebook":"20260101000000-abcdefg","icon":""}`))
	if err != nil || icon.Icon != "" {
		t.Fatalf("empty icon must remain accepted: %+v, %v", icon, err)
	}
	for _, body := range []string{`{}`, `{"notebooks":null}`, `{"notebooks":[null]}`, `{"notebooks":[1]}`} {
		if _, err := ChangeSortNotebook.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid notebook list accepted: %s", body)
		}
	}
	if _, err := ChangeSortNotebook.Decode(strings.NewReader(`{"notebooks":[]}`)); err != nil {
		t.Fatalf("empty notebook list must remain accepted: %v", err)
	}
}
