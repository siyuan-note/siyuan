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

package model

import (
	"strings"

	"github.com/siyuan-note/siyuan/kernel/treenode"
)

const skillsNotebookName = "Skills"

type AgentSkillInfo struct {
	Name        string
	Description string
	ID          string
}

func DiscoverAgentSkills() []AgentSkillInfo {
	notebooks, err := ListNotebooks()
	if err != nil {
		return nil
	}

	var skillsNBID string
	for _, nb := range notebooks {
		if nb.Name == skillsNotebookName {
			skillsNBID = nb.ID
			break
		}
	}
	if skillsNBID == "" {
		return nil
	}

	docs, _, err := ListDocTree(skillsNBID, "/", 0, false, false, 128)
	if err != nil {
		return nil
	}

	var skills []AgentSkillInfo
	for _, doc := range docs {
		desc := firstBlockText(doc.ID)
		skills = append(skills, AgentSkillInfo{
			Name:        doc.Name,
			Description: desc,
			ID:          doc.ID,
		})
	}
	return skills
}

func LoadAgentSkillContent(name string) string {
	notebooks, err := ListNotebooks()
	if err != nil {
		return ""
	}
	var skillsNBID string
	for _, nb := range notebooks {
		if nb.Name == skillsNotebookName {
			skillsNBID = nb.ID
			break
		}
	}
	if skillsNBID == "" {
		return ""
	}

	docs, _, err := ListDocTree(skillsNBID, "/", 0, false, false, 128)
	if err != nil {
		return ""
	}

	for _, doc := range docs {
		if strings.EqualFold(doc.Name, name) {
			return readDocMarkdown(doc.ID)
		}
	}

	results := SearchDocs(name, false, nil)
	for _, r := range results {
		if strings.EqualFold(r["box"], skillsNBID) {
			return readDocMarkdown(r["id"])
		}
	}
	return ""
}

func firstBlockText(docID string) string {
	tree, err := LoadTreeByBlockID(docID)
	if err != nil {
		return ""
	}
	root := tree.Root
	if root == nil {
		return ""
	}
	for child := root.FirstChild; child != nil; child = child.Next {
		typ := treenode.TypeAbbr(child.Type.String())
		if typ == "p" || typ == "h1" || typ == "h2" {
			text := strings.TrimSpace(child.Text())
			if text != "" {
				if len(text) > 200 {
					text = text[:200] + "..."
				}
				return text
			}
		}
	}
	return ""
}

func readDocMarkdown(docID string) string {
	tree, err := LoadTreeByBlockID(docID)
	if err != nil {
		return ""
	}
	b, _ := GetBlock(docID, tree)
	if b == nil {
		return ""
	}
	return b.Markdown
}
