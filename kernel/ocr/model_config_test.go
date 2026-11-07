// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package ocr

import (
	"os"
	"path/filepath"
	"testing"
)

func TestModelConfigAllowsExtraFields(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "det"), 0700); err != nil {
		t.Fatal(err)
	}
	data := "Global:\n  model_name: PP-OCRv6_tiny_det\n  use_gpu: false\n  cpu_threads: 4\nPreProcess:\n  transform_ops: []\nPostProcess:\n  name: DBPostProcess\n  thresh: 0.3\n  box_thresh: 0.6\n  unclip_ratio: 1.5\n  extra_option: true\n"
	if err := os.WriteFile(filepath.Join(root, "det", "inference.yml"), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	config, err := readModelConfig(root, "det")
	if err != nil || config.Global.ModelName != "PP-OCRv6_tiny_det" || config.PostProcess.Unclip != 1.5 {
		t.Fatalf("configuration: %+v %v", config, err)
	}
}

func TestPinnedModelConfigurations(t *testing.T) {
	root := os.Getenv("SIYUAN_OCR_TEST_ASSETS")
	if root == "" {
		t.Skip("set SIYUAN_OCR_TEST_ASSETS to model configuration directory")
	}
	for _, kind := range []string{"det", "rec"} {
		if _, err := readModelConfig(root, kind); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
	}
}
