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
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	bootAppearanceSchemaVersion = 1
	bootAppearanceDirName       = "boot-appearances"
	bootAppearanceConfigName    = "boot-appearance.json"
	bootAppearanceManifestName  = "boot.json"

	maxBootAppearanceManifestSize = 200 * 1024
	maxBootAppearanceStyleSize    = 200 * 1024
	maxBootAppearanceImageSize    = 5 * 1024 * 1024
	maxBootAppearanceVideoSize    = 20 * 1024 * 1024
	maxBootAppearanceTotalSize    = 50 * 1024 * 1024
	maxBootAppearanceLayers       = 8
	maxBootAppearanceEntries      = 256
	maxBootAppearancePathDepth    = 16
	maxBootAppearancePathLength   = 512
)

var (
	ErrBootAppearanceNotFound       = errors.New("boot appearance not found")
	ErrBootAppearanceAssetForbidden = errors.New("boot appearance asset forbidden")

	bootAppearanceIDPattern    = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	bootAppearanceColorPattern = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)
	bootAppearanceConfLock     sync.RWMutex
)

// BootAppearanceSelection 表示当前工作空间选择的启动页外观。
type BootAppearanceSelection struct {
	SchemaVersion int    `json:"schemaVersion"`
	Provider      string `json:"provider"`
	Appearance    string `json:"appearance"`
}

// BootAppearance 描述已经校验且可安全交给启动页渲染的外观。
type BootAppearance struct {
	Enabled         bool                      `json:"enabled"`
	Provider        string                    `json:"provider,omitempty"`
	Appearance      string                    `json:"appearance,omitempty"`
	DisplayName     string                    `json:"displayName,omitempty"`
	Frontends       []string                  `json:"frontends,omitempty"`
	BackgroundColor string                    `json:"backgroundColor,omitempty"`
	Style           string                    `json:"style,omitempty"`
	Layers          []*BootAppearanceLayer    `json:"layers,omitempty"`
	OfficialUI      *BootAppearanceOfficialUI `json:"officialUI,omitempty"`
}

// BootAppearanceLayer 描述启动页外观中的一个图片或视频图层。
type BootAppearanceLayer struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Src      string `json:"src"`
	Poster   string `json:"poster,omitempty"`
	Fit      string `json:"fit,omitempty"`
	Position string `json:"position,omitempty"`
}

// BootAppearanceOfficialUI 描述官方启动页控件允许调整的有限外观字段。
type BootAppearanceOfficialUI struct {
	ShowLogo      bool   `json:"showLogo"`
	ShowDetails   bool   `json:"showDetails"`
	TextColor     string `json:"textColor,omitempty"`
	ProgressColor string `json:"progressColor,omitempty"`
	TrackColor    string `json:"trackColor,omitempty"`
}

type bootAppearanceManifest struct {
	SchemaVersion   int                              `json:"schemaVersion"`
	ID              string                           `json:"id"`
	DisplayName     map[string]string                `json:"displayName"`
	Frontends       []string                         `json:"frontends"`
	BackgroundColor string                           `json:"backgroundColor"`
	Style           string                           `json:"style"`
	Layers          []*bootAppearanceManifestLayer   `json:"layers"`
	OfficialUI      bootAppearanceManifestOfficialUI `json:"officialUI"`
}

type bootAppearanceManifestLayer struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Src      string `json:"src"`
	Poster   string `json:"poster"`
	Fit      string `json:"fit"`
	Position string `json:"position"`
}

type bootAppearanceManifestOfficialUI struct {
	ShowLogo      *bool  `json:"showLogo"`
	ShowDetails   *bool  `json:"showDetails"`
	TextColor     string `json:"textColor"`
	ProgressColor string `json:"progressColor"`
	TrackColor    string `json:"trackColor"`
}

// GetBootAppearances 扫描所有已安装插件声明的启动页外观。
func GetBootAppearances() (ret []*BootAppearance) {
	ret = []*BootAppearance{}
	pluginsDir := filepath.Join(util.DataDir, "plugins")
	dirs, err := os.ReadDir(pluginsDir)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogWarnf("read boot appearance providers failed: %s", err)
		}
		return
	}

	for _, dir := range dirs {
		if !dir.IsDir() || dir.Type()&os.ModeSymlink != 0 || strings.HasPrefix(dir.Name(), ".siyuan-package-install-") {
			continue
		}
		provider := dir.Name()
		pluginDir := filepath.Join(pluginsDir, provider)
		pluginJSONPath := filepath.Join(pluginDir, "plugin.json")
		if pathErr := ensureBootAppearancePathHasNoSymlink(pluginDir, pluginJSONPath); pathErr != nil {
			continue
		}
		pkg, parseErr := bazaar.ParsePackageJSON(pluginJSONPath)
		if parseErr != nil || !bazaar.IsValidInstalledPackage(pkg, provider) {
			continue
		}

		seen := map[string]bool{}
		for _, appearanceID := range pkg.BootAppearances {
			if seen[appearanceID] {
				continue
			}
			seen[appearanceID] = true
			appearance, loadErr := loadBootAppearance(pluginDir, pkg, appearanceID)
			if loadErr != nil {
				logging.LogWarnf("skip invalid boot appearance [%s/%s]: %s", provider, appearanceID, loadErr)
				continue
			}
			ret = append(ret, appearance)
		}
	}

	sort.Slice(ret, func(i, j int) bool {
		if ret[i].Provider == ret[j].Provider {
			return ret[i].Appearance < ret[j].Appearance
		}
		return ret[i].Provider < ret[j].Provider
	})
	return
}

// GetBootAppearanceSelection 读取当前启动页外观选择，配置异常时返回默认选择。
func GetBootAppearanceSelection() BootAppearanceSelection {
	selection, _, err := loadSelectedBootAppearance()
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogWarnf("load boot appearance selection failed: %s", err)
		}
		return defaultBootAppearanceSelection()
	}
	return selection
}

// GetBootAppearance 返回当前可用的启动页外观，任何异常和安全模式下均回退默认。
func GetBootAppearance() *BootAppearance {
	if util.SafeMode {
		return &BootAppearance{Enabled: false}
	}
	selection, appearance, err := loadSelectedBootAppearance()
	if err != nil {
		return &BootAppearance{Enabled: false}
	}
	if selection.Provider == "" || selection.Appearance == "" {
		return &BootAppearance{Enabled: false}
	}
	return appearance
}

// SetBootAppearance 校验并原子持久化启动页外观选择，两项均为空表示恢复默认。
func SetBootAppearance(provider, appearanceID string) (ret BootAppearanceSelection, err error) {
	if util.ReadOnly {
		return defaultBootAppearanceSelection(), errors.New("read-only mode")
	}
	provider = strings.TrimSpace(provider)
	appearanceID = strings.TrimSpace(appearanceID)
	ret = defaultBootAppearanceSelection()
	if (provider == "") != (appearanceID == "") {
		err = errors.New("provider and appearance must both be empty or non-empty")
		return
	}
	if provider != "" {
		if !bazaar.IsValidPackageName(provider) || !isValidBootAppearanceID(appearanceID) {
			err = ErrBootAppearanceNotFound
			return
		}
		if _, resolveErr := getBootAppearanceByID(provider, appearanceID); resolveErr != nil {
			err = ErrBootAppearanceNotFound
			return
		}
		ret.Provider, ret.Appearance = provider, appearanceID
	}

	data, err := gulu.JSON.MarshalIndentJSON(ret, "", "\t")
	if err != nil {
		return ret, err
	}
	bootAppearanceConfLock.Lock()
	defer bootAppearanceConfLock.Unlock()
	if err = os.MkdirAll(util.ConfDir, 0755); err != nil {
		return ret, err
	}
	err = filelock.WriteFile(filepath.Join(util.ConfDir, bootAppearanceConfigName), data)
	return
}

// ResolveBootAppearanceAsset 校验并解析当前启动页外观中的静态资源，不重复扫描已经在清单请求中校验的整个外观包。
func ResolveBootAppearanceAsset(provider, appearanceID, relativePath string) (filePath, contentType string, err error) {
	if util.SafeMode {
		err = ErrBootAppearanceNotFound
		return
	}
	selection, selectionErr := loadBootAppearanceSelection()
	if selectionErr != nil {
		err = ErrBootAppearanceNotFound
		return
	}
	if selection.Provider == "" || selection.Appearance == "" {
		err = ErrBootAppearanceNotFound
		return
	}
	if provider != selection.Provider || appearanceID != selection.Appearance {
		err = ErrBootAppearanceAssetForbidden
		return
	}

	pluginDir := filepath.Join(util.DataDir, "plugins", provider)
	pluginInfo, statErr := os.Lstat(pluginDir)
	if statErr != nil || !pluginInfo.IsDir() || pluginInfo.Mode()&os.ModeSymlink != 0 {
		err = ErrBootAppearanceNotFound
		return
	}

	appearanceDir := filepath.Join(pluginDir, bootAppearanceDirName, appearanceID)
	filePath, contentType, err = validateBootAppearanceResource(pluginDir, appearanceDir, relativePath, "")
	return
}

func loadBootAppearanceSelection() (ret BootAppearanceSelection, err error) {
	ret = defaultBootAppearanceSelection()
	bootAppearanceConfLock.RLock()
	defer bootAppearanceConfLock.RUnlock()
	data, err := filelock.ReadFile(filepath.Join(util.ConfDir, bootAppearanceConfigName))
	if err != nil {
		return ret, err
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		return ret, err
	}
	if ret.SchemaVersion != bootAppearanceSchemaVersion || (ret.Provider == "") != (ret.Appearance == "") {
		return defaultBootAppearanceSelection(), errors.New("invalid boot appearance selection")
	}
	if ret.Provider != "" && (!bazaar.IsValidPackageName(ret.Provider) || !isValidBootAppearanceID(ret.Appearance)) {
		return defaultBootAppearanceSelection(), errors.New("invalid boot appearance selection")
	}
	return
}

func defaultBootAppearanceSelection() BootAppearanceSelection {
	return BootAppearanceSelection{SchemaVersion: bootAppearanceSchemaVersion}
}

func loadSelectedBootAppearance() (selection BootAppearanceSelection, appearance *BootAppearance, err error) {
	selection, err = loadBootAppearanceSelection()
	if err != nil || selection.Provider == "" {
		return
	}
	appearance, err = getBootAppearanceByID(selection.Provider, selection.Appearance)
	if err != nil {
		logging.LogWarnf("selected boot appearance is invalid [provider=%s, appearance=%s, reason=%s], reset to default",
			selection.Provider, selection.Appearance, bootAppearanceLogReason(err))
		clearBootAppearanceSelectionIfMatches(selection)
		selection = defaultBootAppearanceSelection()
		appearance = nil
		err = nil
	}
	return
}

func getBootAppearanceByID(provider, appearanceID string) (ret *BootAppearance, err error) {
	if !bazaar.IsValidPackageName(provider) || !isValidBootAppearanceID(appearanceID) {
		return nil, ErrBootAppearanceNotFound
	}
	pluginDir := filepath.Join(util.DataDir, "plugins", provider)
	pluginInfo, statErr := os.Lstat(pluginDir)
	if statErr != nil || !pluginInfo.IsDir() || pluginInfo.Mode()&os.ModeSymlink != 0 {
		return nil, ErrBootAppearanceNotFound
	}
	pluginJSONPath := filepath.Join(pluginDir, "plugin.json")
	if err = ensureBootAppearancePathHasNoSymlink(pluginDir, pluginJSONPath); err != nil {
		return nil, ErrBootAppearanceNotFound
	}
	pkg, parseErr := bazaar.ParsePackageJSON(pluginJSONPath)
	if parseErr != nil || !bazaar.IsValidInstalledPackage(pkg, provider) {
		return nil, ErrBootAppearanceNotFound
	}
	found := false
	for _, declaredID := range pkg.BootAppearances {
		if declaredID == appearanceID {
			found = true
			break
		}
	}
	if !found {
		return nil, ErrBootAppearanceNotFound
	}
	return loadBootAppearance(pluginDir, pkg, appearanceID)
}

func clearBootAppearanceSelectionIfMatches(expected BootAppearanceSelection) {
	if util.ReadOnly {
		return
	}
	bootAppearanceConfLock.Lock()
	defer bootAppearanceConfLock.Unlock()
	configPath := filepath.Join(util.ConfDir, bootAppearanceConfigName)
	data, err := filelock.ReadFile(configPath)
	if err != nil {
		return
	}
	current := defaultBootAppearanceSelection()
	if err = gulu.JSON.UnmarshalJSON(data, &current); err != nil || current != expected {
		return
	}
	data, err = gulu.JSON.MarshalIndentJSON(defaultBootAppearanceSelection(), "", "\t")
	if err != nil {
		return
	}
	if err = filelock.WriteFile(configPath, data); err != nil {
		logging.LogWarnf("clear invalid boot appearance selection failed: %s", err)
	}
}

func loadBootAppearance(pluginDir string, pkg *bazaar.Package, appearanceID string) (ret *BootAppearance, err error) {
	if !isValidBootAppearanceID(appearanceID) {
		err = errors.New("invalid appearance ID")
		return
	}
	appearanceDir := filepath.Join(pluginDir, bootAppearanceDirName, appearanceID)
	if err = validateBootAppearancePackage(pluginDir, appearanceDir); err != nil {
		return
	}
	manifestPath, _, resolveErr := validateBootAppearanceResource(pluginDir, appearanceDir, bootAppearanceManifestName, "manifest")
	if resolveErr != nil {
		err = resolveErr
		return
	}
	data, readErr := filelock.ReadFile(manifestPath)
	if readErr != nil {
		err = readErr
		return
	}
	manifest := &bootAppearanceManifest{}
	if err = gulu.JSON.UnmarshalJSON(data, manifest); err != nil {
		return
	}
	if manifest.SchemaVersion != bootAppearanceSchemaVersion || manifest.ID != appearanceID {
		err = errors.New("unsupported schema version or mismatched appearance ID")
		return
	}
	if err = validateBootAppearanceDisplayName(manifest.DisplayName); err != nil {
		return
	}
	frontends, frontendErr := normalizeBootAppearanceFrontends(manifest.Frontends, pkg.Frontends)
	if frontendErr != nil {
		err = frontendErr
		return
	}
	if err = validateOptionalBootAppearanceColor(manifest.BackgroundColor); err != nil {
		return
	}
	if len(manifest.Layers) > maxBootAppearanceLayers {
		err = fmt.Errorf("too many layers: %d", len(manifest.Layers))
		return
	}

	ret = &BootAppearance{
		Enabled:         true,
		Provider:        pkg.Name,
		Appearance:      appearanceID,
		DisplayName:     bazaar.GetPreferredLocaleString(bazaar.LocaleStrings(manifest.DisplayName), appearanceID),
		Frontends:       frontends,
		BackgroundColor: manifest.BackgroundColor,
		OfficialUI: &BootAppearanceOfficialUI{
			ShowLogo:    true,
			ShowDetails: true,
		},
	}
	if manifest.OfficialUI.ShowLogo != nil {
		ret.OfficialUI.ShowLogo = *manifest.OfficialUI.ShowLogo
	}
	if manifest.OfficialUI.ShowDetails != nil {
		ret.OfficialUI.ShowDetails = *manifest.OfficialUI.ShowDetails
	}
	for _, color := range []string{manifest.OfficialUI.TextColor, manifest.OfficialUI.ProgressColor,
		manifest.OfficialUI.TrackColor} {
		if err = validateOptionalBootAppearanceColor(color); err != nil {
			return nil, err
		}
	}
	ret.OfficialUI.TextColor = manifest.OfficialUI.TextColor
	ret.OfficialUI.ProgressColor = manifest.OfficialUI.ProgressColor
	ret.OfficialUI.TrackColor = manifest.OfficialUI.TrackColor

	if manifest.Style != "" {
		if _, _, err = validateBootAppearanceResource(pluginDir, appearanceDir, manifest.Style, "style"); err != nil {
			return nil, fmt.Errorf("invalid style: %w", err)
		}
		ret.Style = bootAppearanceAssetURL(pkg.Name, appearanceID, manifest.Style)
	}

	layerIDs := map[string]bool{}
	for _, layer := range manifest.Layers {
		if layer == nil || !isValidBootAppearanceID(layer.ID) || layerIDs[layer.ID] {
			err = errors.New("invalid or duplicate layer ID")
			return nil, err
		}
		layerIDs[layer.ID] = true
		if layer.Type != "image" && layer.Type != "video" {
			err = fmt.Errorf("unsupported layer type [%s]", layer.Type)
			return nil, err
		}
		if _, _, err = validateBootAppearanceResource(pluginDir, appearanceDir, layer.Src, layer.Type); err != nil {
			return nil, fmt.Errorf("invalid layer source: %w", err)
		}
		if layer.Type == "video" {
			if layer.Poster == "" {
				err = errors.New("video poster is required")
				return nil, err
			}
			if _, _, err = validateBootAppearanceResource(pluginDir, appearanceDir, layer.Poster, "image"); err != nil {
				return nil, fmt.Errorf("invalid video poster: %w", err)
			}
		} else if layer.Poster != "" {
			err = errors.New("image layer cannot declare a poster")
			return nil, err
		}
		fit := layer.Fit
		if fit == "" {
			fit = "cover"
		}
		if !isValidBootAppearanceFit(fit) {
			err = fmt.Errorf("invalid layer fit [%s]", fit)
			return nil, err
		}
		position := layer.Position
		if position == "" {
			position = "center"
		}
		if !isValidBootAppearancePosition(position) {
			err = fmt.Errorf("invalid layer position [%s]", position)
			return nil, err
		}
		item := &BootAppearanceLayer{
			ID:       layer.ID,
			Type:     layer.Type,
			Src:      bootAppearanceAssetURL(pkg.Name, appearanceID, layer.Src),
			Fit:      fit,
			Position: position,
		}
		if layer.Poster != "" {
			item.Poster = bootAppearanceAssetURL(pkg.Name, appearanceID, layer.Poster)
		}
		ret.Layers = append(ret.Layers, item)
	}
	return
}

func validateBootAppearancePackage(pluginDir, appearanceDir string) error {
	if err := ensureBootAppearancePathHasNoSymlink(pluginDir, appearanceDir); err != nil {
		return err
	}
	info, err := os.Stat(appearanceDir)
	if err != nil || !info.IsDir() {
		return ErrBootAppearanceNotFound
	}
	var totalSize int64
	entryCount := 0
	err = filepath.WalkDir(appearanceDir, func(filePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relativePath, relativeErr := filepath.Rel(appearanceDir, filePath)
		if relativeErr != nil {
			return ErrBootAppearanceAssetForbidden
		}
		if relativePath != "." {
			entryCount++
			if entryCount > maxBootAppearanceEntries {
				return errors.New("too many boot appearance entries")
			}
			if len(relativePath) > maxBootAppearancePathLength ||
				len(strings.Split(filepath.ToSlash(relativePath), "/")) > maxBootAppearancePathDepth {
				return errors.New("boot appearance path is too deep or long")
			}
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrBootAppearanceAssetForbidden
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			return ErrBootAppearanceAssetForbidden
		}
		totalSize += info.Size()
		if totalSize > maxBootAppearanceTotalSize {
			return errors.New("boot appearance package is too large")
		}
		return nil
	})
	return err
}

func validateBootAppearanceResource(pluginDir, appearanceDir, relativePath, expectedType string) (filePath,
	contentType string, err error) {
	if !isSafeBootAppearanceRelativePath(relativePath) {
		err = ErrBootAppearanceAssetForbidden
		return
	}
	filePath = filepath.Join(appearanceDir, filepath.FromSlash(relativePath))
	if err = ensureBootAppearancePathHasNoSymlink(pluginDir, filePath); err != nil {
		err = ErrBootAppearanceAssetForbidden
		return
	}
	info, statErr := os.Stat(filePath)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			err = ErrBootAppearanceNotFound
		} else {
			err = ErrBootAppearanceAssetForbidden
		}
		return
	}
	if !info.Mode().IsRegular() {
		err = ErrBootAppearanceAssetForbidden
		return
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	resourceType := ""
	maxSize := int64(0)
	switch ext {
	case ".json":
		resourceType, contentType, maxSize = "manifest", "application/json; charset=utf-8", maxBootAppearanceManifestSize
	case ".css":
		resourceType, contentType, maxSize = "style", "text/css; charset=utf-8", maxBootAppearanceStyleSize
	case ".png":
		resourceType, contentType, maxSize = "image", "image/png", maxBootAppearanceImageSize
	case ".jpg", ".jpeg":
		resourceType, contentType, maxSize = "image", "image/jpeg", maxBootAppearanceImageSize
	case ".webp":
		resourceType, contentType, maxSize = "image", "image/webp", maxBootAppearanceImageSize
	case ".mp4":
		resourceType, contentType, maxSize = "video", "video/mp4", maxBootAppearanceVideoSize
	default:
		err = ErrBootAppearanceAssetForbidden
		return
	}
	if expectedType != "" && resourceType != expectedType {
		err = ErrBootAppearanceAssetForbidden
		return
	}
	if expectedType == "" && resourceType == "manifest" {
		err = ErrBootAppearanceAssetForbidden
		return
	}
	if info.Size() > maxSize {
		err = ErrBootAppearanceAssetForbidden
		return
	}

	if resourceType == "manifest" || resourceType == "style" {
		data, readErr := os.ReadFile(filePath)
		if readErr != nil || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			err = ErrBootAppearanceAssetForbidden
			return
		}
	} else {
		file, openErr := os.Open(filePath)
		if openErr != nil {
			err = ErrBootAppearanceAssetForbidden
			return
		}
		header := make([]byte, 512)
		n, readErr := file.Read(header)
		closeErr := file.Close()
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			err = ErrBootAppearanceAssetForbidden
			return
		}
		if closeErr != nil {
			err = ErrBootAppearanceAssetForbidden
			return
		}
		header = header[:n]
		if detected := strings.TrimSpace(strings.Split(http.DetectContentType(header), ";")[0]); detected != contentType {
			err = ErrBootAppearanceAssetForbidden
			return
		}
	}
	return
}

func ensureBootAppearancePathHasNoSymlink(root, target string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return ErrBootAppearanceAssetForbidden
	}
	current := rootAbs
	for _, part := range strings.Split(relative, string(os.PathSeparator)) {
		if part == "." || part == "" {
			continue
		}
		current = filepath.Join(current, part)
		info, lstatErr := os.Lstat(current)
		if lstatErr != nil {
			return lstatErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return ErrBootAppearanceAssetForbidden
		}
	}
	return nil
}

func validateBootAppearanceDisplayName(displayName map[string]string) error {
	if strings.TrimSpace(displayName["default"]) == "" {
		return errors.New("displayName.default is required")
	}
	for lang, value := range displayName {
		if strings.TrimSpace(lang) == "" || strings.TrimSpace(value) == "" || len(lang) > 32 || len(value) > 128 ||
			strings.ContainsAny(value, "\x00\r\n") {
			return errors.New("invalid display name")
		}
	}
	return nil
}

func normalizeBootAppearanceFrontends(manifestFrontends, pluginFrontends []string) ([]string, error) {
	candidates := manifestFrontends
	if len(candidates) == 0 {
		candidates = pluginFrontends
	}
	frontends := []string{}
	seen := map[string]bool{}
	for _, frontend := range candidates {
		if frontend == "all" && len(manifestFrontends) == 0 {
			for _, normalized := range []string{"desktop", "mobile"} {
				if !seen[normalized] {
					seen[normalized] = true
					frontends = append(frontends, normalized)
				}
			}
			continue
		}
		normalized := ""
		switch frontend {
		case "desktop":
			normalized = "desktop"
		case "mobile":
			normalized = "mobile"
		default:
			if len(manifestFrontends) > 0 {
				return nil, fmt.Errorf("unsupported frontend [%s]", frontend)
			}
			continue
		}
		if !seen[normalized] {
			seen[normalized] = true
			frontends = append(frontends, normalized)
		}
	}
	if len(frontends) == 0 && len(manifestFrontends) == 0 && len(pluginFrontends) == 0 {
		frontends = append(frontends, "desktop", "mobile")
	}
	if len(frontends) == 0 {
		return nil, errors.New("no supported frontend")
	}
	return frontends, nil
}

func validateOptionalBootAppearanceColor(color string) error {
	if color != "" && !bootAppearanceColorPattern.MatchString(color) {
		return fmt.Errorf("invalid color [%s]", color)
	}
	return nil
}

func isValidBootAppearanceID(id string) bool {
	return len(id) <= 64 && bootAppearanceIDPattern.MatchString(id)
}

func isSafeBootAppearanceRelativePath(relativePath string) bool {
	if relativePath == "" || len(relativePath) > maxBootAppearancePathLength || strings.Contains(relativePath, "\\") ||
		strings.ContainsAny(relativePath, `<>:"|?*`) || strings.HasPrefix(relativePath, "/") ||
		filepath.IsAbs(relativePath) || filepath.VolumeName(relativePath) != "" {
		return false
	}
	segments := strings.Split(relativePath, "/")
	if len(segments) > maxBootAppearancePathDepth {
		return false
	}
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
		for _, char := range segment {
			if char < 0x20 {
				return false
			}
		}
	}
	return true
}

func bootAppearanceLogReason(err error) string {
	reason := err.Error()
	if errors.Is(err, ErrBootAppearanceNotFound) {
		reason = ErrBootAppearanceNotFound.Error()
	} else if errors.Is(err, ErrBootAppearanceAssetForbidden) {
		reason = ErrBootAppearanceAssetForbidden.Error()
	} else {
		pathErr := &os.PathError{}
		if errors.As(err, &pathErr) {
			reason = pathErr.Op + ": " + pathErr.Err.Error()
		}
	}
	reason = strings.NewReplacer("\r", " ", "\n", " ", "\x00", "").Replace(reason)
	runes := []rune(reason)
	if 256 < len(runes) {
		reason = string(runes[:256])
	}
	return reason
}

func isValidBootAppearanceFit(fit string) bool {
	switch fit {
	case "cover", "contain", "fill", "none", "scale-down":
		return true
	}
	return false
}

func isValidBootAppearancePosition(position string) bool {
	switch position {
	case "center", "top", "right", "bottom", "left", "top-left", "top-right", "bottom-right", "bottom-left":
		return true
	}
	return false
}

func bootAppearanceAssetURL(provider, appearanceID, relativePath string) string {
	parts := strings.Split(relativePath, "/")
	for i, part := range parts {
		parts[i] = escapeBootAppearanceURLSegment(part)
	}
	return "/boot-appearance-assets/" + escapeBootAppearanceURLSegment(provider) + "/" +
		escapeBootAppearanceURLSegment(appearanceID) + "/" +
		strings.Join(parts, "/")
}

func escapeBootAppearanceURLSegment(value string) string {
	const hex = "0123456789ABCDEF"
	var ret strings.Builder
	for _, char := range []byte(value) {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') ||
			strings.ContainsRune("-_.!~*'()", rune(char)) {
			ret.WriteByte(char)
			continue
		}
		ret.WriteByte('%')
		ret.WriteByte(hex[char>>4])
		ret.WriteByte(hex[char&0x0f])
	}
	return ret.String()
}
