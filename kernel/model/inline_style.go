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
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
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
	inlineStylesLock            sync.Mutex
	workspaceAVPaletteCache     *InlineStyleAV
	workspaceAVPaletteCachePath string
	inlineStyleColorPattern     = regexp.MustCompile(`^#[0-9a-f]{6}$`)
	builtinStyleOrder           = map[string]int{
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
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Hidden bool              `json:"hidden,omitempty"`
	Light  *InlineStyleTheme `json:"light"`
	Dark   *InlineStyleTheme `json:"dark"`
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

type InlineStyleOrder struct {
	Color           []string `json:"color"`
	BackgroundColor []string `json:"backgroundColor"`
	Style1          []string `json:"style1"`
}

type InlineStyleAV struct {
	Colors []*av.AttributeViewCustomColor `json:"colors"`
	Order  []string                       `json:"order"`
}

type WorkspaceAVBuiltinColorUpdate struct {
	Index      int               `json:"index"`
	Customized bool              `json:"customized"`
	Light      *InlineStyleTheme `json:"light"`
	Dark       *InlineStyleTheme `json:"dark"`
	Hidden     bool              `json:"hidden"`
}

type WorkspaceAVPaletteUpdate struct {
	Colors        []*av.AttributeViewCustomColor   `json:"colors"`
	Order         []string                         `json:"order"`
	BuiltinColors []*WorkspaceAVBuiltinColorUpdate `json:"builtinColors"`
}

type InlineStyles struct {
	Version int                 `json:"version"`
	Styles  []*InlineStyle      `json:"styles"`
	Builtin *InlineStyleBuiltin `json:"builtin"`
	Order   *InlineStyleOrder   `json:"order"`
	AV      *InlineStyleAV      `json:"av"`
}

func GetInlineStyles() (ret *InlineStyles, err error) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()
	ret, err = loadInlineStyles()
	if err == nil {
		cacheWorkspaceAVPalette(ret.AV)
	}
	return
}

func SetInlineStyles(styles []*InlineStyle) (ret *InlineStyles, changed bool, err error) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()

	current, err := loadInlineStyles()
	if err != nil {
		return nil, false, err
	}
	currentAV := current.AV
	current.Styles = styles
	return setInlineStylesData(current, currentAV)
}

// SetInlineStylesData 全量保存行级样式和内置颜色配置。
func SetInlineStylesData(styles *InlineStyles) (ret *InlineStyles, changed bool, err error) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()

	current, err := loadInlineStyles()
	if err != nil {
		return nil, false, err
	}
	return setInlineStylesData(styles, current.AV)
}

// SetWorkspaceAVPalette 只更新数据库颜色配置，保留其他窗口可能同时修改的行级样式设置。
func SetWorkspaceAVPalette(update *WorkspaceAVPaletteUpdate) (ret *InlineStyles, changed bool, err error) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()

	if update == nil {
		return nil, false, errors.New("workspace attribute view palette update must not be null")
	}
	current, err := loadInlineStyles()
	if err != nil {
		return nil, false, err
	}
	currentAV := current.AV
	current.AV = &InlineStyleAV{Colors: update.Colors, Order: update.Order}
	updatedIndexes := map[int]struct{}{}
	for _, patch := range update.BuiltinColors {
		if patch == nil {
			return nil, false, errors.New("workspace attribute view builtin color update must not be null")
		}
		if patch.Index < minBuiltinColorIndex || neutralAVColorIndex < patch.Index {
			return nil, false, fmt.Errorf("builtin color index [%d] must be between %d and %d", patch.Index,
				minBuiltinColorIndex, neutralAVColorIndex)
		}
		if _, duplicated := updatedIndexes[patch.Index]; duplicated {
			return nil, false, fmt.Errorf("duplicate workspace attribute view builtin color update [%d]", patch.Index)
		}
		updatedIndexes[patch.Index] = struct{}{}
		filtered := current.Builtin.Colors[:0]
		for _, color := range current.Builtin.Colors {
			if color.Index != patch.Index {
				filtered = append(filtered, color)
			}
		}
		current.Builtin.Colors = filtered
		if patch.Customized {
			current.Builtin.Colors = append(current.Builtin.Colors, &InlineStyleBuiltinColor{
				Index: patch.Index,
				Light: patch.Light,
				Dark:  patch.Dark,
			})
		}
		filteredHidden := current.Builtin.Hidden.AV[:0]
		for _, index := range current.Builtin.Hidden.AV {
			if index != patch.Index {
				filteredHidden = append(filteredHidden, index)
			}
		}
		current.Builtin.Hidden.AV = filteredHidden
		if patch.Hidden {
			current.Builtin.Hidden.AV = append(current.Builtin.Hidden.AV, patch.Index)
		}
	}
	return setInlineStylesData(current, currentAV)
}

func setInlineStylesData(styles *InlineStyles, currentAV *InlineStyleAV) (ret *InlineStyles, changed bool, err error) {
	if styles == nil {
		return nil, false, errors.New("inline styles must not be null")
	}
	if styles.Version != InlineStylesVersion {
		return nil, false, fmt.Errorf("unsupported inline styles version [%d]", styles.Version)
	}
	if currentAV == nil {
		currentAV = newEmptyInlineStyleAV()
	}

	normalizedStyles, err := normalizeInlineStyles(styles.Styles, true)
	if err != nil {
		return nil, false, err
	}
	normalizedBuiltin, err := normalizeInlineStyleBuiltin(styles.Builtin)
	if err != nil {
		return nil, false, err
	}
	normalizedAV, err := normalizeInlineStyleAV(styles.AV, true)
	if err != nil {
		return nil, false, err
	}
	ret = &InlineStyles{
		Version: InlineStylesVersion,
		Styles:  normalizedStyles,
		Builtin: normalizedBuiltin,
		Order:   normalizeInlineStyleOrder(styles.Order, normalizedStyles),
		AV:      normalizedAV,
	}
	changedCustomColorIndexes := changedAttributeViewCustomColorIndexes(currentAV.Colors, ret.AV.Colors)
	var customColorUsage map[string]map[int]struct{}
	if 0 < len(changedCustomColorIndexes) {
		removedIndexes := removedAttributeViewCustomColorIndexes(currentAV.Colors, ret.AV.Colors)
		customColorUsage, err = workspaceAttributeViewCustomColorUsage(0 < len(removedIndexes))
		if err != nil {
			return nil, false, err
		}
		for _, avID := range sortedAttributeViewUsageIDs(customColorUsage) {
			indexes := customColorUsage[avID]
			for index := range removedIndexes {
				if _, used := indexes[index]; used {
					return nil, false, fmt.Errorf("attribute view custom color [%d] is still in use by attribute view [%s]",
						index, avID)
				}
			}
		}
	}
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
		cacheWorkspaceAVPalette(ret.AV)
		return ret, false, nil
	}

	if err = os.MkdirAll(filepath.Dir(dataPath), 0755); err != nil {
		return nil, false, fmt.Errorf("create inline styles directory failed: %w", err)
	}
	if err = filelock.WriteFile(dataPath, data); err != nil {
		return nil, false, fmt.Errorf("write inline styles failed: %w", err)
	}
	cacheWorkspaceAVPalette(ret.AV)
	IncSync()
	for _, avID := range sortedAttributeViewUsageIDs(customColorUsage) {
		indexes := customColorUsage[avID]
		if intersectsCustomColorIndexes(indexes, changedCustomColorIndexes) {
			pushReloadAttrView(avID)
		}
	}
	return ret, true, nil
}

func inlineStylesPath() string {
	return filepath.Join(util.DataDir, "storage", "inline-styles.json")
}

func cacheWorkspaceAVPalette(palette *InlineStyleAV) {
	workspaceAVPaletteCache, _ = normalizeInlineStyleAV(palette, false)
	workspaceAVPaletteCachePath = inlineStylesPath()
}

func invalidateWorkspaceAVPaletteCache() {
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()
	workspaceAVPaletteCache = nil
	workspaceAVPaletteCachePath = ""
}

func changedAttributeViewCustomColorIndexes(oldColors, newColors []*av.AttributeViewCustomColor) map[int]struct{} {
	oldByIndex := attributeViewCustomColorsByIndex(oldColors)
	newByIndex := attributeViewCustomColorsByIndex(newColors)
	ret := map[int]struct{}{}
	for index, oldColor := range oldByIndex {
		newColor := newByIndex[index]
		if newColor == nil || oldColor.Light != newColor.Light || oldColor.Dark != newColor.Dark {
			ret[index] = struct{}{}
		}
	}
	for index := range newByIndex {
		if oldByIndex[index] == nil {
			ret[index] = struct{}{}
		}
	}
	return ret
}

func removedAttributeViewCustomColorIndexes(oldColors, newColors []*av.AttributeViewCustomColor) map[int]struct{} {
	newByIndex := attributeViewCustomColorsByIndex(newColors)
	ret := map[int]struct{}{}
	for index := range attributeViewCustomColorsByIndex(oldColors) {
		if newByIndex[index] == nil {
			ret[index] = struct{}{}
		}
	}
	return ret
}

func attributeViewCustomColorsByIndex(colors []*av.AttributeViewCustomColor) map[int]*av.AttributeViewCustomColor {
	ret := make(map[int]*av.AttributeViewCustomColor, len(colors))
	for _, color := range colors {
		if color != nil {
			ret[color.Index] = color
		}
	}
	return ret
}

func intersectsCustomColorIndexes(indexes, changed map[int]struct{}) bool {
	for index := range changed {
		if _, ok := indexes[index]; ok {
			return true
		}
	}
	return false
}

func sortedAttributeViewUsageIDs(usage map[string]map[int]struct{}) []string {
	ret := make([]string, 0, len(usage))
	for avID := range usage {
		ret = append(ret, avID)
	}
	sort.Strings(ret)
	return ret
}

func workspaceAttributeViewCustomColorUsage(strict bool) (ret map[string]map[int]struct{}, err error) {
	ret = map[string]map[int]struct{}{}
	var paths []string
	appendPaths := func(dir string) error {
		entries, readErr := os.ReadDir(dir)
		if os.IsNotExist(readErr) {
			return nil
		}
		if readErr != nil {
			return readErr
		}
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			avID := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
			if ast.IsNodeIDPattern(avID) {
				paths = append(paths, filepath.Join(dir, entry.Name()))
			}
		}
		return nil
	}
	if err = appendPaths(filepath.Join(util.DataDir, "storage", "av")); err != nil {
		if strict {
			return nil, fmt.Errorf("list attribute views failed: %w", err)
		}
		logging.LogWarnf("list attribute views for custom color refresh failed: %s", err)
	}
	entries, readErr := os.ReadDir(util.DataDir)
	if readErr != nil && !os.IsNotExist(readErr) {
		if strict {
			return nil, fmt.Errorf("list workspace data directory failed: %w", readErr)
		}
		logging.LogWarnf("list workspace data directory for custom color refresh failed: %s", readErr)
	}
	for _, entry := range entries {
		if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		if err = appendPaths(filepath.Join(util.DataDir, entry.Name(), "storage", "av")); err != nil {
			if strict {
				return nil, fmt.Errorf("list notebook attribute views [%s] failed: %w", entry.Name(), err)
			}
			logging.LogWarnf("list notebook attribute views [%s] for custom color refresh failed: %s",
				entry.Name(), err)
		}
	}
	sort.Strings(paths)
	for _, path := range paths {
		avID, indexes, readErr := av.ReadAttributeViewCustomColorUsageByPath(path)
		if readErr != nil {
			if strict {
				return nil, fmt.Errorf("read attribute view custom color usage [%s] failed: %w", avID, readErr)
			}
			logging.LogWarnf("read attribute view custom color usage [%s] for refresh failed: %s", avID, readErr)
			continue
		}
		used := ret[avID]
		if used == nil {
			used = map[int]struct{}{}
			ret[avID] = used
		}
		for _, index := range indexes {
			used[index] = struct{}{}
		}
	}
	return ret, nil
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
	ret.Order = normalizeInlineStyleOrder(ret.Order, ret.Styles)
	ret.AV, err = normalizeInlineStyleAV(ret.AV, false)
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
		Order:   defaultInlineStyleOrder(),
		AV:      newEmptyInlineStyleAV(),
	}
}

func newEmptyInlineStyleAV() *InlineStyleAV {
	return &InlineStyleAV{
		Colors: []*av.AttributeViewCustomColor{},
		Order:  av.DefaultAttributeViewColorOrder(nil),
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

func defaultBuiltinColorOrderKeys() []string {
	keys := make([]string, 0, maxBuiltinColorIndex)
	for index := minBuiltinColorIndex; index <= maxBuiltinColorIndex; index++ {
		keys = append(keys, strconv.Itoa(index))
	}
	return keys
}

func defaultInlineStyleOrder() *InlineStyleOrder {
	colorKeys := defaultBuiltinColorOrderKeys()
	return &InlineStyleOrder{
		Color:           append([]string{}, colorKeys...),
		BackgroundColor: append([]string{}, colorKeys...),
		Style1:          []string{"error", "warning", "info", "success"},
	}
}

func getInlineStyleKind(style *InlineStyle) string {
	if style == nil || style.Light == nil {
		return ""
	}
	hasColor := style.Light.Color != ""
	hasBackground := style.Light.BackgroundColor != ""
	if hasColor && hasBackground {
		return "style1"
	}
	if hasColor {
		return "color"
	}
	if hasBackground {
		return "backgroundColor"
	}
	return ""
}

func builtinOrderKeys(styleType string) []string {
	if styleType == "style1" {
		return []string{"error", "warning", "info", "success"}
	}
	return defaultBuiltinColorOrderKeys()
}

func customOrderKeys(styleType string, styles []*InlineStyle) []string {
	keys := make([]string, 0)
	for _, style := range styles {
		if getInlineStyleKind(style) == styleType {
			keys = append(keys, style.ID)
		}
	}
	return keys
}

func normalizeOrderKeys(saved []string, styleType string, styles []*InlineStyle) []string {
	builtinKeys := builtinOrderKeys(styleType)
	customKeys := customOrderKeys(styleType, styles)
	allowed := make(map[string]struct{}, len(builtinKeys)+len(customKeys))
	for _, key := range builtinKeys {
		allowed[key] = struct{}{}
	}
	for _, key := range customKeys {
		allowed[key] = struct{}{}
	}
	seen := make(map[string]struct{}, len(allowed))
	ret := make([]string, 0, len(allowed))
	for _, key := range saved {
		if _, ok := allowed[key]; !ok {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		ret = append(ret, key)
	}
	for _, key := range append(append([]string{}, builtinKeys...), customKeys...) {
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		ret = append(ret, key)
	}
	return ret
}

// normalizeInlineStyleOrder 保留已保存的混排顺序，并补上新增的内置色或自定义色。
func normalizeInlineStyleOrder(order *InlineStyleOrder, styles []*InlineStyle) *InlineStyleOrder {
	var color, backgroundColor, style1 []string
	if order != nil {
		color = order.Color
		backgroundColor = order.BackgroundColor
		style1 = order.Style1
	}
	return &InlineStyleOrder{
		Color:           normalizeOrderKeys(color, "color", styles),
		BackgroundColor: normalizeOrderKeys(backgroundColor, "backgroundColor", styles),
		Style1:          normalizeOrderKeys(style1, "style1", styles),
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
	ret := make([]int, 0, neutralAVColorIndex)
	for index := minBuiltinColorIndex; index <= neutralAVColorIndex; index++ {
		if _, ok := hidden[index]; !ok {
			ret = append(ret, index)
		}
	}
	if len(ret) == 0 {
		return []int{neutralAVColorIndex}
	}
	return ret
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

		ret = append(ret, &InlineStyle{ID: id, Name: name, Hidden: style.Hidden, Light: light, Dark: dark})
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
		if color.Index < minBuiltinColorIndex || neutralAVColorIndex < color.Index {
			return nil, fmt.Errorf("builtin color index [%d] must be between %d and %d", color.Index,
				minBuiltinColorIndex, neutralAVColorIndex)
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

func normalizeInlineStyleAV(palette *InlineStyleAV, strict bool) (ret *InlineStyleAV, err error) {
	ret = newEmptyInlineStyleAV()
	if palette == nil {
		return ret, nil
	}
	colors, err := av.NormalizeAttributeViewCustomColors(palette.Colors, strict)
	if err != nil {
		return nil, err
	}
	ret.Colors = colors
	ret.Order = av.NormalizeAttributeViewColorOrder(palette.Order, colors)
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
	maxIndex := maxBuiltinColorIndex
	if field == "av" {
		maxIndex = neutralAVColorIndex
	}
	for _, index := range indexes {
		if index < minBuiltinColorIndex || maxIndex < index {
			return nil, fmt.Errorf("hidden builtin %s index [%d] must be between %d and %d", field, index,
				minBuiltinColorIndex, maxIndex)
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

func init() {
	av.LoadWorkspacePalette = loadWorkspaceAVPalette
}

func loadWorkspaceAVPalette() (colors []*av.AttributeViewCustomColor, order []string) {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()
	if workspaceAVPaletteCache == nil || workspaceAVPaletteCachePath != inlineStylesPath() {
		styles, err := loadInlineStyles()
		if err != nil {
			return nil, nil
		}
		cacheWorkspaceAVPalette(styles.AV)
	}
	palette, err := normalizeInlineStyleAV(workspaceAVPaletteCache, false)
	if err != nil {
		return
	}
	return palette.Colors, palette.Order
}

func replaceWorkspaceAVPalette(colors []*av.AttributeViewCustomColor, order []string) error {
	waitForSyncingStorages()
	inlineStylesLock.Lock()
	defer inlineStylesLock.Unlock()
	styles, err := loadInlineStyles()
	if err != nil {
		return err
	}
	currentAV := styles.AV
	styles.AV = &InlineStyleAV{
		Colors: colors,
		Order:  av.NormalizeAttributeViewColorOrder(order, colors),
	}
	_, _, err = setInlineStylesData(styles, currentAV)
	return err
}
