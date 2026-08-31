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
