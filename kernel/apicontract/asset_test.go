package apicontract

import (
	"mime/multipart"
	"strings"
	"testing"
)

func TestAssetRequestCompatibility(t *testing.T) {
	for _, body := range []string{
		`{"assetPaths":[],"id":false,"fromHTMLPaste":"true"}`,
		`{"assetPaths":[],"id":null,"fromHTMLPaste":null,"isUpload":null}`,
		`{"assetPaths":[]}`,
	} {
		request, err := InsertLocalAssets.Decode(strings.NewReader(body))
		if err != nil || request.ID != "" || request.FromHTMLPaste || request.IsUpload != nil {
			t.Fatalf("optional upload arguments changed: %+v %v", request, err)
		}
	}
	request, err := InsertLocalAssets.Decode(strings.NewReader(`{"assetPaths":[" /file "],"isUpload":false,"id":" id ","fromHTMLPaste":true}`))
	if err != nil || request.AssetPaths[0] != " /file " || request.ID != " id " || request.IsUpload == nil || *request.IsUpload || !request.FromHTMLPaste {
		t.Fatalf("explicit upload arguments changed: %+v %v", request, err)
	}
	for _, body := range []string{`{}`, `{"paths":null}`} {
		if _, err := AssetUploadCloudByAssetsPaths.Decode(strings.NewReader(body)); err == nil || err.Error() != "[paths] is required" {
			t.Fatalf("missing paths response changed: %v", err)
		}
	}
	if _, err := AssetUploadCloudByAssetsPaths.Decode(strings.NewReader(`{"paths":[null]}`)); err == nil {
		t.Fatal("null path accepted")
	}
	files := []*multipart.FileHeader{{Filename: "first"}, {Filename: "second"}}
	upload, err := UploadAsset.DecodeMultipart(&multipart.Form{Value: map[string][]string{"id": {"", "ignored"}, "assetsDirPath": {" path ", "ignored"}}, File: map[string][]*multipart.FileHeader{"file[]": files}})
	if err != nil || upload.ID == nil || *upload.ID != "" || upload.AssetsDirPath == nil || *upload.AssetsDirPath != " path " || len(upload.Files) != 2 || upload.Files[0] != files[0] || upload.Files[1] != files[1] {
		t.Fatalf("multipart values changed: %+v %v", upload, err)
	}
	upload, err = UploadAsset.DecodeMultipart(&multipart.Form{})
	if err != nil || upload.ID != nil || upload.AssetsDirPath != nil || upload.Files != nil {
		t.Fatalf("multipart omissions changed: %+v %v", upload, err)
	}
}

func TestAssetResponseVariants(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path string
		body string
	}{
		{"statAsset", `{"code":0,"msg":"","data":{"size":1,"hSize":"1B","created":1,"hCreated":"date","updated":2,"hUpdated":"date"}}`},
		{"statAsset", `{"code":0,"msg":"","data":{"size":1,"hSize":"1B","created":1,"hCreated":"date","updated":2,"hUpdated":"date","downloaded":false}}`},
		{"ocr", `{"code":0,"msg":"","data":{"text":"text","ocrJSON":[{"text":"text","customColumn":"value"}]}}`},
		{"upload", `{"code":0,"msg":"first failed","data":{"errFiles":["first"],"failedFiles":[{"index":0,"name":"first","error":"first failed"}],"succFiles":[],"succMap":{}}}`},
		{"upload", `{"code":0,"msg":"","data":{"errFiles":null,"failedFiles":[],"succFiles":[],"succMap":{}}}`},
		{"insertLocalAssets", `{"code":-1,"msg":"failed","data":{"errFiles":["first"],"failedFiles":[{"index":0,"name":"first","error":"failed"}],"succFiles":[],"succMap":{}}}`},
		{"getFileAnnotation", `{"code":403,"msg":"Forbidden","data":null}`},
	} {
		if err := bundle.ValidateResponse("POST", "/api/asset/"+test.path, []byte(test.body)); err != nil {
			t.Errorf("%s: %v", test.path, err)
		}
	}
	for _, test := range []struct{ path, body string }{
		{"statAsset", `{"code":0,"msg":"","data":{"size":1,"hSize":"1B","created":1,"hCreated":"date","updated":2,"hUpdated":"date","downloaded":true}}`},
		{"ocr", `{"code":0,"msg":"","data":{"text":"text","ocrJSON":[{"text":42}]}}`},
		{"upload", `{"code":0,"msg":"","data":{"errFiles":null,"failedFiles":[],"succFiles":[],"succMap":{"file":false}}}`},
	} {
		if err := bundle.ValidateResponse("POST", "/api/asset/"+test.path, []byte(test.body)); err == nil {
			t.Errorf("invalid asset payload accepted: %s", test.body)
		}
	}
}
