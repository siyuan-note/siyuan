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
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	InlineStylesVersion     = 2
	maxInlineStyles         = 64
	maxInlineStyleNameRunes = 64
	maxInlineStylesFileSize = 1024 * 1024
	inlineStylesRepoPath    = "/storage/inline-styles.json"
	minBuiltinColorIndex    = 1
	maxBuiltinColorIndex    = 13
	neutralAVColorIndex     = 14
)

var (
	inlineStylesLock        sync.Mutex
	inlineStyleColorPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)
	builtinStyleOrder       = map[string]int{
		"error":   0,
		"warning": 1,
		"info":    2,
		"success": 3,
	}
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

type InlineStyleBuiltinColor struct {
	Index int               `json:"index"`
	Light *InlineStyleTheme `json:"light"`
	Dark  *InlineStyleTheme `json:"dark"`
}

type InlineStyleBuiltinStyle struct {
	ID    string            `json:"id"`
	Light *InlineStyleTheme `json:"light"`
	Dark  *InlineStyleTheme `json:"dark"`
}

type InlineStyleBuiltinHidden struct {
	Color           []int    `json:"color"`
	BackgroundColor []int    `json:"backgroundColor"`
	Style1          []string `json:"style1"`
	AV              []int    `json:"av"`
}

type InlineStyleBuiltin struct {
	Colors []*InlineStyleBuiltinColor `json:"colors"`
	Styles []*InlineStyleBuiltinStyle `json:"styles"`
	Hidden *InlineStyleBuiltinHidden  `json:"hidden"`
}

type InlineStyles struct {
	Version int                 `json:"version"`
	Styles  []*InlineStyle      `json:"styles"`
	Builtin *InlineStyleBuiltin `json:"builtin"`
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

	current, err := loadInlineStyles()
	if err != nil {
		return nil, false, err
	}
	current.Styles = styles
	return setInlineStylesData(current)
}

// SetInlineStylesData 全量保存行级样式和内置颜色配置。
func SetInlineStylesData(styles *InlineStyles) (ret *InlineStyles, changed bool, err error) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()

	if _, err = loadInlineStyles(); err != nil {
		return nil, false, err
	}
	return setInlineStylesData(styles)
}

func setInlineStylesData(styles *InlineStyles) (ret *InlineStyles, changed bool, err error) {
	if styles == nil {
		return nil, false, errors.New("inline styles must not be null")
	}
	if styles.Version != InlineStylesVersion {
		return nil, false, fmt.Errorf("unsupported inline styles version [%d]", styles.Version)
	}

	normalizedStyles, err := normalizeInlineStyles(styles.Styles, true)
	if err != nil {
		return nil, false, err
	}
	normalizedBuiltin, err := normalizeInlineStyleBuiltin(styles.Builtin)
	if err != nil {
		return nil, false, err
	}
	ret = &InlineStyles{Version: InlineStylesVersion, Styles: normalizedStyles, Builtin: normalizedBuiltin}
	data, err := gulu.JSON.MarshalIndentJSON(ret, "", "  ")
	if err != nil {
		return nil, false, fmt.Errorf("marshal inline styles failed: %w", err)
	}
	if maxInlineStylesFileSize < len(data) {
		return nil, false, fmt.Errorf("inline styles file exceeds the %d byte limit", maxInlineStylesFileSize)
	}

	dataPath := inlineStylesPath()
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
	ret = newEmptyInlineStyles()
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
	if ret.Version != 1 && ret.Version != InlineStylesVersion {
		return nil, fmt.Errorf("unsupported inline styles version [%d]", ret.Version)
	}
	ret.Styles, err = normalizeInlineStyles(ret.Styles, false)
	if err != nil {
		return nil, fmt.Errorf("invalid inline styles data: %w", err)
	}
	ret.Builtin, err = normalizeInlineStyleBuiltin(ret.Builtin)
	if err != nil {
		return nil, fmt.Errorf("invalid inline styles data: %w", err)
	}
	ret.Version = InlineStylesVersion
	return ret, nil
}

func newEmptyInlineStyles() *InlineStyles {
	return &InlineStyles{
		Version: InlineStylesVersion,
		Styles:  []*InlineStyle{},
		Builtin: newEmptyInlineStyleBuiltin(),
	}
}

func newEmptyInlineStyleBuiltin() *InlineStyleBuiltin {
	return &InlineStyleBuiltin{
		Colors: []*InlineStyleBuiltinColor{},
		Styles: []*InlineStyleBuiltinStyle{},
		Hidden: &InlineStyleBuiltinHidden{
			Color:           []int{},
			BackgroundColor: []int{},
			Style1:          []string{},
			AV:              []int{},
		},
	}
}

func getVisibleAVBuiltinColorIndexes() []int {
	styles, err := GetInlineStyles()
	if err != nil {
		return []int{neutralAVColorIndex}
	}
	hidden := map[int]struct{}{}
	for _, index := range styles.Builtin.Hidden.AV {
		hidden[index] = struct{}{}
	}
	ret := make([]int, 0, maxBuiltinColorIndex+1)
	for index := minBuiltinColorIndex; index <= maxBuiltinColorIndex; index++ {
		if _, ok := hidden[index]; !ok {
			ret = append(ret, index)
		}
	}
	return append(ret, neutralAVColorIndex)
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

func normalizeInlineStyleBuiltin(builtin *InlineStyleBuiltin) (ret *InlineStyleBuiltin, err error) {
	ret = newEmptyInlineStyleBuiltin()
	if builtin == nil {
		return ret, nil
	}

	colorIndexes := make(map[int]struct{}, len(builtin.Colors))
	for _, color := range builtin.Colors {
		if color == nil {
			return nil, errors.New("builtin color must not be null")
		}
		if color.Index < minBuiltinColorIndex || maxBuiltinColorIndex < color.Index {
			return nil, fmt.Errorf("builtin color index [%d] must be between %d and %d", color.Index,
				minBuiltinColorIndex, maxBuiltinColorIndex)
		}
		if _, exists := colorIndexes[color.Index]; exists {
			return nil, fmt.Errorf("duplicate builtin color index [%d]", color.Index)
		}
		colorIndexes[color.Index] = struct{}{}

		light, dark, err := normalizeInlineStyleThemePair(color.Light, color.Dark, fmt.Sprintf("builtin color [%d]", color.Index))
		if err != nil {
			return nil, err
		}
		ret.Colors = append(ret.Colors, &InlineStyleBuiltinColor{Index: color.Index, Light: light, Dark: dark})
	}
	sort.Slice(ret.Colors, func(i, j int) bool {
		return ret.Colors[i].Index < ret.Colors[j].Index
	})

	styleIDs := make(map[string]struct{}, len(builtin.Styles))
	for _, style := range builtin.Styles {
		if style == nil {
			return nil, errors.New("builtin style must not be null")
		}
		id := strings.TrimSpace(style.ID)
		if _, valid := builtinStyleOrder[id]; !valid {
			return nil, fmt.Errorf("invalid builtin style ID [%s]", id)
		}
		if _, exists := styleIDs[id]; exists {
			return nil, fmt.Errorf("duplicate builtin style ID [%s]", id)
		}
		styleIDs[id] = struct{}{}

		light, dark, err := normalizeInlineStyleThemePair(style.Light, style.Dark, "builtin style ["+id+"]")
		if err != nil {
			return nil, err
		}
		ret.Styles = append(ret.Styles, &InlineStyleBuiltinStyle{ID: id, Light: light, Dark: dark})
	}
	sort.Slice(ret.Styles, func(i, j int) bool {
		return builtinStyleOrder[ret.Styles[i].ID] < builtinStyleOrder[ret.Styles[j].ID]
	})

	if builtin.Hidden != nil {
		if ret.Hidden.Color, err = normalizeHiddenBuiltinColorIndexes(builtin.Hidden.Color, "color"); err != nil {
			return nil, err
		}
		if ret.Hidden.BackgroundColor, err = normalizeHiddenBuiltinColorIndexes(builtin.Hidden.BackgroundColor,
			"backgroundColor"); err != nil {
			return nil, err
		}
		if ret.Hidden.Style1, err = normalizeHiddenBuiltinStyleIDs(builtin.Hidden.Style1); err != nil {
			return nil, err
		}
		if ret.Hidden.AV, err = normalizeHiddenBuiltinColorIndexes(builtin.Hidden.AV, "av"); err != nil {
			return nil, err
		}
	}
	return ret, nil
}

func normalizeInlineStyleThemePair(light, dark *InlineStyleTheme, description string) (normalizedLight,
	normalizedDark *InlineStyleTheme, err error) {
	if light == nil || dark == nil {
		return nil, nil, fmt.Errorf("%s must define light and dark themes", description)
	}
	if normalizedLight, err = normalizeInlineStyleTheme(light); err != nil {
		return nil, nil, fmt.Errorf("invalid light theme of %s: %w", description, err)
	}
	if normalizedDark, err = normalizeInlineStyleTheme(dark); err != nil {
		return nil, nil, fmt.Errorf("invalid dark theme of %s: %w", description, err)
	}
	lightColor, lightBackground := normalizedLight.Color != "", normalizedLight.BackgroundColor != ""
	darkColor, darkBackground := normalizedDark.Color != "", normalizedDark.BackgroundColor != ""
	if !lightColor && !lightBackground {
		return nil, nil, fmt.Errorf("%s must define color or backgroundColor", description)
	}
	if lightColor != darkColor || lightBackground != darkBackground {
		return nil, nil, fmt.Errorf("%s must use the same fields in light and dark themes", description)
	}
	return normalizedLight, normalizedDark, nil
}

func normalizeHiddenBuiltinColorIndexes(indexes []int, field string) (ret []int, err error) {
	ret = make([]int, 0, len(indexes))
	seen := make(map[int]struct{}, len(indexes))
	for _, index := range indexes {
		if index < minBuiltinColorIndex || maxBuiltinColorIndex < index {
			return nil, fmt.Errorf("hidden builtin %s index [%d] must be between %d and %d", field, index,
				minBuiltinColorIndex, maxBuiltinColorIndex)
		}
		if _, exists := seen[index]; exists {
			continue
		}
		seen[index] = struct{}{}
		ret = append(ret, index)
	}
	sort.Ints(ret)
	return ret, nil
}

func normalizeHiddenBuiltinStyleIDs(ids []string) (ret []string, err error) {
	seen := make(map[string]struct{}, len(ids))
	for _, value := range ids {
		id := strings.TrimSpace(value)
		if _, valid := builtinStyleOrder[id]; !valid {
			return nil, fmt.Errorf("invalid hidden builtin style ID [%s]", id)
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ret = append(ret, id)
	}
	sort.Slice(ret, func(i, j int) bool {
		return builtinStyleOrder[ret[i]] < builtinStyleOrder[ret[j]]
	})
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
