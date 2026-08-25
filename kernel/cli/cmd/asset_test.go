// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

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
