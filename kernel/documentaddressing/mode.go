// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package documentaddressing validates document title sources and legacy path compatibility.
package documentaddressing

import (
	"errors"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
)

const ConfigPath = ".siyuan/conf.json"

// FloorPath is a retired notebook record. Existing files are left untouched.
const FloorPath = ".siyuan/document-addressing.json"

var (
	ErrInvalid = errors.New("invalid document addressing metadata")
)

// BoxMode reports the fixed addressing version without reading or changing any files.
// Notebook existence and source authentication belong to the caller's access boundary.
func BoxMode(boxID string) (int, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return 0, ErrInvalid
	}
	return DefaultMode(), nil
}

// CheckBox 仅校验笔记本 ID 格式，不检查目录、源格式或访问权限。
func CheckBox(boxID string) error {
	_, err := BoxMode(boxID)
	return err
}

// CheckPaths retains canonical replacement-path validation independently of retired modes.
// Source Spec and authenticated ciphertext checks are performed by the caller before applying a batch.
func CheckPaths(upserts, removes []string) error {
	for _, group := range [][]string{upserts, removes} {
		for _, name := range group {
			if strings.Contains(name, "\\") {
				return ErrInvalid
			}
			name = strings.TrimPrefix(filepath.ToSlash(name), "/")
			if name == "" || name == "." || name == ".." || strings.HasPrefix(name, "../") ||
				filepath.IsAbs(name) || filepath.VolumeName(name) != "" ||
				filepath.ToSlash(filepath.Clean(name)) != name || strings.Contains(name, "\\") {
				return ErrInvalid
			}
			boxID, relative, found := strings.Cut(name, "/")
			if found && ast.IsNodeIDPattern(strings.ToLower(boxID)) {
				metadata := strings.ToLower(relative)
				if boxID != strings.ToLower(boxID) ||
					((metadata == ConfigPath || metadata == FloorPath) && relative != metadata) {
					return ErrInvalid
				}
			}
		}
	}
	return nil
}

// DefaultMode is the fixed diagnostic addressing version, not a notebook setting.
func DefaultMode() int { return 2 }
