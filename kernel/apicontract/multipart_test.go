package apicontract

import (
	"mime/multipart"
	"reflect"
	"testing"
)

func TestMultipartRequestCompatibility(t *testing.T) {
	first := &multipart.FileHeader{Filename: "first.json"}
	form := &multipart.Form{
		File:  map[string][]*multipart.FileHeader{"file": {first, {Filename: "second.json"}}},
		Value: map[string][]string{"password": {" secret ", "ignored"}},
	}
	request, err := ImportNotebookCryptoBackup.DecodeMultipart(form)
	if err != nil || request.File != first || request.Password != " secret " {
		t.Fatalf("multipart first-value semantics changed: %v", err)
	}
	delete(form.Value, "password")
	request, err = ImportNotebookCryptoBackup.DecodeMultipart(form)
	if err != nil || request.Password != "" {
		t.Fatalf("missing password must remain empty: %v", err)
	}
	delete(form.File, "file")
	if _, err = ImportNotebookCryptoBackup.DecodeMultipart(form); err == nil || err.Error() != "file not found" {
		t.Fatalf("missing file error changed: %v", err)
	}
	if err := validateMultipartRequest(reflect.TypeFor[struct {
		Count int `json:"count"`
	}]()); err == nil {
		t.Fatal("unsupported form field accepted")
	}
}
