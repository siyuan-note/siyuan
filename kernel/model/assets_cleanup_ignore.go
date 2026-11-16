// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const assetCleanupIgnorePath = ".siyuan/assets-cleanup-ignore"
const assetCleanupIgnoreMaxSize = 1024 * 1024

var ErrAssetCleanupIgnoreConflict = errors.New("asset cleanup ignore rules changed; reload before saving")

type AssetCleanupIgnoreData struct {
	Content  string `json:"content"`
	Revision string `json:"revision"`
}

func assetCleanupIgnoreFilePath() (string, error) {
	p := filepath.Join(util.DataDir, filepath.FromSlash(assetCleanupIgnorePath))
	resolved, err := ResolveAssetPathWithMissingLeaf(p)
	if err != nil {
		return "", err
	}
	root, err := ResolveAssetPathWithMissingLeaf(util.DataDir)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || filepath.ToSlash(rel) != assetCleanupIgnorePath {
		return "", errors.New("asset cleanup ignore rules must stay inside the workspace metadata directory")
	}
	return p, nil
}

func readAssetCleanupIgnore() (*AssetCleanupIgnoreData, error) {
	p, err := assetCleanupIgnoreFilePath()
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(p)
	if os.IsNotExist(err) {
		return &AssetCleanupIgnoreData{Revision: "missing"}, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > assetCleanupIgnoreMaxSize {
		return nil, errors.New("asset cleanup ignore rules must be a regular file no larger than 1 MiB")
	}
	data, err := filelock.ReadFile(p)
	if err != nil {
		return nil, err
	}
	if len(data) > assetCleanupIgnoreMaxSize {
		return nil, errors.New("asset cleanup ignore rules exceed 1 MiB")
	}
	return &AssetCleanupIgnoreData{Content: string(data), Revision: fmt.Sprintf("%x", sha256.Sum256(data))}, nil
}

func compileAssetCleanupIgnore(content string) (*ignore.GitIgnore, error) {
	if len(content) > assetCleanupIgnoreMaxSize || !utf8.ValidString(content) || strings.ContainsRune(content, 0) {
		return nil, errors.New("asset cleanup ignore rules must be UTF-8 text no larger than 1 MiB")
	}
	lines := strings.Split(strings.ReplaceAll(strings.TrimPrefix(content, "\ufeff"), "\r\n", "\n"), "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "<<<<<<<") || strings.HasPrefix(line, "=======") || strings.HasPrefix(line, ">>>>>>>") {
			return nil, fmt.Errorf("resolve asset cleanup ignore conflict at line %d before cleaning assets", i+1)
		}
		if strings.TrimSpace(line) == "!" {
			return nil, fmt.Errorf("empty asset cleanup ignore negation at line %d", i+1)
		}
		if strings.HasPrefix(line, "#") || strings.TrimSpace(line) == "" {
			continue
		}
		if err := validateAssetCleanupIgnorePattern(line); err != nil {
			return nil, fmt.Errorf("invalid asset cleanup ignore rule at line %d: %w", i+1, err)
		}
	}
	return ignore.CompileIgnoreLines(lines...), nil
}

func validateAssetCleanupIgnorePattern(line string) error {
	// 校验固定版本 go-gitignore 的完整转换结果，避免非法表达式被匹配器静默丢弃。
	// 转换顺序对应 github.com/sabhiram/go-gitignore 的 525f6e181f06，升级依赖时需同步检查。
	line = strings.TrimPrefix(strings.Trim(strings.TrimRight(line, "\r"), " "), "!")
	if strings.HasPrefix(line, `\#`) || strings.HasPrefix(line, `\!`) {
		line = line[1:]
	}
	if regexp.MustCompile(`([^\/+])/.*\*\.`).MatchString(line) && !strings.HasPrefix(line, "/") {
		line = "/" + line
	}
	line = strings.ReplaceAll(line, ".", `\.`)
	if strings.HasPrefix(line, "/**/") {
		line = line[1:]
	}
	for _, replacement := range [][2]string{
		{"/**/", "(/|/.+/)"},
		{"**/", "(|.#$~/)"},
		{"/**", "(|/.#$~)"},
		{`\*`, `\#$~`},
		{"*", "([^/]*)"},
		{"?", `\?`},
		{"#$~", "*"},
	} {
		line = strings.ReplaceAll(line, replacement[0], replacement[1])
	}
	if strings.HasSuffix(line, "/") {
		line += "(|.*)$"
	} else {
		line += "(|/.*)$"
	}
	if strings.HasPrefix(line, "/") {
		line = "^(|/)" + line[1:]
	} else {
		line = "^(|.*/)" + line
	}
	_, err := regexp.Compile(line)
	return err
}

func GetAssetCleanupIgnore() (*AssetCleanupIgnoreData, error) {
	return readAssetCleanupIgnore()
}

func SetAssetCleanupIgnore(content, expectedRevision string) (*AssetCleanupIgnoreData, error) {
	if _, err := compileAssetCleanupIgnore(content); err != nil {
		return nil, err
	}
	syncLock.Lock()
	defer syncLock.Unlock()
	current, err := readAssetCleanupIgnore()
	if err != nil {
		return nil, err
	}
	if current.Revision != expectedRevision {
		return nil, ErrAssetCleanupIgnoreConflict
	}
	if current.Content == content && current.Revision != "missing" {
		return current, nil
	}
	return writeAssetCleanupIgnore(content)
}

func writeAssetCleanupIgnore(content string) (*AssetCleanupIgnoreData, error) {
	p, err := assetCleanupIgnoreFilePath()
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return nil, err
	}
	if err = filelock.WriteFile(p, []byte(content)); err != nil {
		return nil, err
	}
	IncSyncIfNeeded(p)
	return readAssetCleanupIgnore()
}

func AddAssetCleanupIgnore(paths []string) (*AssetCleanupIgnoreData, error) {
	syncLock.Lock()
	defer syncLock.Unlock()
	return addAssetCleanupIgnore(paths)
}

func addAssetCleanupIgnore(paths []string) (*AssetCleanupIgnoreData, error) {
	current, err := readAssetCleanupIgnore()
	if err != nil {
		return nil, err
	}
	matcher, err := compileAssetCleanupIgnore(current.Content)
	if err != nil {
		return nil, err
	}
	content := current.Content
	seen := map[string]bool{}
	for _, p := range paths {
		if !strings.HasPrefix(p, "assets/") || p != path.Clean(p) || strings.HasSuffix(p, "/") || strings.ContainsAny(p, "\\:?\r\n\x00") {
			return nil, fmt.Errorf("invalid global asset path: %s", p)
		}
		abs := filepath.Join(util.DataDir, filepath.FromSlash(p))
		resolved, resolveErr := ResolveAssetPathWithMissingLeaf(abs)
		root, rootErr := ResolveAssetPathWithMissingLeaf(util.GetDataAssetsAbsPath())
		if resolveErr != nil {
			return nil, resolveErr
		}
		if rootErr != nil {
			return nil, rootErr
		}
		if IsEncryptedAssetPath(abs) || IsEncryptedAssetPath(resolved) {
			return nil, errors.New("encrypted assets cannot use global cleanup exclusions")
		}
		rel, relErr := filepath.Rel(root, resolved)
		if relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
			return nil, fmt.Errorf("asset path escapes the global asset directory: %s", p)
		}
		if info, statErr := os.Stat(abs); statErr == nil && !info.Mode().IsRegular() {
			return nil, fmt.Errorf("asset path is not a regular file: %s", p)
		} else if statErr != nil && !os.IsNotExist(statErr) {
			return nil, statErr
		}
		if matcher.MatchesPath("/"+p) || seen[p] {
			continue
		}
		seen[p] = true
		if content != "" && !strings.HasSuffix(content, "\n") {
			content += "\n"
		}
		content += assetCleanupIgnoreLiteral(p) + "\n"
		literal := ignore.CompileIgnoreLines(assetCleanupIgnoreLiteral(p))
		if !literal.MatchesPath("/"+p) || literal.MatchesPath("/"+p+"-other") {
			return nil, fmt.Errorf("asset filename cannot be represented as an exact cleanup ignore rule: %s", p)
		}
	}
	if _, err = compileAssetCleanupIgnore(content); err != nil {
		return nil, err
	}
	if content == current.Content {
		return current, nil
	}
	return writeAssetCleanupIgnore(content)
}

func assetCleanupIgnoreLiteral(p string) string {
	// 匹配器会保留部分正则元字符，具体文件规则需要同时转义这些字符。
	replacer := strings.NewReplacer("*", "\\*", "[", "\\[", "]", "\\]", "(", "\\(", ")", "\\)", "+", "\\+", "^", "\\^", "$", "\\$", "{", "\\{", "}", "\\}", "|", "\\|")
	return "/" + replacer.Replace(p)
}

func reusableCleanupUploadAsset(p string) bool {
	p = strings.TrimPrefix(p, "/")
	if !strings.HasPrefix(p, "assets/") || p != path.Clean(p) {
		return false
	}
	info, err := os.Stat(filepath.Join(util.DataDir, filepath.FromSlash(p)))
	return err == nil && info.Mode().IsRegular()
}

func excludeAssetCleanupIgnoredPaths(assets map[string]string) error {
	rules, err := readAssetCleanupIgnore()
	if err != nil {
		return err
	}
	matcher, err := compileAssetCleanupIgnore(rules.Content)
	if err != nil {
		return err
	}
	protected := map[string]bool{}
	for key, abs := range assets {
		rel, relErr := filepath.Rel(util.DataDir, abs)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)
		if rel == ".." || strings.HasPrefix(rel, "../") {
			return errors.New("asset candidate is outside the data directory")
		}
		if strings.HasSuffix(key, "/") {
			rel += "/"
		}
		if matcher.MatchesPath("/" + rel) {
			protected[filepath.Clean(abs)] = true
			if strings.HasSuffix(strings.ToLower(abs), ".pdf") {
				protected[filepath.Clean(abs)+".sya"] = true
			}
		}
	}
	for abs := range protected {
		for parent := filepath.Dir(abs); parent != filepath.Dir(parent) && parent != filepath.Clean(util.DataDir); parent = filepath.Dir(parent) {
			protected[parent] = true
		}
	}
	for key, abs := range assets {
		if protected[filepath.Clean(abs)] {
			delete(assets, key)
			continue
		}
	}
	return nil
}
