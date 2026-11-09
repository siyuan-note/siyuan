// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package markdownappearance

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"
)

const maxFontBytes = 64 * 1024 * 1024
const maxSessionFontBytes = 128 * 1024 * 1024

type grant struct{ workspace, id string }

type Resolver struct {
	mu           sync.Mutex
	root         *os.Root
	rootPath     string
	originalRoot string
	platform     string
	registry     string
	grants       map[string]grant
	fontBytes    map[string]int
	selection    string
	faces        []CustomFont
	closed       bool
}

func New(configDir, allowedRoot, platform string) (*Resolver, error) {
	if !filepath.IsAbs(configDir) || !filepath.IsAbs(allowedRoot) {
		return nil, errInvalid
	}
	// 只在可信原生边界规范化根路径；后续读操作始终限制在已打开的根目录中。
	canonical, err := filepath.EvalSymlinks(allowedRoot)
	if err != nil {
		return nil, err
	}
	_, err = relativeWithin(filepath.Clean(allowedRoot), filepath.Clean(configDir))
	if err != nil {
		return nil, err
	}
	registry, err := relativeWithin(filepath.Clean(allowedRoot), filepath.Join(filepath.Dir(filepath.Clean(configDir)), "workspace.json"))
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(canonical)
	if err != nil {
		return nil, err
	}
	return &Resolver{root: root, rootPath: canonical, originalRoot: filepath.Clean(allowedRoot), platform: platform, registry: registry, grants: map[string]grant{}, fontBytes: map[string]int{}, faces: []CustomFont{}}, nil
}

func relativeWithin(root, name string) (string, error) {
	rel, err := filepath.Rel(root, name)
	if err != nil || !filepath.IsLocal(rel) {
		return "", errInvalid
	}
	return rel, nil
}

func digest(value []byte) string { sum := sha256.Sum256(value); return hex.EncodeToString(sum[:]) }

func readBounded(root *os.Root, path string, limit int64) ([]byte, error) {
	before, err := root.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Size() > limit {
		return nil, errInvalid
	}
	f, err := root.OpenFile(path, os.O_RDONLY|nonblockFlag, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > limit || !os.SameFile(before, stat) {
		return nil, errInvalid
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	after, err := f.Stat()
	if err != nil || int64(len(data)) != stat.Size() || len(data) > int(limit) || after.Size() != stat.Size() || !after.ModTime().Equal(stat.ModTime()) {
		return nil, errInvalid
	}
	current, err := root.Lstat(path)
	if err != nil || !current.Mode().IsRegular() || !os.SameFile(current, stat) {
		return nil, errInvalid
	}
	return data, nil
}

func readJSON(root *os.Root, path string, limit int64) (any, error) {
	data, err := readBounded(root, path, limit)
	if err != nil {
		return nil, err
	}
	if !utf8.Valid(data) {
		return nil, errInvalid
	}
	var ret any
	if err = json.Unmarshal(data, &ret); err != nil {
		return nil, err
	}
	return ret, nil
}

func directories(root *os.Root, path string) (map[string]os.FileInfo, error) {
	ret := map[string]os.FileInfo{}
	current := "."
	for _, part := range strings.Split(filepath.Clean(path), string(filepath.Separator)) {
		current = filepath.Join(current, part)
		stat, err := root.Lstat(current)
		if err != nil || !stat.IsDir() {
			return nil, errInvalid
		}
		ret[current] = stat
	}
	return ret, nil
}

func unchangedDirectories(root *os.Root, snapshot map[string]os.FileInfo) bool {
	for path, before := range snapshot {
		after, err := root.Lstat(path)
		if err != nil || !after.IsDir() || !os.SameFile(before, after) {
			return false
		}
	}
	return true
}

func (r *Resolver) openWorkspace(relative string) (*os.Root, error) {
	snapshot, err := directories(r.root, relative)
	if err != nil {
		return nil, err
	}
	root, err := r.root.OpenRoot(relative)
	if err != nil {
		return nil, err
	}
	stat, err := root.Stat(".")
	if err != nil || !os.SameFile(snapshot[filepath.Clean(relative)], stat) || !unchangedDirectories(r.root, snapshot) {
		root.Close()
		return nil, errInvalid
	}
	return root, nil
}

func (r *Resolver) workspaces() []Workspace {
	ret := []Workspace{}
	value, err := readJSON(r.root, r.registry, 1024*1024)
	if err != nil {
		return ret
	}
	values, ok := value.([]any)
	if !ok {
		return ret
	}
	if len(values) > 256 {
		values = values[len(values)-256:]
	}
	for _, value := range values {
		name, ok := value.(string)
		if !ok || len(name) > 32768 || !filepath.IsAbs(name) || strings.ContainsRune(name, 0) {
			continue
		}
		name = filepath.Clean(name)
		if r.platform == "ios" {
			if _, err := relativeWithin(r.originalRoot, name); err != nil {
				marker := "/Documents/"
				if index := strings.Index(name, marker); index >= 0 {
					name = filepath.Join(r.originalRoot, name[index+len(marker):])
				} else if strings.HasSuffix(name, "/Documents") {
					name = r.originalRoot
				}
			}
		}
		if rel, err := relativeWithin(r.originalRoot, name); err == nil {
			name = filepath.Join(r.rootPath, rel)
		}
		rel, err := relativeWithin(r.rootPath, name)
		if err != nil {
			continue
		}
		root, err := r.openWorkspace(rel)
		if err != nil {
			continue
		}
		root.Close()
		id := digest([]byte(filepath.ToSlash(rel)))
		for i, item := range ret {
			if item.ID == id {
				ret = append(ret[:i], ret[i+1:]...)
				break
			}
		}
		ret = append(ret, Workspace{ID: id, Name: name, relative: rel})
	}
	return ret
}

func (r *Resolver) Resolve(preferencesJSON, patchJSON string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return "", errors.New("Markdown appearance closed")
	}
	prefs, ind, sources, err := normalizePreferences(preferencesJSON)
	if err != nil {
		return "", err
	}
	available := r.workspaces()
	byID := map[string]Workspace{}
	for _, workspace := range available {
		byID[workspace.ID] = workspace
	}
	patch, err := decodeObject(patchJSON)
	if err != nil {
		return "", err
	}
	for key, value := range patch {
		switch key {
		case "sources":
			values, ok := object(value)
			if !ok {
				return "", errInvalid
			}
			for group, value := range values {
				id, ok := value.(string)
				if _, valid := sources[group]; !valid || !ok {
					return "", errInvalid
				}
				if id != "independent" {
					if _, ok := byID[id]; !ok {
						return "", errors.New("unavailable appearance source")
					}
				}
				sources[group] = id
			}
		case "independent":
			values, err := independent(value)
			if err != nil {
				return "", err
			}
			for key, value := range values {
				ind[key] = value
			}
		default:
			return "", errInvalid
		}
	}
	result := initialAppearance(ind)
	result.Sources = sources
	result.Workspaces = available
	configs := map[string]map[string]any{}
	failed := map[string]bool{}
	fontWorkspace := ""
	for _, group := range groups {
		id := sources[group]
		workspace, ok := byID[id]
		if !ok {
			sources[group] = "independent"
			continue
		}
		conf, loaded := configs[id]
		if !loaded {
			configs[id] = map[string]any{}
			root, err := r.openWorkspace(workspace.relative)
			if err != nil {
				failed[id] = true
			} else {
				snapshot, dirErr := directories(root, "conf")
				var value any
				var err error
				if dirErr != nil {
					err = dirErr
				} else {
					value, err = readJSON(root, filepath.Join("conf", "conf.json"), 4*1024*1024)
					if !unchangedDirectories(root, snapshot) {
						err = errInvalid
					}
				}
				root.Close()
				if err != nil {
					failed[id] = true
				} else if parsed, ok := object(value); ok {
					configs[id] = parsed
				} else {
					failed[id] = true
				}
			}
			conf = configs[id]
		}
		if failed[id] {
			sources[group] = "independent"
			continue
		}
		editor, _ := object(conf["editor"])
		appearance, _ := object(conf["appearance"])
		switch group {
		case "theme":
			if appearance["modeOS"] == true {
				result.Theme = "system"
			} else if n, ok := integer(appearance["mode"], 0, 1); ok {
				if n == 1 {
					result.Theme = "dark"
				} else {
					result.Theme = "light"
				}
			}
		case "fontSize":
			if n, ok := integer(editor["fontSize"], 9, 72); ok {
				result.FontSize = n
			}
		case "fonts":
			_, globalOK := appearance["globalFontFamilies"].([]any)
			_, editorOK := editor["fontFamilies"].([]any)
			_, codeOK := editor["codeFontFamilies"].([]any)
			_, legacyOK := editor["fontFamily"].(string)
			if globalOK || editorOK || codeOK || legacyOK {
				fontWorkspace = workspace.relative
				result.Fonts["global"], _ = parseFonts(appearance["globalFontFamilies"], false)
				value, exists := editor["fontFamilies"]
				if !exists {
					value = []any{map[string]any{"family": editor["fontFamily"], "weight": editor["fontWeight"]}}
				}
				result.Fonts["editor"], _ = parseFonts(value, false)
				result.Fonts["code"], _ = parseFonts(editor["codeFontFamilies"], false)
			}
		}
	}
	selectionBytes, _ := json.Marshal([]any{fontWorkspace, result.Fonts})
	selection := string(selectionBytes)
	if selection != r.selection {
		grants := map[string]grant{}
		faces := []CustomFont{}
		seen := map[string]bool{}
		if fontWorkspace != "" {
			for _, group := range fontGroups {
				for _, font := range result.Fonts[group] {
					if !strings.HasPrefix(font.Family, customPrefix) {
						continue
					}
					id := strings.TrimPrefix(font.Family, customPrefix)
					if !validID(id) || seen[id] {
						continue
					}
					seen[id] = true
					random := make([]byte, 24)
					if _, err := rand.Read(random); err != nil {
						return "", err
					}
					token := hex.EncodeToString(random)
					grants[token] = grant{fontWorkspace, id}
					faces = append(faces, CustomFont{Font: font, URL: "/appearance-font/" + token})
				}
			}
		}
		r.grants = grants
		r.faces = faces
		r.fontBytes = map[string]int{}
		r.selection = selection
	}
	result.CustomFonts = r.faces
	prefs["sources"] = sources
	prefs["independent"] = ind
	data, err := json.Marshal(map[string]any{"preferences": prefs, "appearance": result})
	return string(data), err
}

func (r *Resolver) ReadFont(token string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	grant, ok := r.grants[token]
	if !ok || r.closed {
		return nil, errors.New("unavailable appearance font")
	}
	workspace, err := r.openWorkspace(grant.workspace)
	if err != nil {
		return nil, err
	}
	defer workspace.Close()
	fontRoot := filepath.Join("conf", "appearance", "fonts", "custom")
	// 字体路径中的每一级都必须是实际目录，不能借符号链接换成其他资源。
	snapshot, err := directories(workspace, fontRoot)
	if err != nil {
		return nil, err
	}
	for _, extension := range []string{"ttf", "otf"} {
		file := filepath.Join(fontRoot, grant.id+"."+extension)
		stat, err := workspace.Lstat(file)
		if err != nil || !stat.Mode().IsRegular() || stat.Size() < 4 || stat.Size() > maxFontBytes {
			continue
		}
		total := int64(0)
		for other, size := range r.fontBytes {
			if other != token {
				total += int64(size)
			}
		}
		if total+stat.Size() > maxSessionFontBytes {
			return nil, errors.New("appearance font budget exceeded")
		}
		data, err := readBounded(workspace, file, maxFontBytes)
		if err != nil || len(data) < 4 {
			continue
		}
		header := string(data[:4])
		if extension == "ttf" && header != "\x00\x01\x00\x00" && header != "true" || extension == "otf" && header != "OTTO" || digest(data) != grant.id {
			continue
		}
		if !unchangedDirectories(workspace, snapshot) {
			return nil, errInvalid
		}
		r.fontBytes[token] = len(data)
		return data, nil
	}
	return nil, errors.New("unavailable appearance font")
}

func (r *Resolver) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	r.closed = true
	r.grants = nil
	r.faces = nil
	r.fontBytes = nil
	return r.root.Close()
}
