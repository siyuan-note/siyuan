package apicontract

import (
	"strings"
	"testing"
)

func TestOCRSettingStrictInput(t *testing.T) {
	for _, body := range []string{`{}`, `{"provider":"paddleocr","model":"tiny","auto":null}`, `{"provider":null,"model":"tiny","auto":true}`, `{"provider":"paddleocr","model":"tiny","auto":1}`} {
		if _, err := SetOCRConfig.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid OCR settings: %s", body)
		}
	}
	request, err := SetOCRConfig.Decode(strings.NewReader(`{"provider":"paddleocr","model":"small","auto":false}`))
	if err != nil || request.Provider != "paddleocr" || request.Model != "small" || request.Auto {
		t.Fatalf("valid settings: %+v %v", request, err)
	}
}
