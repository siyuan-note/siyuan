package apicontract

import (
	"strings"
	"testing"
)

func TestAIOCRContract(t *testing.T) {
	for _, body := range []string{`{}`, `{"path":null}`, `{"path":42}`} {
		if _, err := AIOCR.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid OCR request: %s", body)
		}
	}
	request, err := AIOCR.Decode(strings.NewReader(`{"path":"assets/image.png?box=20261003100000-abcdefg#preview"}`))
	if err != nil || !strings.Contains(request.Path, "?box=") {
		t.Fatalf("lost resource identity: %+v, %v", request, err)
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"code":0,"msg":"","data":{"text":"line one\nline two"}}`, `{"code":0,"msg":"","data":{"text":""}}`, `{"code":-1,"msg":"failed","data":null}`} {
		if err := bundle.ValidateResponse("POST", "/api/ai/ocr", []byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if !RequiresAI(AIOCR.Definition().Path) {
		t.Fatal("OCR bypasses the AI feature flag")
	}
}
