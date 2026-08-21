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
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	InlineStylesVersion     = 1
	maxInlineStyles         = 64
	maxInlineStyleNameRunes = 64
	maxInlineStylesFileSize = 1024 * 1024
	inlineStylesRepoPath    = "/storage/inline-styles.json"
)

var (
	inlineStylesLock        sync.Mutex
	inlineStyleColorPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)
)

type InlineStyleTheme struct {
	Color           string `json:"color,omitempty"`
	BackgroundColor string `json:"backgroundColor,omitempty"`
}

type InlineStyle struct {
	ID    string            `json:"id"`
	Name  string            `json:"name"`
	Light *InlineStyleTheme `json:"light"`
	Dark  *InlineStyleTheme `json:"dark"`
}

type InlineStyles struct {
	Version int            `json:"version"`
	Styles  []*InlineStyle `json:"styles"`
}

func GetInlineStyles() (ret *InlineStyles, err error) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()
	return loadInlineStyles()
}

func SetInlineStyles(styles []*InlineStyle) (ret *InlineStyles, changed bool, err error) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()

	dataPath := inlineStylesPath()
	if _, err = loadInlineStyles(); err != nil {
		return nil, false, err
	}

	normalized, err := normalizeInlineStyles(styles, true)
	if err != nil {
		return nil, false, err
	}
	ret = &InlineStyles{Version: InlineStylesVersion, Styles: normalized}
	data, err := gulu.JSON.MarshalIndentJSON(ret, "", "  ")
	if err != nil {
		return nil, false, fmt.Errorf("marshal inline styles failed: %w", err)
	}
	if maxInlineStylesFileSize < len(data) {
		return nil, false, fmt.Errorf("inline styles file exceeds the %d byte limit", maxInlineStylesFileSize)
	}

	oldData, readErr := filelock.ReadFile(dataPath)
	if readErr != nil && !os.IsNotExist(readErr) {
		return nil, false, fmt.Errorf("read inline styles failed: %w", readErr)
	}
	if bytes.Equal(oldData, data) {
		return ret, false, nil
	}

	if err = os.MkdirAll(filepath.Dir(dataPath), 0755); err != nil {
		return nil, false, fmt.Errorf("create inline styles directory failed: %w", err)
	}
	if err = filelock.WriteFile(dataPath, data); err != nil {
		return nil, false, fmt.Errorf("write inline styles failed: %w", err)
	}
	IncSync()
	return ret, true, nil
}

func inlineStylesPath() string {
	return filepath.Join(util.DataDir, "storage", "inline-styles.json")
}

func isInlineStylesRepoPath(filePath string) bool {
	return filePath == inlineStylesRepoPath
}

func loadInlineStyles() (ret *InlineStyles, err error) {
	ret = &InlineStyles{Version: InlineStylesVersion, Styles: []*InlineStyle{}}
	data, err := filelock.ReadFile(inlineStylesPath())
	if os.IsNotExist(err) {
		return ret, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read inline styles failed: %w", err)
	}
	if maxInlineStylesFileSize < len(data) {
		return nil, fmt.Errorf("inline styles file exceeds the %d byte limit", maxInlineStylesFileSize)
	}
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		return nil, fmt.Errorf("unmarshal inline styles failed: %w", err)
	}
	if ret.Version != InlineStylesVersion {
		return nil, fmt.Errorf("unsupported inline styles version [%d]", ret.Version)
	}
	ret.Styles, err = normalizeInlineStyles(ret.Styles, false)
	if err != nil {
		return nil, fmt.Errorf("invalid inline styles data: %w", err)
	}
	return ret, nil
}

func normalizeInlineStyles(styles []*InlineStyle, generateIDs bool) (ret []*InlineStyle, err error) {
	if maxInlineStyles < len(styles) {
		return nil, fmt.Errorf("inline styles count exceeds the %d item limit", maxInlineStyles)
	}
	ret = make([]*InlineStyle, 0, len(styles))
	ids := make(map[string]struct{}, len(styles))
	for _, style := range styles {
		if style == nil {
			return nil, errors.New("inline style must not be null")
		}

		id := strings.TrimSpace(style.ID)
		if id == "" && generateIDs {
			for {
				id = ast.NewNodeID()
				if _, exists := ids[id]; !exists {
					break
				}
			}
		}
		if !ast.IsNodeIDPattern(id) {
			return nil, fmt.Errorf("invalid inline style ID [%s]", id)
		}
		if _, exists := ids[id]; exists {
			return nil, fmt.Errorf("duplicate inline style ID [%s]", id)
		}
		ids[id] = struct{}{}

		name := strings.TrimSpace(style.Name)
		if name == "" {
			return nil, errors.New("inline style name must not be empty")
		}
		if maxInlineStyleNameRunes < utf8.RuneCountInString(name) {
			return nil, fmt.Errorf("inline style name exceeds the %d character limit", maxInlineStyleNameRunes)
		}
		if style.Light == nil || style.Dark == nil {
			return nil, fmt.Errorf("inline style [%s] must define light and dark themes", id)
		}

		light, err := normalizeInlineStyleTheme(style.Light)
		if err != nil {
			return nil, fmt.Errorf("invalid light theme of inline style [%s]: %w", id, err)
		}
		dark, err := normalizeInlineStyleTheme(style.Dark)
		if err != nil {
			return nil, fmt.Errorf("invalid dark theme of inline style [%s]: %w", id, err)
		}
		lightColor, lightBackground := light.Color != "", light.BackgroundColor != ""
		darkColor, darkBackground := dark.Color != "", dark.BackgroundColor != ""
		if !lightColor && !lightBackground {
			return nil, fmt.Errorf("inline style [%s] must define color or backgroundColor", id)
		}
		if lightColor != darkColor || lightBackground != darkBackground {
			return nil, fmt.Errorf("inline style [%s] must use the same fields in light and dark themes", id)
		}

		ret = append(ret, &InlineStyle{ID: id, Name: name, Light: light, Dark: dark})
	}
	return ret, nil
}

func normalizeInlineStyleTheme(theme *InlineStyleTheme) (ret *InlineStyleTheme, err error) {
	ret = &InlineStyleTheme{}
	if ret.Color, err = normalizeInlineStyleColor(theme.Color); err != nil {
		return nil, fmt.Errorf("invalid color: %w", err)
	}
	if ret.BackgroundColor, err = normalizeInlineStyleColor(theme.BackgroundColor); err != nil {
		return nil, fmt.Errorf("invalid backgroundColor: %w", err)
	}
	return ret, nil
}

func normalizeInlineStyleColor(color string) (ret string, err error) {
	ret = strings.ToLower(strings.TrimSpace(color))
	if ret == "" {
		return ret, nil
	}
	if !inlineStyleColorPattern.MatchString(ret) {
		return "", fmt.Errorf("color [%s] must use #RRGGBB format", color)
	}
	return ret, nil
}
