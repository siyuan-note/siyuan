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

func TestOCRThresholdContract(t *testing.T) {
	for _, fields := range []string{
		`{}`, `{"detection":0.3,"box":0.6}`, `{"detection":"0.3","box":0.6,"recognition":0.5}`,
		`{"detection":false,"box":null,"recognition":null}`,
	} {
		body := `{"provider":"paddleocr","model":"small","auto":false,"thresholds":` + fields + `}`
		if _, err := SetOCRConfig.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted malformed thresholds: %s", body)
		}
	}
	for _, fields := range []string{`{"detection":null,"box":null,"recognition":null}`, `{"detection":0.3,"box":0.6,"recognition":0}`} {
		body := `{"provider":"paddleocr","model":"small","auto":false,"thresholds":` + fields + `}`
		if request, err := SetOCRConfig.Decode(strings.NewReader(body)); err != nil || request.Thresholds == nil {
			t.Fatalf("rejected valid thresholds: %s: %v", body, err)
		}
	}
}
