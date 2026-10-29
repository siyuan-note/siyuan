// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestNewAssetUploadCommandOutputPreservesPartialResults(t *testing.T) {
	succeeded := []model.AssetUploadSuccess{{Index: 0, Name: "good.png", Path: "assets/good.png"}}
	failed := []model.AssetUploadFailure{{Index: 1, Name: "missing.png", Error: "file not found"}}

	result := newAssetUploadCommandOutput(succeeded, failed)

	if result.Status != "partial" {
		t.Fatalf("status = %q, want partial", result.Status)
	}
	if len(result.Succeeded) != 1 || result.Succeeded[0].Path != "assets/good.png" {
		t.Fatalf("succeeded = %#v", result.Succeeded)
	}
	if len(result.Failed) != 1 || result.Failed[0].Name != "missing.png" {
		t.Fatalf("failed = %#v", result.Failed)
	}
}
