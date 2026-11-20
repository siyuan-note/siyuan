// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"
	"testing"
)

func TestCurrentPaddleConfigUsesSelectedLinuxMode(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previousConf })

	cfg := currentPaddleConfig()
	if filepath.Base(cfg.Library) != "libonnxruntime.so" {
		t.Fatalf("unexpected Linux OCR library: %q", cfg.Library)
	}
	if linuxOCRWorker {
		if want := filepath.Join(filepath.Dir(cfg.Library), "siyuan-ocr"); cfg.Worker != want {
			t.Fatalf("worker = %q, want %q", cfg.Worker, want)
		}
	} else if cfg.Worker != "" {
		t.Fatalf("in-process OCR selected a worker: %q", cfg.Worker)
	}
}
