// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import "testing"

func TestOCRDeviceDefaults(t *testing.T) {
	if config := NewOCR(); config.Provider != "paddleocr" || config.Model != "tiny" || config.Auto ||
		config.ShowText == nil || !*config.ShowText || config.ShowEmpty || config.ShowError {
		t.Fatalf("device defaults: %+v", config)
	}
}

func TestOCRTooltipNormalization(t *testing.T) {
	legacy := NormalizeOCR(&OCR{Provider: "tesseract", Model: "tiny", Auto: true})
	if legacy.ShowText == nil || !*legacy.ShowText || legacy.ShowEmpty || legacy.ShowError || !legacy.Auto {
		t.Fatalf("legacy defaults: %+v", legacy)
	}
	saved := NormalizeOCR(&OCR{ShowText: new(false), ShowEmpty: true, ShowError: true})
	if *saved.ShowText || !saved.ShowEmpty || !saved.ShowError {
		t.Fatalf("saved tooltip preferences: %+v", saved)
	}
}
