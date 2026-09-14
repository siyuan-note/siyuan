package apicontract

import (
	"encoding/json"
	"mime/multipart"
	"testing"
)

func TestExtensionCopyFormContract(t *testing.T) {
	file := &multipart.FileHeader{Filename: "image.png"}
	request, err := ExtensionCopy.DecodeMultipart(&multipart.Form{
		Value: map[string][]string{"dom": {"first", "second"}, "notebook": {" box "}, "href": {""}, "clipType": {"part"}, "assets": {"true"}},
		File:  map[string][]*multipart.FileHeader{"https%3A%2F%2Fexample.invalid%2Fimage.png": {file, file}},
	})
	if err != nil || request.DOM != "first" || *request.Notebook != " box " || request.Href == nil || *request.Href != "" || *request.ClipType != "part" || *request.Assets != "true" || len(request.Files) != 1 {
		t.Fatalf("form values changed: %+v %v", request, err)
	}
	for _, files := range request.Files {
		if len(files) != 2 || files[0] != file || files[1] != file {
			t.Fatal("repeated uploads changed")
		}
	}
	_, err = ExtensionCopy.DecodeMultipart(&multipart.Form{Value: map[string][]string{}})
	if err == nil {
		t.Fatal("missing DOM accepted")
	}
	response, _ := json.Marshal(ExtensionCopy.DecodeFailure(err))
	if string(response) != `{"code":0,"msg":"","data":null}` {
		t.Fatalf("empty form response changed: %s", response)
	}
}
