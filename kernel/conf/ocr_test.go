package conf

import "testing"

func TestOCRDeviceDefaults(t *testing.T) {
	if config := NewOCR(); config.Provider != "paddleocr" || config.Model != "tiny" || config.Auto {
		t.Fatalf("device defaults: %+v", config)
	}
}
