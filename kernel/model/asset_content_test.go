package model

import (
	"testing"
)

func TestPDFParser(t *testing.T) {
	p := &PdfAssetParser{}
	res := p.Parse("../../testdata/parsertest.pdf")
	if res == nil || res.Content == "" {
		t.Fatalf("empty or nil PDF content result")
	}
}
