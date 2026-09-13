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

func TestPutFileFormFields(t *testing.T) {
	first := &multipart.FileHeader{Filename: "first.txt"}
	request, err := PutFile.DecodeMultipart(&multipart.Form{
		Value: map[string][]string{"path": {" temp/file ", "ignored"}, "isDir": {"invalid"}},
		File:  map[string][]*multipart.FileHeader{"file": {first, {Filename: "ignored.txt"}}},
	})
	if err != nil || request.Path != " temp/file " || request.IsDir != "invalid" || request.File != first {
		t.Fatalf("form fields must preserve first values without early validation: %+v, %v", request, err)
	}
	if _, err = PutFile.DecodeMultipart(&multipart.Form{}); err != nil {
		t.Fatalf("conditional field validation belongs to the handler: %v", err)
	}
}
