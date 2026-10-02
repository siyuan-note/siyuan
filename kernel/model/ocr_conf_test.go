package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestNormalizeOCRConfig(t *testing.T) {
	for _, test := range []struct {
		name           string
		value          *conf.OCR
		confFileExists bool
		mobile         bool
		want           conf.OCR
	}{
		{name: "new desktop", want: conf.OCR{Provider: "paddleocr", Model: "small", Auto: false}},
		{name: "new mobile", mobile: true, want: conf.OCR{Provider: "paddleocr", Model: "tiny", Auto: false}},
		{name: "legacy desktop", confFileExists: true, want: conf.OCR{Provider: "tesseract", Model: "small", Auto: true}},
		{name: "legacy mobile", confFileExists: true, mobile: true, want: conf.OCR{Provider: "tesseract", Model: "tiny", Auto: true}},
		{
			name:           "saved PaddleOCR with auto enabled",
			value:          &conf.OCR{Provider: "paddleocr", Model: "small", Auto: true},
			confFileExists: true,
			want:           conf.OCR{Provider: "paddleocr", Model: "small", Auto: true},
		},
		{
			name:           "saved Tesseract with auto disabled",
			value:          &conf.OCR{Provider: "tesseract", Model: "tiny", Auto: false},
			confFileExists: true,
			want:           conf.OCR{Provider: "tesseract", Model: "tiny", Auto: false},
		},
		{
			name:           "saved PaddleOCR with imported model",
			value:          &conf.OCR{Provider: "paddleocr", Model: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", Auto: false},
			confFileExists: true,
			mobile:         true,
			want:           conf.OCR{Provider: "paddleocr", Model: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", Auto: false},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := normalizeOCRConfig(test.value, test.confFileExists, test.mobile)
			if *got != test.want {
				t.Fatalf("OCR config: got %+v, want %+v", *got, test.want)
			}
			if test.value != nil && got != test.value {
				t.Fatal("saved OCR config should be retained")
			}
		})
	}
}
