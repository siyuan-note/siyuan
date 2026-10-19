package model

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestOCRSmallMigrationPreservesPreferences(t *testing.T) {
	for _, provider := range []string{"paddleocr", "tesseract"} {
		for _, model := range []string{"small", "tiny", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"} {
			var value conf.OCR
			if err := json.Unmarshal([]byte(`{"provider":"`+provider+`","model":"`+model+`","auto":true,"thresholds":{"detection":0.4,"box":0.7,"recognition":0.8}}`), &value); err != nil {
				t.Fatal(err)
			}
			original := value
			original.ShowText = new(true)
			if original.Model == "small" {
				original.Model = "tiny"
			}
			got := normalizeOCRConfig(&value, true)
			if !reflect.DeepEqual(*got, original) {
				t.Fatalf("migration changed preferences: %+v", got)
			}
			if again := normalizeOCRConfig(got, true); !reflect.DeepEqual(*again, original) {
				t.Fatal("migration is not idempotent")
			}
		}
	}
}

func TestOCRModelFilesChanged(t *testing.T) {
	for _, test := range []struct {
		name    string
		upserts []string
		removes []string
		want    bool
	}{
		{name: "no files"},
		{name: "ordinary assets", upserts: []string{"assets/image.png", "box/document.sy"}},
		{name: "similar directory", upserts: []string{"ocr/models-backup/config.yml", "box/ocr/models/test.yml"}},
		{name: "new model", upserts: []string{"ocr/models/hash/det/inference.onnx"}, want: true},
		{name: "removed model", removes: []string{"/ocr/models/hash/rec/inference.yml"}, want: true},
		{name: "removed model directory", removes: []string{"ocr/models"}, want: true},
		{name: "Windows separators", upserts: []string{`ocr\models\hash\det\inference.onnx`}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := ocrModelFilesChanged(test.upserts, test.removes); got != test.want {
				t.Fatalf("model changes: got %t, want %t", got, test.want)
			}
		})
	}
}
