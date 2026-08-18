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

package util

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/ConradIrwin/font/sfnt"
)

const (
	MaxCustomFontSize      int64 = 64 * 1024 * 1024
	CustomFontFamilyPrefix       = "SiYuanCustomFont-"
)

type CustomFont struct {
	ID          string   `json:"id"`
	Family      string   `json:"family"`
	Weight      int      `json:"weight"`
	DisplayName string   `json:"displayName"`
	Aliases     []string `json:"aliases,omitempty"`
	URL         string   `json:"url"`
	path        string
}

var (
	customFonts       []*CustomFont
	customFontsLoaded bool
	customFontsLang   string
	customFontsLock   sync.Mutex
	customFontTemps   = map[string]struct{}{}
)

func CustomFontDir() string {
	return filepath.Join(AppearancePath, "fonts", "custom")
}

func CreateCustomFontTemp() (*os.File, error) {
	customFontsLock.Lock()
	defer customFontsLock.Unlock()

	if err := os.MkdirAll(CustomFontDir(), 0755); err != nil {
		return nil, err
	}
	tempFile, err := os.CreateTemp(CustomFontDir(), ".font-*")
	if err != nil {
		return nil, err
	}
	customFontTemps[filepath.Clean(tempFile.Name())] = struct{}{}
	return tempFile, nil
}

func DiscardCustomFontTemp(tempPath string) {
	customFontsLock.Lock()
	defer customFontsLock.Unlock()

	tempPath = filepath.Clean(tempPath)
	if _, ok := customFontTemps[tempPath]; !ok {
		return
	}
	delete(customFontTemps, tempPath)
	_ = os.Remove(tempPath)
}

func LoadCustomFonts() []*CustomFont {
	customFontsLock.Lock()
	defer customFontsLock.Unlock()

	loadCustomFontsLocked()
	return cloneCustomFonts(customFonts)
}

func InstallCustomFont(tempPath string) (*CustomFont, bool, error) {
	customFontsLock.Lock()
	defer customFontsLock.Unlock()

	info, err := os.Stat(tempPath)
	if err != nil {
		return nil, false, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 {
		return nil, false, errors.New("font file is empty")
	}
	if MaxCustomFontSize < info.Size() {
		return nil, false, errors.New("font file is too large")
	}

	fontFile, err := os.Open(tempPath)
	if err != nil {
		return nil, false, err
	}

	extension, err := detectCustomFontExtension(fontFile)
	if err != nil {
		fontFile.Close()
		return nil, false, err
	}
	if _, err = fontFile.Seek(0, io.SeekStart); err != nil {
		fontFile.Close()
		return nil, false, err
	}

	id, err := customFontHash(fontFile)
	if err != nil {
		fontFile.Close()
		return nil, false, err
	}

	if _, err = fontFile.Seek(0, io.SeekStart); err != nil {
		fontFile.Close()
		return nil, false, err
	}
	font, err := parseCustomFontFile(fontFile)
	if closeErr := fontFile.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, false, err
	}

	if err = os.MkdirAll(CustomFontDir(), 0755); err != nil {
		return nil, false, err
	}
	targetPath := filepath.Join(CustomFontDir(), id+extension)
	if _, statErr := os.Stat(targetPath); statErr == nil {
		_ = os.Remove(tempPath)
		customFontsLoaded = false
		ret := newCustomFont(id, targetPath, font)
		return ret, false, nil
	} else if !os.IsNotExist(statErr) {
		return nil, false, statErr
	}

	if err = os.Rename(tempPath, targetPath); err != nil {
		return nil, false, err
	}
	if err = os.Chmod(targetPath, 0644); err != nil {
		_ = os.Remove(targetPath)
		return nil, false, err
	}

	customFontsLoaded = false
	return newCustomFont(id, targetPath, font), true, nil
}

func RemoveCustomFont(id string) (*CustomFont, error) {
	if !validCustomFontID(id) {
		return nil, errors.New("invalid custom font ID")
	}

	customFontsLock.Lock()
	defer customFontsLock.Unlock()

	loadCustomFontsLocked()
	for _, font := range customFonts {
		if font.ID != id {
			continue
		}
		if err := os.Remove(font.path); err != nil {
			return nil, err
		}
		customFontsLoaded = false
		return cloneCustomFont(font), nil
	}
	return nil, os.ErrNotExist
}

func GetCustomFontFile(id string) (string, *CustomFont, bool) {
	if !validCustomFontID(id) {
		return "", nil, false
	}

	customFontsLock.Lock()
	defer customFontsLock.Unlock()

	loadCustomFontsLocked()
	for _, font := range customFonts {
		if font.ID == id {
			info, err := os.Lstat(font.path)
			if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || MaxCustomFontSize < info.Size() {
				return "", nil, false
			}
			return font.path, cloneCustomFont(font), true
		}
	}
	return "", nil, false
}

func loadCustomFontsLocked() {
	if customFontsLoaded && customFontsLang == Lang {
		return
	}
	cleanupCustomFontTempsLocked()

	customFonts = []*CustomFont{}
	entries, err := os.ReadDir(CustomFontDir())
	if err != nil {
		customFontsLoaded = true
		customFontsLang = Lang
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := strings.ToLower(entry.Name())
		extension := filepath.Ext(name)
		id := strings.TrimSuffix(name, extension)
		if (extension != ".ttf" && extension != ".otf") || !validCustomFontID(id) {
			continue
		}

		fontPath := filepath.Join(CustomFontDir(), entry.Name())
		info, statErr := os.Lstat(fontPath)
		if statErr != nil || !info.Mode().IsRegular() || info.Size() < 1 || MaxCustomFontSize < info.Size() {
			continue
		}
		fontFile, openErr := os.Open(fontPath)
		if openErr != nil {
			continue
		}
		detectedExtension, detectErr := detectCustomFontExtension(fontFile)
		if detectErr != nil || detectedExtension != extension {
			fontFile.Close()
			continue
		}
		if _, seekErr := fontFile.Seek(0, io.SeekStart); seekErr != nil {
			fontFile.Close()
			continue
		}
		actualID, hashErr := customFontHash(fontFile)
		if hashErr != nil || actualID != id {
			fontFile.Close()
			continue
		}
		if _, seekErr := fontFile.Seek(0, io.SeekStart); seekErr != nil {
			fontFile.Close()
			continue
		}
		font, parseErr := parseCustomFontFile(fontFile)
		fontFile.Close()
		if parseErr != nil {
			continue
		}
		customFonts = append(customFonts, newCustomFont(id, fontPath, font))
	}

	sort.Slice(customFonts, func(i, j int) bool {
		if customFonts[i].DisplayName == customFonts[j].DisplayName {
			return customFonts[i].ID < customFonts[j].ID
		}
		return customFonts[i].DisplayName < customFonts[j].DisplayName
	})
	customFontsLoaded = true
	customFontsLang = Lang
}

func cleanupCustomFontTempsLocked() {
	entries, err := os.ReadDir(CustomFontDir())
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), ".font-") {
			continue
		}
		tempPath := filepath.Clean(filepath.Join(CustomFontDir(), entry.Name()))
		if _, active := customFontTemps[tempPath]; !active {
			_ = os.Remove(tempPath)
		}
	}
}

func detectCustomFontExtension(reader io.Reader) (string, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(reader, header); err != nil {
		return "", errors.New("font file is invalid")
	}

	switch string(header) {
	case "\x00\x01\x00\x00", "true":
		return ".ttf", nil
	case "OTTO":
		return ".otf", nil
	default:
		return "", errors.New("only TTF and OTF font files are supported")
	}
}

func customFontHash(reader io.Reader) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, reader); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func parseCustomFontFile(fontFile *os.File) (ret *Font, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			ret = nil
			err = fmt.Errorf("parse font failed: %v", recovered)
		}
	}()

	parsed, err := sfnt.Parse(fontFile)
	if err != nil {
		return nil, fmt.Errorf("parse font failed: %w", err)
	}
	ret, err = parseFontInfo(parsed)
	if err != nil {
		return nil, fmt.Errorf("parse font metadata failed: %w", err)
	}
	return ret, nil
}

func validCustomFontID(id string) bool {
	if len(id) != sha256.Size*2 || strings.ToLower(id) != id {
		return false
	}
	decoded, err := hex.DecodeString(id)
	return err == nil && len(decoded) == sha256.Size
}

func newCustomFont(id, fontPath string, font *Font) *CustomFont {
	weight := font.Weight
	if weight < 1 || 1000 < weight {
		weight = 400
	}
	return &CustomFont{
		ID:          id,
		Family:      CustomFontFamilyPrefix + id,
		Weight:      weight,
		DisplayName: font.DisplayName,
		Aliases:     mergeFontAliases(nil, append(append([]string(nil), font.Aliases...), font.Family), font.DisplayName),
		URL:         "/custom-fonts/" + id,
		path:        fontPath,
	}
}

func cloneCustomFonts(fonts []*CustomFont) (ret []*CustomFont) {
	ret = make([]*CustomFont, 0, len(fonts))
	for _, font := range fonts {
		ret = append(ret, cloneCustomFont(font))
	}
	return
}

func cloneCustomFont(font *CustomFont) *CustomFont {
	ret := *font
	ret.Aliases = append([]string(nil), font.Aliases...)
	return &ret
}
