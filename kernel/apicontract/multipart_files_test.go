package apicontract

import (
	"encoding/json"
	"mime/multipart"
	"strings"
	"testing"
)

type multiFileRequest struct {
	Files []*multipart.FileHeader `json:"files"`
}

func TestMultipartFileListAndSuccessMessage(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[multiFileRequest, []string]("multiFiles", "/test/multi-files", MultipartBody, ResponseOptions{}, "POST")
	files := []*multipart.FileHeader{{Filename: "first.txt"}, {Filename: "second.txt"}}
	request, err := endpoint.DecodeMultipart(&multipart.Form{File: map[string][]*multipart.FileHeader{"files": files}})
	if err != nil || len(request.Files) != 2 || request.Files[0] != files[0] || request.Files[1] != files[1] {
		t.Fatalf("upload list changed: %+v, %v", request, err)
	}
	if _, err := endpoint.DecodeMultipart(&multipart.Form{}); err == nil {
		t.Fatal("required file list accepted missing files")
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(bundle.TypeScript(nil)), `"files": Array<Blob>`) {
		t.Fatal("file list declaration is missing")
	}
	payload, err := json.Marshal(SuccessWithMessage([]string{"first.txt"}, "second file failed"))
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != `{"code":0,"msg":"second file failed","data":["first.txt"]}` {
		t.Fatal(string(payload))
	}
	if err := bundle.ValidateHTTPResponse("POST", "/test/multi-files", 200, "application/json", payload); err != nil {
		t.Fatal(err)
	}
}
