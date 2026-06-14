// SiYuan - Refactor your thinking
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
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
)

type SkillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func SkillsDir() string {
	return filepath.Join(DataDir, "storage", "ai", "agent", "skills")
}

func DiscoverSkills() []SkillInfo {
	dir := SkillsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	var skills []SkillInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		skillDir := e.Name()
		skillMdPath := filepath.Join(dir, skillDir, "SKILL.md")
		b, err := filelock.ReadFile(skillMdPath)
		if err != nil {
			continue
		}
		fm, body := parseSkillFrontmatter(string(b))
		name := fm["name"]
		if name == "" {
			name = skillDir
		}
		desc := fm["description"]
		if desc == "" {
			desc = firstLine(body)
		}
		skills = append(skills, SkillInfo{
			Name:        name,
			Description: desc,
		})
	}
	return skills
}

func LoadSkillContent(name string) string {
	dir := SkillsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		skillMdPath := filepath.Join(dir, e.Name(), "SKILL.md")
		b, err := filelock.ReadFile(skillMdPath)
		if err != nil {
			continue
		}
		fm, body := parseSkillFrontmatter(string(b))
		skillName := fm["name"]
		if skillName == "" {
			skillName = e.Name()
		}
		if strings.EqualFold(skillName, name) || strings.EqualFold(e.Name(), name) {
			return body
		}
	}
	return ""
}

func validateSkillName(name string) error {
	if name == "" || name == "." || name == ".." {
		return fmt.Errorf("invalid skill name: %s", name)
	}
	if strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("invalid skill name: %s", name)
	}
	dir := SkillsDir()
	abs := filepath.Join(dir, name)
	if !gulu.File.IsSubPath(dir, abs) {
		return fmt.Errorf("invalid skill name: %s", name)
	}
	return nil
}

func ReadSkill(name string) (string, error) {
	if err := validateSkillName(name); err != nil {
		return "", err
	}
	skillMdPath := filepath.Join(SkillsDir(), name, "SKILL.md")
	b, err := filelock.ReadFile(skillMdPath)
	if err != nil {
		return "", fmt.Errorf("skill not found: %s", name)
	}
	return string(b), nil
}

func SaveSkill(name, content string) error {
	if err := validateSkillName(name); err != nil {
		return err
	}
	dir := SkillsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	skillDir := filepath.Join(dir, name)
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		return err
	}
	skillMdPath := filepath.Join(skillDir, "SKILL.md")
	return filelock.WriteFile(skillMdPath, []byte(content))
}

func RemoveSkill(name string) error {
	if err := validateSkillName(name); err != nil {
		return err
	}
	skillDir := filepath.Join(SkillsDir(), name)
	if _, err := os.Stat(skillDir); os.IsNotExist(err) {
		return fmt.Errorf("skill not found: %s", name)
	}
	return os.RemoveAll(skillDir)
}

func RenameSkill(oldName, newName string) error {
	if err := validateSkillName(oldName); err != nil {
		return err
	}
	if err := validateSkillName(newName); err != nil {
		return err
	}
	dir := SkillsDir()
	oldDir := filepath.Join(dir, oldName)
	newDir := filepath.Join(dir, newName)
	if _, err := os.Stat(oldDir); os.IsNotExist(err) {
		return fmt.Errorf("skill not found: %s", oldName)
	}
	if _, err := os.Stat(newDir); err == nil {
		return fmt.Errorf("skill already exists: %s", newName)
	}
	return os.Rename(oldDir, newDir)
}

func parseSkillFrontmatter(text string) (fm map[string]string, body string) {
	fm = map[string]string{}
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "---") {
		return fm, text
	}
	end := strings.Index(text[3:], "\n---")
	if end < 0 {
		return fm, text
	}
	raw := text[3 : 3+end]
	body = strings.TrimSpace(text[3+end+4:])
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if key == "name" || key == "description" {
			fm[key] = val
		}
	}
	return fm, body
}

func firstLine(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	idx := strings.IndexAny(text, "\n\r")
	if idx > 0 {
		text = text[:idx]
	}
	runes := []rune(text)
	if len(runes) > 200 {
		text = string(runes[:200]) + "..."
	}
	return text
}
