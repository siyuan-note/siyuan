// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
)

const pandocDocxFilterName = "siyuan-docx-filter.lua"

//go:embed pandoc_docx_filter.lua
var pandocDocxFilter []byte

func writePandocDocxFilter(dir string) (string, error) {
	filterPath := filepath.Join(dir, pandocDocxFilterName)
	if err := os.WriteFile(filterPath, pandocDocxFilter, 0600); err != nil {
		return "", fmt.Errorf("write pandoc docx filter: %w", err)
	}
	return filterPath, nil
}

func appendBuiltinPandocDocxFilter(args []string, filterPath string) []string {
	return append(args, "--lua-filter", filterPath)
}
