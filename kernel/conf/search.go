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
	Document      bool `json:"document"`
	Heading       bool `json:"heading"`
	List          bool `json:"list"`
	ListItem      bool `json:"listItem"`
	CodeBlock     bool `json:"codeBlock"`
	MathBlock     bool `json:"mathBlock"`
	Table         bool `json:"table"`
	Blockquote    bool `json:"blockquote"`
	SuperBlock    bool `json:"superBlock"`
	Paragraph     bool `json:"paragraph"`
	HTMLBlock     bool `json:"htmlBlock"`
	EmbedBlock    bool `json:"embedBlock"`
	DatabaseBlock bool `json:"databaseBlock"`
	AudioBlock    bool `json:"audioBlock"`
	VideoBlock    bool `json:"videoBlock"`
	IFrameBlock   bool `json:"iframeBlock"`
	WidgetBlock   bool `json:"widgetBlock"`

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
		Document:      true,
		Heading:       true,
		List:          false,
		ListItem:      false,
		CodeBlock:     true,
		MathBlock:     true,
		Table:         true,
		Blockquote:    false,
		SuperBlock:    false,
		Paragraph:     true,
		HTMLBlock:     true,
		EmbedBlock:    false,
		DatabaseBlock: true,
		AudioBlock:    false,
		VideoBlock:    false,
		IFrameBlock:   false,
		WidgetBlock:   false,

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
	if s.DatabaseBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeAttributeView.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.AudioBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeAudio.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.VideoBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeVideo.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.IFrameBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeIFrame.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}
	if s.WidgetBlock {
		buf.WriteByte('\'')
		buf.WriteString(treenode.TypeAbbr(ast.NodeWidget.String()))
		buf.WriteByte('\'')
		buf.WriteString(",")
	}

	ret := buf.String()
	if "" == ret {
		return ret
	}
	return "(" + ret[:len(ret)-1] + ")"
}
