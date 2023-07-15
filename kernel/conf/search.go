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

package conf

import (
	"bytes"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type Search struct {
	Document   bool `json:"document"`
	Heading    bool `json:"heading"`
	List       bool `json:"list"`
	ListItem   bool `json:"listItem"`
	CodeBlock  bool `json:"codeBlock"`
	MathBlock  bool `json:"mathBlock"`
	Table      bool `json:"table"`
	Blockquote bool `json:"blockquote"`
	SuperBlock bool `json:"superBlock"`
	Paragraph  bool `json:"paragraph"`
	HTMLBlock  bool `json:"htmlBlock"`
	EmbedBlock bool `json:"embedBlock"`

	Limit         int  `json:"limit"`
	CaseSensitive bool `json:"caseSensitive"`

	Name  bool `json:"name"`
	Alias bool `json:"alias"`
	Memo  bool `json:"memo"`
	IAL   bool `json:"ial"`

	IndexAssetPath bool `json:"indexAssetPath"`

	BacklinkMentionName          bool `json:"backlinkMentionName"`
	BacklinkMentionAlias         bool `json:"backlinkMentionAlias"`
	BacklinkMentionAnchor        bool `json:"backlinkMentionAnchor"`
	BacklinkMentionDoc           bool `json:"backlinkMentionDoc"`
	BacklinkMentionKeywordsLimit int  `json:"backlinkMentionKeywordsLimit"`

	VirtualRefName   bool `json:"virtualRefName"`
	VirtualRefAlias  bool `json:"virtualRefAlias"`
	VirtualRefAnchor bool `json:"virtualRefAnchor"`
	VirtualRefDoc    bool `json:"virtualRefDoc"`
}

func NewSearch() *Search {
	return &Search{
		Document:   true,
		Heading:    true,
		List:       true,
		ListItem:   true,
		CodeBlock:  true,
		MathBlock:  true,
		Table:      true,
		Blockquote: true,
		SuperBlock: true,
		Paragraph:  true,
		HTMLBlock:  true,
		EmbedBlock: false,

		Limit:         64,
		CaseSensitive: false,

		Name:  true,
		Alias: true,
		Memo:  true,
		IAL:   false,

		IndexAssetPath: true,

		BacklinkMentionName:          true,
		BacklinkMentionAlias:         false,
		BacklinkMentionAnchor:        true,
		BacklinkMentionDoc:           true,
		BacklinkMentionKeywordsLimit: 512,

		VirtualRefName:   true,
		VirtualRefAlias:  false,
		VirtualRefAnchor: true,
		VirtualRefDoc:    true,
	}
}

func (s *Search) NAMFilter(keyword string) string {
	keyword = strings.TrimSpace(keyword)
	buf := bytes.Buffer{}
	if s.Name {
		buf.WriteString(" OR name LIKE '%" + keyword + "%'")
	}
	if s.Alias {
		buf.WriteString(" OR alias LIKE '%" + keyword + "%'")
	}
	if s.Memo {
		buf.WriteString(" OR memo LIKE '%" + keyword + "%'")
	}
	return buf.String()
}

func (s *Search) TypeFilter() string {
	buf := bytes.Buffer{}
	if s.Document {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeDocument.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.Heading {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeHeading.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.List {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeList.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.ListItem {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeListItem.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.CodeBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeCodeBlock.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.MathBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeMathBlock.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.Table {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeTable.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.Blockquote {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeBlockquote.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.SuperBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeSuperBlock.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.Paragraph {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeParagraph.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.HTMLBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeHTMLBlock.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.EmbedBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeBlockQueryEmbed.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	// 无法搜索到 iframe 块、视频块和音频块 https://github.com/siyuan-note/siyuan/issues/3604
	buf.WriteString("'iframe','video','audio',")
	// 挂件块支持内置属性搜索 https://github.com/siyuan-note/siyuan/issues/4497
	buf.WriteString("'widget',")

	ret := buf.String()
	if "" == ret {
		return ret
	}
	return "(" + ret[:len(ret)-1] + ")"
}
