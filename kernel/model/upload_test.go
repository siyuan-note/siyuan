// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"testing"
)

func TestRecordAssetUploadSuccessPreservesDuplicateNames(t *testing.T) {
	succMap := map[string]any{}
	var succFiles []AssetUploadSuccess
	recordAssetUploadSuccess(succMap, &succFiles, 0, "image.png", "assets/image-first.png")
	recordAssetUploadSuccess(succMap, &succFiles, 1, "image.png", "assets/image-second.png")

	if len(succFiles) != 2 {
		t.Fatalf("expected two successful files, got %d", len(succFiles))
	}
	if succFiles[0].Index != 0 || succFiles[0].Path != "assets/image-first.png" {
		t.Fatalf("unexpected first successful file: %+v", succFiles[0])
	}
	if succFiles[1].Index != 1 || succFiles[1].Path != "assets/image-second.png" {
		t.Fatalf("unexpected second successful file: %+v", succFiles[1])
	}
	if succMap["image.png"] != "assets/image-second.png" {
		t.Fatalf("legacy success map should retain the latest path, got %v", succMap["image.png"])
	}
}

func TestRecordAssetUploadFailurePreservesInputIndex(t *testing.T) {
	var failedFiles []AssetUploadFailure
	recordAssetUploadFailure(&failedFiles, 2, "missing.png", errors.New("file not found"))

	if len(failedFiles) != 1 {
		t.Fatalf("expected one failed file, got %d", len(failedFiles))
	}
	if failedFiles[0].Index != 2 || failedFiles[0].Name != "missing.png" || failedFiles[0].Error != "file not found" {
		t.Fatalf("unexpected failed file: %+v", failedFiles[0])
	}
}
