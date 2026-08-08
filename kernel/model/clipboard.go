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
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const richClipboardGlobalGroup = "_global"

var richClipboardImageExts = map[string]struct{}{
	".apng":  {},
	".avif":  {},
	".bmp":   {},
	".cur":   {},
	".gif":   {},
	".ico":   {},
	".jfif":  {},
	".jpe":   {},
	".jpeg":  {},
	".jpg":   {},
	".pjp":   {},
	".pjpeg": {},
	".png":   {},
	".webp":  {},
}

type RichClipboardAsset struct {
	Index int
	Path  string
	Box   string
}

type RichClipboardPreparedAsset struct {
	Index int    `json:"index"`
	Path  string `json:"path"`
}

type RichClipboardPrepared struct {
	Batch  string                       `json:"batch"`
	Groups []string                     `json:"groups"`
	Assets []RichClipboardPreparedAsset `json:"assets"`
}

func PrepareRichClipboardAssets(assets []RichClipboardAsset) (ret *RichClipboardPrepared, err error) {
	if len(assets) < 1 || 1024 < len(assets) {
		return nil, fmt.Errorf("invalid rich clipboard asset count [%d]", len(assets))
	}

	batch := util.RandString(24)
	groups := map[string]struct{}{}
	copied := map[string]string{}
	ret = &RichClipboardPrepared{Batch: batch}
	defer func() {
		if err != nil {
			cleanupRichClipboardGroups(batch, groups)
		}
	}()

	for _, asset := range assets {
		if asset.Index < 0 {
			return nil, fmt.Errorf("invalid rich clipboard asset index [%d]", asset.Index)
		}

		ext := strings.ToLower(filepath.Ext(AssetPathWithoutQuery(asset.Path)))
		if _, ok := richClipboardImageExts[ext]; !ok {
			return nil, fmt.Errorf("unsupported rich clipboard image extension [%s]", ext)
		}

		absPath, resolveErr := GetAssetAbsPathInBox(asset.Path, asset.Box)
		if resolveErr != nil {
			return nil, resolveErr
		}

		destPath, ok := copied[absPath]
		if !ok {
			group := ExtractBoxIDFromAssetsPath(absPath)
			if group == "" {
				group = richClipboardGlobalGroup
			}
			groups[group] = struct{}{}

			destDir := filepath.Join(util.TempDir, "clipboard", group, batch)
			if mkdirErr := os.MkdirAll(destDir, 0700); mkdirErr != nil {
				return nil, mkdirErr
			}
			destPath = filepath.Join(destDir, fmt.Sprintf("%d%s", len(copied), ext))
			if copyErr := copyAssetDecryptIfEncrypted(absPath, destPath); copyErr != nil {
				return nil, copyErr
			}
			if chmodErr := os.Chmod(destPath, 0600); chmodErr != nil {
				return nil, chmodErr
			}
			copied[absPath] = destPath
		}

		ret.Assets = append(ret.Assets, RichClipboardPreparedAsset{
			Index: asset.Index,
			Path:  destPath,
		})
	}

	for group := range groups {
		ret.Groups = append(ret.Groups, group)
	}
	sort.Strings(ret.Groups)
	return ret, nil
}

func CleanupRichClipboardBatch(batch string, groups []string) {
	if !isRichClipboardBatch(batch) {
		return
	}

	validGroups := map[string]struct{}{}
	for _, group := range groups {
		if group == richClipboardGlobalGroup || ast.IsNodeIDPattern(group) {
			validGroups[group] = struct{}{}
		}
	}
	cleanupRichClipboardGroups(batch, validGroups)
}

func ClearRichClipboard() {
	os.RemoveAll(filepath.Join(util.TempDir, "clipboard"))
}

func ClearRichClipboardBox(boxID string) {
	if !ast.IsNodeIDPattern(boxID) {
		return
	}
	os.RemoveAll(filepath.Join(util.TempDir, "clipboard", boxID))
}

func cleanupRichClipboardGroups(batch string, groups map[string]struct{}) {
	for group := range groups {
		dir := filepath.Join(util.TempDir, "clipboard", group, batch)
		os.RemoveAll(dir)
		parent := filepath.Dir(dir)
		if util.IsEmptyDir(parent) {
			os.Remove(parent)
		}
	}
}

func isRichClipboardBatch(batch string) bool {
	if batch == "" || 64 < len(batch) {
		return false
	}
	for _, char := range batch {
		if ('a' <= char && char <= 'z') || ('A' <= char && char <= 'Z') || ('0' <= char && char <= '9') ||
			char == '-' || char == '_' {
			continue
		}
		return false
	}
	return true
}
