// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	BuiltinPluginSkillID      = "builtin:" + PluginDevelopmentSkillName
	BuiltinPluginSkillVersion = "1.0.0"
	maxBuiltinSkillTextBytes  = 24 * 1024
)

// 内置资源直接从只读嵌入文件系统加载，不在工作空间或用户技能目录生成副本。
//
//go:embed builtin_skills
var builtinSkillFiles embed.FS

type BuiltinSkillInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Source      string `json:"source"`
	Version     string `json:"version"`
	Digest      string `json:"digest"`
	Enabled     bool   `json:"enabled"`
}

func builtinPluginFS() (fs.FS, error) {
	return fs.Sub(builtinSkillFiles, "builtin_skills/"+PluginDevelopmentSkillName)
}

// BuiltinPluginSkill 返回可用于授权绑定的版本、全部资源摘要及当前启用状态，不返回正文。
func BuiltinPluginSkill(disabled []string) (*BuiltinSkillInfo, error) {
	files, err := builtinPluginFS()
	if err != nil {
		return nil, err
	}
	content, err := readBuiltinSkillText(files, "SKILL.md")
	if err != nil {
		return nil, err
	}
	frontmatter, _ := parseSkillFrontmatter(content)
	if frontmatter["name"] != PluginDevelopmentSkillName || frontmatter["description"] == "" {
		return nil, fmt.Errorf("invalid builtin skill metadata")
	}
	resources, err := builtinSkillResources(files)
	if err != nil {
		return nil, err
	}
	hash := sha256.New()
	fmt.Fprintf(hash, "%s\x00%s\x00", BuiltinPluginSkillID, BuiltinPluginSkillVersion)
	for _, resource := range resources {
		text, readErr := readBuiltinSkillText(files, resource)
		if readErr != nil {
			return nil, readErr
		}
		fmt.Fprintf(hash, "%d:%s%d:%s", len(resource), resource, len(text), text)
	}
	info := &BuiltinSkillInfo{
		ID: BuiltinPluginSkillID, Name: PluginDevelopmentSkillName,
		Description: frontmatter["description"], Source: "builtin",
		Version: BuiltinPluginSkillVersion, Digest: fmt.Sprintf("sha256:%x", hash.Sum(nil)), Enabled: true,
	}
	for _, id := range disabled {
		if id == info.ID {
			info.Enabled = false
			break
		}
	}
	return info, nil
}

// DiscoverBuiltinSkills 独立于普通技能列表，防止斜杠菜单绕过官方流程选择。
func DiscoverBuiltinSkills(disabled []string) []BuiltinSkillInfo {
	info, err := BuiltinPluginSkill(disabled)
	if err != nil {
		return []BuiltinSkillInfo{}
	}
	return []BuiltinSkillInfo{*info}
}

// LoadBuiltinSkill 只解析准确的官方名称；调用方必须先校验可信会话授权。
func LoadBuiltinSkill(locator string, disabled []string) (*SkillLoadResult, error) {
	name, resource, _ := strings.Cut(locator, "/")
	if name != PluginDevelopmentSkillName {
		return nil, fmt.Errorf("builtin skill not found: %s", name)
	}
	if resource == "" && locator != name {
		return nil, fmt.Errorf("invalid builtin skill resource path")
	}
	info, err := BuiltinPluginSkill(disabled)
	if err != nil {
		return nil, err
	}
	if !info.Enabled {
		return nil, fmt.Errorf("builtin skill is disabled: %s", info.ID)
	}
	files, err := builtinPluginFS()
	if err != nil {
		return nil, err
	}
	result := &SkillLoadResult{Name: info.Name, Source: info.Source, ID: info.ID, Version: info.Version, Digest: info.Digest}
	if resource == "" || resource == "SKILL.md" {
		content, readErr := readBuiltinSkillText(files, "SKILL.md")
		if readErr != nil {
			return nil, readErr
		}
		_, result.Content = parseSkillFrontmatter(content)
		resources, listErr := builtinSkillResources(files)
		if listErr != nil {
			return nil, listErr
		}
		for _, item := range resources {
			if item != "SKILL.md" {
				result.Resources = append(result.Resources, item)
			}
		}
		return result, nil
	}
	result.Content, err = readBuiltinSkillText(files, resource)
	if err != nil {
		return nil, err
	}
	result.ResourcePath = resource
	return result, nil
}

func readBuiltinSkillText(files fs.FS, resource string) (string, error) {
	if !fs.ValidPath(resource) || resource == "." || strings.ContainsAny(resource, `\:`) {
		return "", fmt.Errorf("invalid builtin skill resource path: %s", resource)
	}
	// 逐段读取目录项，避免 fs.Stat 跟随链接后把链接误判为普通文本。
	dir := "."
	parts := strings.Split(resource, "/")
	for i, part := range parts {
		entries, err := fs.ReadDir(files, dir)
		if err != nil {
			return "", err
		}
		found := false
		for _, entry := range entries {
			if entry.Name() != part {
				continue
			}
			found = true
			if entry.Type()&fs.ModeSymlink != 0 || i < len(parts)-1 && !entry.IsDir() || i == len(parts)-1 && !entry.Type().IsRegular() {
				return "", fmt.Errorf("builtin skill resource must be a regular file: %s", resource)
			}
			break
		}
		if !found {
			return "", fs.ErrNotExist
		}
		if dir == "." {
			dir = part
		} else {
			dir += "/" + part
		}
	}
	info, err := fs.Stat(files, resource)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > maxBuiltinSkillTextBytes {
		return "", fmt.Errorf("builtin skill resource is not bounded text: %s", resource)
	}
	data, err := fs.ReadFile(files, resource)
	if err != nil {
		return "", err
	}
	if len(data) > maxBuiltinSkillTextBytes || !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
		return "", fmt.Errorf("builtin skill resource is not bounded UTF-8 text: %s", resource)
	}
	return string(data), nil
}

func builtinSkillResources(files fs.FS) ([]string, error) {
	resources := []string{}
	bytes, visited := 0, 0
	err := fs.WalkDir(files, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		visited++
		if visited > maxSkillResourceVisited {
			return fmt.Errorf("builtin skill resource traversal limit exceeded")
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("builtin skill resource must be a regular file: %s", name)
		}
		bytes += len(name)
		if len(resources) >= maxSkillResourceEntries || bytes > maxSkillResourceManifestBytes {
			return fmt.Errorf("builtin skill resource manifest limit exceeded")
		}
		resources = append(resources, name)
		return nil
	})
	sort.Strings(resources)
	return resources, err
}
