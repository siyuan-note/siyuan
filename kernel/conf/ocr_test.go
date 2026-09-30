package conf

import "testing"

func TestOCRDeviceDefaults(t *testing.T) {
	if desktop := NewOCR(false); desktop.Provider != "tesseract" || desktop.Model != "small" || !desktop.Auto {
		t.Fatalf("desktop defaults: %+v", desktop)
	}
	if mobile := NewOCR(true); mobile.Model != "tiny" || !mobile.Auto {
		t.Fatalf("mobile defaults: %+v", mobile)
	}
}
