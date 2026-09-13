// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
)

// CopyAssetTextForRelink 复制 OCR 元数据，保留源资源的识别结果，并拒绝覆盖不同的目标结果。
func CopyAssetTextForRelink(oldPath, newPath, historyDir string, dryRun bool) (exists bool, err error) {
	assetsTextsLock.Lock()
	defer assetsTextsLock.Unlock()
	abs := filepath.Join(GetDataAssetsAbsPath(), "ocr-texts.json")
	data, err := filelock.ReadFile(abs)
	if err != nil && !os.IsNotExist(err) {
		return false, err
	}
	texts := map[string]string{}
	if err == nil {
		if err = json.Unmarshal(data, &texts); err != nil || texts == nil {
			return false, errors.New("invalid OCR metadata")
		}
	}
	for key, value := range assetsTexts {
		texts[key] = value
	}
	text := ""
	for key, value := range texts {
		if !assetTextPathMatches(key, oldPath) {
			continue
		}
		if exists && text != value {
			return true, errors.New("ocr_source_conflict")
		}
		text, exists = value, true
	}
	if !exists || newPath == "" || newPath == oldPath {
		return exists, nil
	}
	for key, value := range texts {
		if assetTextPathMatches(key, newPath) && value != text {
			return true, errors.New("ocr_target_conflict")
		}
	}
	if dryRun {
		return true, nil
	}
	backup, err := json.MarshalIndent(texts, "", "  ")
	if err != nil {
		return true, err
	}
	history := filepath.Join(historyDir, "assets", "ocr-texts.json")
	if err = os.MkdirAll(filepath.Dir(history), 0755); err != nil {
		return true, err
	}
	if err = gulu.File.WriteFileSafer(history, backup, 0644); err != nil {
		return true, err
	}
	texts[(&url.URL{Path: newPath}).EscapedPath()] = text
	data, err = json.MarshalIndent(texts, "", "  ")
	if err != nil {
		return true, err
	}
	if err = filelock.WriteFile(abs, data); err != nil {
		return true, err
	}
	assetsTexts = texts
	assetsTextsChanged.Store(false)
	return true, nil
}

func assetTextPathMatches(key, assetPath string) bool {
	if key == assetPath {
		return true
	}
	parsed, err := url.Parse(key)
	return err == nil && !parsed.IsAbs() && parsed.Host == "" && strings.TrimPrefix(parsed.Path, "/") == assetPath
}
