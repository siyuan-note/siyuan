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
	"os"
	"path/filepath"
	"strings"

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
	if len(text) > 200 {
		text = text[:200] + "..."
	}
	return text
}
