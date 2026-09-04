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

package av

import (
	"fmt"
	"html"
	"math"
	"net/url"
	"path"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

type Value struct {
	ID         string  `json:"id,omitempty"`
	KeyID      string  `json:"keyID,omitempty"`      // 字段 ID
	BlockID    string  `json:"blockID,omitempty"`    // 项目 ID
	Type       KeyType `json:"type,omitempty"`       // 字段类型
	IsDetached bool    `json:"isDetached,omitempty"` // 是否为非绑定块，注意这个字段只能在主键（KeyTypeBlock）上使用，其他类型的值不要使用

	CreatedAt int64 `json:"createdAt,omitempty"`
	UpdatedAt int64 `json:"updatedAt,omitempty"`

	Block    *ValueBlock    `json:"block,omitempty"`
	Text     *ValueText     `json:"text,omitempty"`
	Number   *ValueNumber   `json:"number,omitempty"`
	Date     *ValueDate     `json:"date,omitempty"`
	MSelect  []*ValueSelect `json:"mSelect,omitempty"`
	URL      *ValueURL      `json:"url,omitempty"`
	Email    *ValueEmail    `json:"email,omitempty"`
	Phone    *ValuePhone    `json:"phone,omitempty"`
	MAsset   []*ValueAsset  `json:"mAsset,omitempty"`
	Template *ValueTemplate `json:"template,omitempty"`
	Created  *ValueCreated  `json:"created,omitempty"`
	Updated  *ValueUpdated  `json:"updated,omitempty"`
	Checkbox *ValueCheckbox `json:"checkbox,omitempty"`
	Relation *ValueRelation `json:"relation,omitempty"`
	Rollup   *ValueRollup   `json:"rollup,omitempty"`

	RenderedContent  string `json:"renderedContent,omitempty"` // 显示模板的运行时渲染结果，保存时剥离
	IsRenderAutoFill bool   `json:"-"`                         // 标识是否是渲染阶段自动填充的值，保存数据的时候要删掉
}

func (value *Value) SetUpdatedAt(mills int64) {
	value.UpdatedAt = mills
	if value.CreatedAt == value.UpdatedAt {
		value.UpdatedAt += 1000 // 防止更新时间和创建时间一样
	}
}

const CheckboxCheckedStr = "√"

func (value *Value) String(format bool) string {
	if nil == value {
		return ""
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil == value.Block {
			return ""
		}
		return strings.TrimSpace(value.Block.Content)
	case KeyTypeText:
		if nil == value.Text {
			return ""
		}
		return strings.TrimSpace(value.Text.Content)
	case KeyTypeNumber:
		if nil == value.Number {
			return ""
		}
		if format {
			return value.Number.FormattedContent
		}
		return fmt.Sprintf("%f", value.Number.Content)
	case KeyTypeDate:
		if nil == value.Date {
			return ""
		}
		if format && "" != value.Date.FormattedContent {
			return value.Date.FormattedContent
		}
		formatted := NewFormattedValueDate(value.Date.Content, value.Date.Content2, DateFormatNone, value.Date.IsNotTime, value.Date.HasEndDate)
		return formatted.FormattedContent
	case KeyTypeSelect:
		if 1 > len(value.MSelect) {
			return ""
		}
		return value.MSelect[0].Content
	case KeyTypeMSelect:
		if 1 > len(value.MSelect) {
			return ""
		}
		var ret []string
		for _, v := range value.MSelect {
			ret = append(ret, v.Content)
		}
		return strings.Join(ret, " ")
	case KeyTypeURL:
		if nil == value.URL {
			return ""
		}
		return strings.TrimSpace(value.URL.Content)
	case KeyTypeEmail:
		if nil == value.Email {
			return ""
		}
		return strings.TrimSpace(value.Email.Content)
	case KeyTypePhone:
		if nil == value.Phone {
			return ""
		}
		return strings.TrimSpace(value.Phone.Content)
	case KeyTypeMAsset:
		if 1 > len(value.MAsset) {
			return ""
		}
		var ret []string
		for _, v := range value.MAsset {
			ret = append(ret, v.Name+" "+v.Content)
		}
		return strings.Join(ret, " ")
	case KeyTypeTemplate:
		if nil == value.Template {
			return ""
		}
		return strings.TrimSpace(value.Template.Content)
	case KeyTypeCreated:
		if nil == value.Created {
			return ""
		}
		return value.Created.FormattedContent
	case KeyTypeUpdated:
		if nil == value.Updated {
			return ""
		}
		return value.Updated.FormattedContent
	case KeyTypeCheckbox:
		if nil == value.Checkbox {
			return ""
		}
		if value.Checkbox.Checked {
			return CheckboxCheckedStr
		}
		return ""
	case KeyTypeRelation:
		if nil == value.Relation || 1 > len(value.Relation.Contents) {
			return ""
		}
		var ret []string
		for _, v := range value.Relation.Contents {
			ret = append(ret, v.String(format))
		}
		return strings.TrimSpace(strings.Join(ret, ", "))
	case KeyTypeRollup:
		if nil == value.Rollup || 1 > len(value.Rollup.Contents) {
			return ""
		}
		var ret []string
		for _, v := range value.Rollup.Contents {
			ret = append(ret, v.String(format))
		}
		return strings.TrimSpace(strings.Join(ret, ", "))
	default:
		return ""
	}
}

func (value *Value) ToJSONString() string {
	data, err := gulu.JSON.MarshalJSON(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func (value *Value) Clone() (ret *Value) {
	data, err := gulu.JSON.MarshalJSON(value)
	if err != nil {
		return
	}
	err = gulu.JSON.UnmarshalJSON(data, &ret)
	if err != nil {
		return
	}
	copyValueResolvedColors(ret, value)
	return
}

func (value *Value) IsEdited() bool {
	if 1709740800000 > value.CreatedAt {
		// 说明是旧数据，认为都是编辑过的
		return true
	}

	if KeyTypeUpdated == value.Type || KeyTypeCreated == value.Type {
		return true
	}

	if KeyTypeCheckbox == value.Type {
		// 复选框不会为空，即使复选框未勾选，也不算是空，所以不能用下面的 IsEmpty 判断，这里使用更新时间判断是否编辑过 https://github.com/siyuan-note/siyuan/issues/11016
		return value.CreatedAt != value.UpdatedAt
	}

	if !value.IsEmpty() {
		return true
	}
	return value.CreatedAt != value.UpdatedAt
}

func (value *Value) IsBlank() bool {
	if nil == value {
		return true
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil == value.Block {
			return true
		}
		return "" == strings.TrimSpace(value.Block.Content)
	case KeyTypeText:
		if nil == value.Text {
			return true
		}
		return "" == strings.TrimSpace(value.Text.Content)
	case KeyTypeNumber:
		if nil == value.Number {
			return true
		}
		return !value.Number.IsNotEmpty
	case KeyTypeDate:
		if nil == value.Date {
			return true
		}
		return !value.Date.IsNotEmpty
	case KeyTypeSelect:
		if 1 > len(value.MSelect) {
			return true
		}
		return "" == strings.TrimSpace(value.MSelect[0].Content)
	case KeyTypeMSelect:
		return 1 > len(value.MSelect)
	case KeyTypeURL:
		if nil == value.URL {
			return true
		}
		return "" == strings.TrimSpace(value.URL.Content)
	case KeyTypeEmail:
		if nil == value.Email {
			return true
		}
		return "" == strings.TrimSpace(value.Email.Content)
	case KeyTypePhone:
		if nil == value.Phone {
			return true
		}
		return "" == strings.TrimSpace(value.Phone.Content)
	case KeyTypeMAsset:
		return 1 > len(value.MAsset)
	case KeyTypeTemplate:
		if nil == value.Template {
			return true
		}
		return "" == strings.TrimSpace(value.Template.Content)
	case KeyTypeCreated:
		if nil == value.Created {
			return true
		}
		return !value.Created.IsNotEmpty
	case KeyTypeUpdated:
		if nil == value.Updated {
			return true
		}
		return !value.Updated.IsNotEmpty
	case KeyTypeCheckbox:
		if nil == value.Checkbox {
			return true
		}
		return false // 复选框不会为空
	case KeyTypeRelation:
		return 1 > len(value.Relation.Contents)
	case KeyTypeRollup:
		return 1 > len(value.Rollup.Contents)
	}
	return false
}

func (value *Value) IsEmpty() bool {
	if nil == value {
		return true
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil == value.Block {
			return true
		}
		return "" == value.Block.Content
	case KeyTypeText:
		if nil == value.Text {
			return true
		}
		return "" == value.Text.Content
	case KeyTypeNumber:
		if nil == value.Number {
			return true
		}
		return !value.Number.IsNotEmpty
	case KeyTypeDate:
		if nil == value.Date {
			return true
		}
		return !value.Date.IsNotEmpty
	case KeyTypeSelect:
		if 1 > len(value.MSelect) {
			return true
		}
		return "" == value.MSelect[0].Content
	case KeyTypeMSelect:
		return 1 > len(value.MSelect)
	case KeyTypeURL:
		if nil == value.URL {
			return true
		}
		return "" == value.URL.Content
	case KeyTypeEmail:
		if nil == value.Email {
			return true
		}
		return "" == value.Email.Content
	case KeyTypePhone:
		if nil == value.Phone {
			return true
		}
		return "" == value.Phone.Content
	case KeyTypeMAsset:
		return 1 > len(value.MAsset)
	case KeyTypeTemplate:
		if nil == value.Template {
			return true
		}
		return "" == strings.TrimSpace(value.Template.Content)
	case KeyTypeCreated:
		if nil == value.Created {
			return true
		}
		return !value.Created.IsNotEmpty
	case KeyTypeUpdated:
		if nil == value.Updated {
			return true
		}
		return !value.Updated.IsNotEmpty
	case KeyTypeCheckbox:
		if nil == value.Checkbox {
			return true
		}
		return false // 复选框不会为空
	case KeyTypeRelation:
		return 1 > len(value.Relation.Contents)
	case KeyTypeRollup:
		return 1 > len(value.Rollup.Contents)
	}
	return false
}

func (value *Value) SetValByType(typ KeyType, val any) {
	switch typ {
	case KeyTypeBlock:
		value.Block = val.(*ValueBlock)
	case KeyTypeText:
		value.Text = val.(*ValueText)
	case KeyTypeNumber:
		value.Number = val.(*ValueNumber)
	case KeyTypeDate:
		value.Date = val.(*ValueDate)
	case KeyTypeSelect:
		value.MSelect = val.([]*ValueSelect)
	case KeyTypeMSelect:
		value.MSelect = val.([]*ValueSelect)
	case KeyTypeURL:
		value.URL = val.(*ValueURL)
	case KeyTypeEmail:
		value.Email = val.(*ValueEmail)
	case KeyTypePhone:
		value.Phone = val.(*ValuePhone)
	case KeyTypeMAsset:
		value.MAsset = val.([]*ValueAsset)
	case KeyTypeTemplate:
		value.Template = val.(*ValueTemplate)
	case KeyTypeCreated:
		value.Created = val.(*ValueCreated)
	case KeyTypeUpdated:
		value.Updated = val.(*ValueUpdated)
	case KeyTypeCheckbox:
		value.Checkbox = val.(*ValueCheckbox)
	case KeyTypeRelation:
		value.Relation = val.(*ValueRelation)
	case KeyTypeRollup:
		value.Rollup = val.(*ValueRollup)
	}
}

func (value *Value) GetValByType(typ KeyType) (ret any) {
	// 单独处理汇总
	if KeyTypeRollup == value.Type {
		if 1 > len(value.Rollup.Contents) {
			return nil
		}
		return value.Rollup.Contents[0].GetValByType(typ)
	}

	switch typ {
	case KeyTypeBlock:
		return value.Block
	case KeyTypeText:
		return value.Text
	case KeyTypeNumber:
		return value.Number
	case KeyTypeDate:
		return value.Date
	case KeyTypeSelect:
		return value.MSelect
	case KeyTypeMSelect:
		return value.MSelect
	case KeyTypeURL:
		return value.URL
	case KeyTypeEmail:
		return value.Email
	case KeyTypePhone:
		return value.Phone
	case KeyTypeMAsset:
		return value.MAsset
	case KeyTypeTemplate:
		return value.Template
	case KeyTypeCreated:
		return value.Created
	case KeyTypeUpdated:
		return value.Updated
	case KeyTypeCheckbox:
		return value.Checkbox
	case KeyTypeRelation:
		return value.Relation
	case KeyTypeRollup:
		return value.Rollup
	}
	return
}

type BlockRefSubtype string

const (
	BlockRefSubtypeStatic  BlockRefSubtype = "s"
	BlockRefSubtypeDynamic BlockRefSubtype = "d"
)

func (subtype BlockRefSubtype) IsValid() bool {
	return BlockRefSubtypeStatic == subtype || BlockRefSubtypeDynamic == subtype
}

type ValueBlock struct {
	ID         string          `json:"id,omitempty"` // 绑定的块 ID，非绑定块时为空
	Icon       string          `json:"icon,omitempty"`
	Content    string          `json:"content"`
	RefSubtype BlockRefSubtype `json:"refSubtype,omitempty"`
	Created    int64           `json:"created,omitempty"`
	Updated    int64           `json:"updated,omitempty"`
}

func (value *Value) NormalizeBlockRefSubtype(avID string, attrs map[string]string) (changed bool) {
	if nil == value || KeyTypeBlock != value.Type || nil == value.Block {
		return
	}

	expected := BlockRefSubtype("")
	if !value.IsDetached && "" != value.Block.ID {
		if value.Block.RefSubtype.IsValid() {
			return
		}

		expected = BlockRefSubtypeDynamic
		if staticText := attrs[NodeAttrViewStaticText+"-"+avID]; "" != staticText {
			expected = BlockRefSubtypeStatic
			if value.Block.Content != staticText {
				value.Block.Content = staticText
				changed = true
			}
		}
	}
	if value.Block.RefSubtype != expected {
		value.Block.RefSubtype = expected
		changed = true
	}
	return
}

type ValueText struct {
	Content string         `json:"content"`
	Rich    *ValueTextRich `json:"rich,omitempty"`
}

const ValueTextRichSpec = 1

type ValueTextRichFormat string

const ValueTextRichFormatKramdown ValueTextRichFormat = "kramdown"

// ValueTextRich 描述文本字段的富文本源，Content 是 SiYuan Kramdown 片段。
type ValueTextRich struct {
	Spec    int                 `json:"spec"`
	Format  ValueTextRichFormat `json:"format"`
	Content string              `json:"content"`
}

// IsRich 返回文本值是否包含富文本源。
func (value *ValueText) IsRich() bool {
	return nil != value && nil != value.Rich
}

// ParseValueTextRich 校验并解析文本字段的富文本源。
func ParseValueTextRich(rich *ValueTextRich) (tree *parse.Tree, err error) {
	_, tree, err = parseValueTextRich(rich)
	return
}

func parseValueTextRich(rich *ValueTextRich) (blockDOM string, tree *parse.Tree, err error) {
	if nil == rich {
		return
	}
	if ValueTextRichSpec != rich.Spec {
		err = fmt.Errorf("unsupported attribute view rich text spec [%d]", rich.Spec)
		return
	}
	if ValueTextRichFormatKramdown != rich.Format {
		err = fmt.Errorf("unsupported attribute view rich text format [%s]", rich.Format)
		return
	}

	luteEngine := newValueTextRichLute()
	content, protectedStyleEntities, protectErr := protectValueTextRichKramdownStyleEntities(rich.Content)
	if nil != protectErr {
		err = protectErr
		return
	}
	blockDOM, tree = luteEngine.Md2BlockDOMTree(content, true)
	if nil == tree || nil == tree.Root {
		err = fmt.Errorf("parse attribute view rich text failed")
		return
	}
	if 0 < len(protectedStyleEntities) {
		if err = restoreValueTextRichTreeStyleEntities(tree, protectedStyleEntities); nil != err {
			return
		}
		blockDOM = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	}
	err = validateValueTextRichTree(tree)
	return
}

func validateValueTextRichTree(tree *parse.Tree) (err error) {
	if nil == tree || nil == tree.Root {
		return fmt.Errorf("attribute view rich text tree is missing")
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if !isAllowedValueTextRichNode(node) {
			err = fmt.Errorf("unsupported attribute view rich text node [%s]", node.Type.String())
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

// newValueTextRichLute 固定启用存储格式支持的语法，避免编辑器开关变化后重解释既有数据。
func newValueTextRichLute() *lute.Lute {
	ret := lute.New()
	ret.SetTextMark(true)
	ret.SetEmoji(false)
	ret.SetProtyleWYSIWYG(true)
	ret.SetBlockRef(true)
	ret.SetFileAnnotationRef(true)
	ret.SetKramdownIAL(true)
	ret.SetHTMLTag2TextMark(true)
	ret.SetSuperBlock(true)
	ret.SetCustomBlock(true)
	ret.SetImgPathAllowSpace(true)
	ret.SetGitConflict(true)
	ret.SetInlineAsterisk(true)
	ret.SetInlineUnderscore(true)
	ret.SetSup(true)
	ret.SetSub(true)
	ret.SetTag(true)
	ret.SetInlineMath(true)
	ret.SetGFMStrikethrough(true)
	ret.SetFullWidthStrikethrough(true)
	ret.SetGFMStrikethrough1(false)
	ret.SetMark(true)
	ret.SetInlineMathAllowDigitAfterOpenMarker(true)
	ret.SetFootnotes(false)
	ret.SetToC(false)
	ret.SetIndentCodeBlock(false)
	ret.SetParagraphBeginningSpace(true)
	ret.SetAutoSpace(false)
	ret.SetHeadingID(false)
	ret.SetSetext(false)
	ret.SetYamlFrontMatter(false)
	ret.SetLinkRef(false)
	ret.SetCodeSyntaxHighlight(false)
	ret.SetSanitize(true)
	ret.SetUnorderedListMarker("-")
	ret.SetCallout(true)
	ret.SetDataTask(true)
	ret.SetArbitraryTaskListItemMarker(true)
	ret.SetExportNormalizeTaskListMarker(false)
	ret.SetEnsureListItemParagraph(true)
	return ret
}

func isAllowedValueTextRichNode(node *ast.Node) bool {
	if nil == node {
		return false
	}
	switch node.Type {
	case ast.NodeDocument, ast.NodeParagraph,
		ast.NodeBlockquote, ast.NodeBlockquoteMarker,
		ast.NodeList, ast.NodeListItem, ast.NodeTaskListItemMarker,
		ast.NodeCodeBlockFenceOpenMarker, ast.NodeCodeBlockFenceCloseMarker, ast.NodeCodeBlockCode,
		ast.NodeMathBlock, ast.NodeMathBlockOpenMarker, ast.NodeMathBlockContent, ast.NodeMathBlockCloseMarker,
		ast.NodeText,
		ast.NodeEmphasis, ast.NodeEmA6kOpenMarker, ast.NodeEmA6kCloseMarker, ast.NodeEmU8eOpenMarker,
		ast.NodeEmU8eCloseMarker,
		ast.NodeStrong, ast.NodeStrongA6kOpenMarker, ast.NodeStrongA6kCloseMarker, ast.NodeStrongU8eOpenMarker,
		ast.NodeStrongU8eCloseMarker,
		ast.NodeCodeSpan, ast.NodeCodeSpanOpenMarker, ast.NodeCodeSpanContent, ast.NodeCodeSpanCloseMarker,
		ast.NodeHardBreak, ast.NodeSoftBreak,
		ast.NodeLink, ast.NodeOpenBracket, ast.NodeCloseBracket, ast.NodeOpenParen,
		ast.NodeCloseParen, ast.NodeLinkText, ast.NodeLinkTitle, ast.NodeLinkSpace,
		ast.NodeHTMLEntity, ast.NodeLess, ast.NodeGreater,
		ast.NodeStrikethrough, ast.NodeStrikethrough1OpenMarker, ast.NodeStrikethrough1CloseMarker,
		ast.NodeStrikethrough2OpenMarker, ast.NodeStrikethrough2CloseMarker,
		ast.NodeEmoji, ast.NodeEmojiUnicode, ast.NodeEmojiAlias,
		ast.NodeInlineMath, ast.NodeInlineMathOpenMarker, ast.NodeInlineMathContent, ast.NodeInlineMathCloseMarker,
		ast.NodeBackslash, ast.NodeBackslashContent,
		ast.NodeBlockRef, ast.NodeBlockRefID, ast.NodeBlockRefSpace, ast.NodeBlockRefText,
		ast.NodeBlockRefDynamicText,
		ast.NodeMark, ast.NodeMark1OpenMarker, ast.NodeMark1CloseMarker, ast.NodeMark2OpenMarker,
		ast.NodeMark2CloseMarker,
		ast.NodeTag, ast.NodeTagOpenMarker, ast.NodeTagCloseMarker,
		ast.NodeSup, ast.NodeSupOpenMarker, ast.NodeSupCloseMarker,
		ast.NodeSub, ast.NodeSubOpenMarker, ast.NodeSubCloseMarker,
		ast.NodeKbd, ast.NodeKbdOpenMarker, ast.NodeKbdCloseMarker,
		ast.NodeUnderline, ast.NodeUnderlineOpenMarker, ast.NodeUnderlineCloseMarker,
		ast.NodeBr,
		ast.NodeFileAnnotationRef, ast.NodeFileAnnotationRefID, ast.NodeFileAnnotationRefSpace,
		ast.NodeFileAnnotationRefText:
		return true
	case ast.NodeLinkDest:
		return isAllowedValueTextRichLinkTarget(node.TokensStr())
	case ast.NodeCodeBlock, ast.NodeCodeBlockFenceInfoMarker:
		return !isValueTextRichExecutableCodeFence(node.CodeBlockInfo)
	case ast.NodeKramdownBlockIAL:
		return isAllowedValueTextRichBlockIAL(node)
	case ast.NodeKramdownSpanIAL:
		return isAllowedValueTextRichSpanIAL(node)
	case ast.NodeTextMark:
		return isAllowedValueTextMark(node)
	}
	return false
}

func isValueTextRichExecutableCodeFence(info []byte) bool {
	fields := strings.Fields(strings.ToLower(string(info)))
	if 1 > len(fields) {
		return false
	}
	switch fields[0] {
	case "abc", "echarts", "flowchart", "graphviz", "infographic", "mermaid", "mindmap", "plantuml":
		return true
	}
	return false
}

func isAllowedValueTextMark(node *ast.Node) bool {
	if !isAllowedValueTextMarkType(node) || !isAllowedValueTextMarkReferenceData(node) {
		return false
	}
	if 1 > len(node.KramdownIAL) {
		return nil == node.Next || ast.NodeKramdownSpanIAL != node.Next.Type
	}
	return nil != node.Next && ast.NodeKramdownSpanIAL == node.Next.Type &&
		isAllowedValueTextRichSpanIAL(node.Next)
}

func isAllowedValueTextMarkType(node *ast.Node) bool {
	if "" == node.TextMarkType || "" != node.TextMarkFlashcardOcclusionID {
		return false
	}
	for _, typ := range strings.Fields(node.TextMarkType) {
		switch typ {
		case "text", "block-ref", "kbd", "file-annotation-ref", "a", "strong", "em", "u", "s", "mark",
			"sup", "sub", "tag", "code", "inline-math", "inline-memo":
		default:
			return false
		}
	}
	return true
}

func isAllowedValueTextMarkReferenceData(node *ast.Node) bool {
	if node.IsTextMarkType("block-ref") {
		if !ast.IsNodeIDPattern(node.TextMarkBlockRefID) ||
			("d" != node.TextMarkBlockRefSubtype && "s" != node.TextMarkBlockRefSubtype) ||
			node.IsTextMarkType("a") || node.IsTextMarkType("file-annotation-ref") ||
			node.IsTextMarkType("inline-math") || "" != node.TextMarkAHref || "" != node.TextMarkATitle ||
			"" != node.TextMarkFileAnnotationRefID || "" != node.TextMarkInlineMathContent {
			return false
		}
	} else if "" != node.TextMarkBlockRefID || "" != node.TextMarkBlockRefSubtype {
		return false
	}

	if node.IsTextMarkType("file-annotation-ref") {
		if !isAllowedValueTextMarkFileAnnotationRefID(node.TextMarkFileAnnotationRefID) ||
			node.IsTextMarkType("a") || node.IsTextMarkType("inline-math") || "" != node.TextMarkAHref ||
			"" != node.TextMarkATitle || "" != node.TextMarkInlineMathContent {
			return false
		}
	} else if "" != node.TextMarkFileAnnotationRefID {
		return false
	}

	if node.IsTextMarkType("a") {
		if !isAllowedValueTextRichLinkTarget(node.TextMarkAHref) {
			return false
		}
	} else if "" != node.TextMarkAHref || "" != node.TextMarkATitle {
		return false
	}

	if node.IsTextMarkType("inline-memo") {
		if !isAllowedValueTextRichInlineMemoContent(node.TextMarkInlineMemoContent) {
			return false
		}
	} else if "" != node.TextMarkInlineMemoContent {
		return false
	}
	return true
}

func isAllowedValueTextRichLinkTarget(target string) bool {
	if "" == target {
		return true
	}
	if target != strings.TrimSpace(target) || !utf8.ValidString(target) {
		return false
	}
	target, decodedTarget, ok := decodeValueTextRichLinkTarget(target)
	if !ok || !utf8.ValidString(decodedTarget) || target != strings.TrimSpace(target) ||
		containsValueTextRichUnsafeControl(target) ||
		containsValueTextRichUnsafeControl(decodedTarget) || strings.ContainsRune(target, '\\') ||
		strings.ContainsRune(decodedTarget, '\\') {
		return false
	}

	parsed, err := url.Parse(target)
	if nil != err {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	switch scheme {
	case "http", "https":
		return "" != parsed.Host && "" == parsed.Opaque &&
			strings.HasPrefix(strings.ToLower(target), scheme+"://")
	case "mailto", "tel":
		return "" != parsed.Opaque && strings.HasPrefix(strings.ToLower(target), scheme+":")
	case "siyuan", "web+siyuan":
		return "" != parsed.Host && "" == parsed.Opaque &&
			strings.HasPrefix(strings.ToLower(target), scheme+"://")
	case "":
		return isAllowedValueTextRichRelativeLinkTarget(target, decodedTarget, parsed)
	default:
		return false
	}
}

func decodeValueTextRichLinkTarget(target string) (ret, decoded string, ok bool) {
	ret = target
	for iteration := 0; iteration < 8; iteration++ {
		next := html.UnescapeString(ret)
		if next == ret {
			decoded, err := url.PathUnescape(ret)
			if nil != err {
				return "", "", false
			}
			return ret, decoded, true
		}
		ret = next
	}
	return "", "", false
}

func isAllowedValueTextRichRelativeLinkTarget(target, decodedTarget string, parsed *url.URL) bool {
	if strings.HasPrefix(target, "//") {
		return "" != parsed.Host
	}
	separator := strings.IndexAny(decodedTarget, "/?#")
	if colon := strings.IndexByte(decodedTarget, ':'); 0 <= colon && (0 > separator || colon < separator) {
		return false
	}
	if "" != parsed.Host {
		return false
	}
	assetPath := strings.TrimPrefix(parsed.Path, "/")
	if strings.HasPrefix(assetPath, "assets/") {
		return path.Clean(assetPath) == assetPath
	}
	return true
}

func isAllowedValueTextRichInlineMemoContent(content string) bool {
	if !utf8.ValidString(content) || containsValueTextRichMemoControl(content) {
		return false
	}
	decoded := content
	for iteration := 0; iteration < 8; iteration++ {
		next := html.UnescapeString(decoded)
		if next == decoded {
			return !containsValueTextRichHTMLTag(decoded)
		}
		decoded = next
		if containsValueTextRichMemoControl(decoded) {
			return false
		}
	}
	return false
}

func containsValueTextRichHTMLTag(content string) bool {
	for cursor := 0; cursor < len(content); cursor++ {
		if '<' != content[cursor] || cursor+1 >= len(content) {
			continue
		}
		next := content[cursor+1]
		if '!' == next || '?' == next || isValueTextRichASCIIAlpha(next) {
			return true
		}
		if '/' == next && cursor+2 < len(content) && isValueTextRichASCIIAlpha(content[cursor+2]) {
			return true
		}
	}
	return false
}

func isValueTextRichASCIIAlpha(char byte) bool {
	return 'a' <= char && char <= 'z' || 'A' <= char && char <= 'Z'
}

func containsValueTextRichMemoControl(value string) bool {
	for _, char := range value {
		if unicode.IsControl(char) && '\t' != char && '\n' != char && '\r' != char {
			return true
		}
	}
	return false
}

func containsValueTextRichUnsafeControl(value string) bool {
	for _, char := range value {
		if unicode.IsControl(char) || unicode.In(char, unicode.Cf) {
			return true
		}
	}
	return false
}

func isAllowedValueTextMarkFileAnnotationRefID(id string) bool {
	const prefix = "assets/"
	if !strings.HasPrefix(id, prefix) {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(id, prefix), "/")
	if 2 != len(parts) {
		return false
	}
	fileName := parts[0]
	if !strings.Contains(fileName, "-") || !strings.HasSuffix(strings.ToLower(fileName), ".pdf") {
		return false
	}
	fileBase := fileName[:len(fileName)-len(".pdf")]
	if 23 > len(fileBase) || !ast.IsNodeIDPattern(fileBase[len(fileBase)-22:]) {
		return false
	}
	return ast.IsNodeIDPattern(parts[1])
}

func isAllowedValueTextRichSpanIAL(node *ast.Node) bool {
	if nil == node || nil == node.Previous || ast.NodeTextMark != node.Previous.Type ||
		!isAllowedValueTextMarkType(node.Previous) || !node.Previous.IsTextMarkType("text") {
		return false
	}
	markIAL := node.Previous.KramdownIAL
	spanIAL := parse.Tokens2IAL(node.Tokens)
	if 1 != len(markIAL) || 1 != len(spanIAL) || 2 != len(markIAL[0]) || 2 != len(spanIAL[0]) ||
		"style" != markIAL[0][0] || "style" != spanIAL[0][0] {
		return false
	}
	style := node.Previous.IALAttr("style")
	if "" == style || style != parse.IALVal(node, "style") {
		return false
	}
	return isAllowedValueTextRichStyle(style)
}

func isAllowedValueTextRichStyle(style string) bool {
	_, ok := normalizeValueTextRichStyle(style)
	return ok
}

func normalizeValueTextRichStyle(style string) (ret string, ok bool) {
	declarations, ok := parseValueTextRichStyleDeclarations(style)
	if !ok {
		return "", false
	}
	for property, value := range declarations {
		if declarations[property], ok = normalizeValueTextRichStyleValue(property, value); !ok {
			return "", false
		}
	}
	if !valueTextRichStylePairMatches(declarations, "direction", "unicode-bidi") ||
		!valueTextRichStylePairMatches(declarations, "-webkit-text-stroke", "-webkit-text-fill-color") {
		return "", false
	}

	var normalized []string
	for _, property := range valueTextRichStylePropertyOrder {
		if value, exists := declarations[property]; exists {
			normalized = append(normalized, property+": "+value+";")
		}
	}
	if len(normalized) != len(declarations) {
		return "", false
	}
	return strings.Join(normalized, " "), true
}

func parseValueTextRichStyleDeclarations(style string) (ret map[string]string, ok bool) {
	segments, ok := splitValueTextRichStyle(style, ';')
	if !ok || 1 > len(segments) {
		return nil, false
	}
	ret = make(map[string]string, len(segments))
	for _, segment := range segments {
		parts, valid := splitValueTextRichStyle(segment, ':')
		if !valid || 2 != len(parts) {
			return nil, false
		}
		property, value := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		if "" == property || "" == value {
			return nil, false
		}
		if _, exists := ret[property]; exists {
			return nil, false
		}
		ret[property] = value
	}
	return ret, true
}

func splitValueTextRichStyle(value string, separator byte) (ret []string, ok bool) {
	value = strings.TrimSpace(value)
	if "" == value {
		return nil, false
	}
	start, parentheses := 0, 0
	var quote byte
	escaped := false
	for i := 0; i < len(value); i++ {
		character := value[i]
		if escaped {
			escaped = false
			continue
		}
		if '\\' == character {
			escaped = true
			continue
		}
		if 0 != quote {
			if quote == character {
				quote = 0
			}
			continue
		}
		if '\'' == character || '"' == character {
			quote = character
			continue
		}
		switch character {
		case '(':
			parentheses++
		case ')':
			if 1 > parentheses {
				return nil, false
			}
			parentheses--
		default:
			if separator == character && 0 == parentheses {
				part := strings.TrimSpace(value[start:i])
				if "" == part {
					if ';' == separator && i == len(value)-1 {
						start = len(value)
						continue
					}
					return nil, false
				}
				ret = append(ret, part)
				start = i + 1
				if ':' == separator {
					part = strings.TrimSpace(value[start:])
					if "" == part {
						return nil, false
					}
					ret = append(ret, part)
					return ret, true
				}
			}
		}
	}
	if escaped || 0 != quote || 0 != parentheses {
		return nil, false
	}
	if start < len(value) {
		part := strings.TrimSpace(value[start:])
		if "" == part {
			return nil, false
		}
		ret = append(ret, part)
	}
	return ret, 0 < len(ret)
}

func valueTextRichStylePairMatches(declarations map[string]string, first, second string) bool {
	_, hasFirst := declarations[first]
	_, hasSecond := declarations[second]
	return hasFirst == hasSecond
}

func normalizeValueTextRichStyleValue(property, value string) (ret string, ok bool) {
	switch property {
	case "color":
		if ret, ok = normalizeValueTextRichBuiltinPaletteValue(property, value); ok {
			return ret, true
		}
		if ret, ok = normalizeValueTextRichCustomStyleValue(property, valueTextRichCustomColorPattern, value); ok {
			return ret, true
		}
		return normalizeValueTextRichBuiltinStyleValue(property, value)
	case "background-color":
		if ret, ok = normalizeValueTextRichBuiltinPaletteValue(property, value); ok {
			return ret, true
		}
		if ret, ok = normalizeValueTextRichCustomStyleValue(property, valueTextRichCustomBackgroundPattern, value); ok {
			return ret, true
		}
		return normalizeValueTextRichBuiltinStyleValue(property, value)
	case "font-size":
		return normalizeValueTextRichFontSize(value)
	case "font-family":
		return normalizeValueTextRichFontFamily(value)
	case "direction":
		return value, "ltr" == value || "rtl" == value
	case "unicode-bidi":
		return value, "isolate" == value
	case "-webkit-text-stroke":
		return value, valueTextRichHollowStroke == value
	case "-webkit-text-fill-color":
		return value, valueTextRichHollowFill == value
	case "text-shadow":
		return value, valueTextRichTextShadow == value
	}
	return "", false
}

func normalizeValueTextRichFontSize(value string) (ret string, ok bool) {
	if match := valueTextRichFontSizePXPattern.FindStringSubmatch(value); 2 == len(match) {
		size, err := strconv.Atoi(match[1])
		if nil == err && 9 <= size && size <= 72 {
			return strconv.Itoa(size) + "px", true
		}
		return "", false
	}
	if !valueTextRichFontSizeEMPattern.MatchString(value) {
		return "", false
	}
	number := strings.TrimSuffix(value, "em")
	size, err := strconv.ParseFloat(number, 64)
	if nil != err || size < 0.56 || 4.5 < size {
		return "", false
	}
	return strconv.FormatFloat(size, 'f', -1, 64) + "em", true
}

func normalizeValueTextRichFontFamily(value string) (ret string, ok bool) {
	if 2048 < len(value) {
		return "", false
	}
	parts, ok := splitValueTextRichStyle(value, ',')
	if !ok || 4 != len(parts) || "var(--b3-font-family-emoji-reset)" != parts[0] ||
		"var(--b3-font-family-editor)" != parts[2] || "var(--b3-font-family)" != parts[3] {
		return "", false
	}
	quoted := parts[1]
	if 2 > len(quoted) || quoted[0] != quoted[len(quoted)-1] || ('\'' != quoted[0] && '"' != quoted[0]) {
		return "", false
	}
	escaped := quoted[1 : len(quoted)-1]
	family, ok := unescapeValueTextRichCSSString(escaped)
	if !ok || "" == family || 256 < utf8.RuneCountInString(family) {
		return "", false
	}
	normalizedFamily := strings.ToLower(family)
	if "emojis additional" == normalizedFamily || "emojis reset" == normalizedFamily ||
		"inherit" == normalizedFamily || "initial" == normalizedFamily || "revert" == normalizedFamily ||
		"revert-layer" == normalizedFamily || "unset" == normalizedFamily || strings.HasPrefix(normalizedFamily, "var(") {
		return "", false
	}
	return "var(--b3-font-family-emoji-reset), '" + escapeValueTextRichCSSString(family) +
		"', var(--b3-font-family-editor), var(--b3-font-family)", true
}

func unescapeValueTextRichCSSString(value string) (ret string, ok bool) {
	var builder strings.Builder
	for i := 0; i < len(value); {
		if '\\' != value[i] {
			character, size := utf8.DecodeRuneInString(value[i:])
			if utf8.RuneError == character && 1 == size {
				return "", false
			}
			builder.WriteRune(character)
			i += size
			continue
		}
		i++
		if len(value) <= i {
			return "", false
		}
		start := i
		for i < len(value) && i-start < 6 && isValueTextRichCSSHex(value[i]) {
			i++
		}
		if start < i {
			codePoint, err := strconv.ParseInt(value[start:i], 16, 32)
			if nil != err || 0 == codePoint || 0x10ffff < codePoint {
				builder.WriteRune(utf8.RuneError)
			} else {
				builder.WriteRune(rune(codePoint))
			}
			if i < len(value) && isValueTextRichCSSWhitespace(value[i]) {
				i++
			}
			continue
		}
		character, size := utf8.DecodeRuneInString(value[i:])
		if utf8.RuneError == character && 1 == size {
			return "", false
		}
		builder.WriteRune(character)
		i += size
	}
	return builder.String(), true
}

func escapeValueTextRichCSSString(value string) string {
	var builder strings.Builder
	for _, character := range value {
		switch {
		case '"' == character:
			builder.WriteString(`\22 `)
		case '\'' == character || '\\' == character:
			builder.WriteByte('\\')
			builder.WriteRune(character)
		case character < 32 || 127 == character:
			builder.WriteByte('\\')
			builder.WriteString(strconv.FormatInt(int64(character), 16))
			builder.WriteByte(' ')
		default:
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

func isValueTextRichCSSHex(character byte) bool {
	return '0' <= character && character <= '9' || 'a' <= character && character <= 'f' ||
		'A' <= character && character <= 'F'
}

func isValueTextRichCSSWhitespace(character byte) bool {
	switch character {
	case ' ', '\t', '\n', '\r', '\f':
		return true
	}
	return false
}

func normalizeValueTextRichCustomStyleValue(property string, pattern *regexp.Regexp, value string) (ret string, ok bool) {
	match := pattern.FindStringSubmatch(value)
	if 3 != len(match) || !ast.IsNodeIDPattern(match[1]) {
		return "", false
	}
	return fmt.Sprintf("var(--b3-inline-style-%s-%s, %s)", match[1], property, strings.ToLower(match[2])), true
}

func normalizeValueTextRichBuiltinPaletteValue(property, value string) (ret string, ok bool) {
	match := valueTextRichBuiltinPalettePattern.FindStringSubmatch(value)
	if 3 != len(match) || "color" == property && "color" != match[1] ||
		"background-color" == property && "background" != match[1] {
		return "", false
	}
	index, err := strconv.Atoi(match[2])
	if nil != err || 1 > index || 13 < index {
		return "", false
	}
	return fmt.Sprintf("var(--b3-font-%s%d)", match[1], index), true
}

func normalizeValueTextRichBuiltinStyleValue(property, value string) (ret string, ok bool) {
	valueSuffix, legacySuffix := "color", "color"
	if "background-color" == property {
		valueSuffix, legacySuffix = "background-color", "background"
	}
	match := valueTextRichBuiltinStylePattern.FindStringSubmatch(value)
	if 5 != len(match) || match[1] != match[3] || match[2] != valueSuffix || match[4] != legacySuffix {
		return "", false
	}
	return fmt.Sprintf("var(--b3-inline-builtin-%s-%s, var(--b3-card-%s-%s))",
		match[1], valueSuffix, match[1], legacySuffix), true
}

func normalizeValueTextRichTreeStyles(tree *parse.Tree) (err error) {
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeTextMark != node.Type || 1 > len(node.KramdownIAL) {
			return ast.WalkContinue
		}
		style := node.IALAttr("style")
		var normalized string
		var ok bool
		if normalized, ok = normalizeValueTextRichStyle(style); !ok {
			err = fmt.Errorf("unsupported attribute view rich text style")
			return ast.WalkStop
		}
		node.SetIALAttr("style", normalized)
		node.Next.Tokens = parse.IAL2Tokens(node.KramdownIAL)
		return ast.WalkContinue
	})
	return
}

func isAllowedValueTextRichBlockIAL(node *ast.Node) bool {
	ial := parse.Tokens2IAL(node.Tokens)
	if 1 > len(ial) {
		return false
	}
	hasID := false
	for _, attr := range ial {
		if 2 != len(attr) {
			return false
		}
		switch attr[0] {
		case "id":
			if !ast.IsNodeIDPattern(attr[1]) {
				return false
			}
			hasID = true
		case "updated":
			if !isValueTextRichTimestamp(attr[1]) {
				return false
			}
		case "type":
			if "doc" != attr[1] {
				return false
			}
		default:
			return false
		}
	}
	return hasID
}

func isValueTextRichTimestamp(value string) bool {
	if 14 != len(value) {
		return false
	}
	for _, digit := range value {
		if digit < '0' || '9' < digit {
			return false
		}
	}
	return true
}

var valueTextRichBlockDOMStructuralAttrs = regexp.MustCompile(`\s(?:data-node-id|data-node-index|updated)="[^"]*"`)

const (
	valueTextRichHollowStroke = "0.2px var(--b3-theme-on-background)"
	valueTextRichHollowFill   = "transparent"
	valueTextRichTextShadow   = "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), " +
		"3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)"
)

var valueTextRichStylePropertyOrder = []string{
	"color",
	"background-color",
	"font-size",
	"font-family",
	"-webkit-text-stroke",
	"-webkit-text-fill-color",
	"text-shadow",
	"direction",
	"unicode-bidi",
}

var (
	valueTextRichBuiltinPalettePattern = regexp.MustCompile(`^var\(--b3-font-(color|background)(\d+)\)$`)
	valueTextRichBuiltinStylePattern   = regexp.MustCompile(
		`^var\(--b3-inline-builtin-(error|warning|info|success)-(color|background-color),\s*` +
			`var\(--b3-card-(error|warning|info|success)-(color|background)\)\)$`,
	)
	valueTextRichCustomColorPattern = regexp.MustCompile(
		`^var\(--b3-inline-style-([0-9]{14}-[a-z0-9]{7})-color,\s*(#[0-9A-Fa-f]{6})\)$`,
	)
	valueTextRichCustomBackgroundPattern = regexp.MustCompile(
		`^var\(--b3-inline-style-([0-9]{14}-[a-z0-9]{7})-background-color,\s*(#[0-9A-Fa-f]{6})\)$`,
	)
	valueTextRichFontSizePXPattern = regexp.MustCompile(`^(\d+)(?:\.0{1,2})?px$`)
	valueTextRichFontSizeEMPattern = regexp.MustCompile(`^(?:(\d+)(?:\.(\d{1,2}))?|\.(\d{1,2}))em$`)
)

// RenderValueTextRich 将经过校验的富文本语法树序列化为 SiYuan Kramdown。
func RenderValueTextRich(tree *parse.Tree) (content string, err error) {
	if err = validateValueTextRichTree(tree); nil != err {
		return
	}
	content, _, err = normalizeValueTextRichTreeSource(tree)
	return
}

func valueTextRichBlockDOM2Kramdown(luteEngine *lute.Lute, blockDOM string) string {
	blockDOM = valueTextRichBlockDOMStructuralAttrs.ReplaceAllString(blockDOM, "")
	blockDOM, backslashSentinel, backtickSentinel := protectValueTextRichBlockDOMStyleCharacters(blockDOM)
	markdown := strings.TrimSpace(luteEngine.BlockDOM2Md(blockDOM))
	if "" != backtickSentinel {
		markdown = strings.ReplaceAll(markdown, backtickSentinel, "&#96;")
		markdown = strings.ReplaceAll(markdown, backslashSentinel, "&#92;")
	}
	return markdown
}

func protectValueTextRichBlockDOMStyleCharacters(blockDOM string) (ret, backslashSentinel, backtickSentinel string) {
	if !strings.ContainsAny(blockDOM, "\\`") {
		return blockDOM, "", ""
	}
	backslashSentinel = newValueTextRichBackslashSentinel(blockDOM)
	backtickSentinel = newValueTextRichBackslashSentinel(blockDOM + backslashSentinel)

	var builder strings.Builder
	remaining := blockDOM
	for {
		start := strings.Index(remaining, "<span")
		if 0 > start {
			builder.WriteString(remaining)
			break
		}
		builder.WriteString(remaining[:start])
		remaining = remaining[start:]
		end := valueTextRichBlockDOMTagEnd(remaining)
		if 0 > end {
			builder.WriteString(remaining)
			break
		}
		tag := remaining[:end+1]
		dataType, hasDataType := valueTextRichBlockDOMAttribute(tag, "data-type")
		style, hasStyle := valueTextRichBlockDOMAttribute(tag, "style")
		if hasDataType && hasStyle && containsValueTextRichDataType(dataType, "text") &&
			strings.ContainsAny(style, "\\`") {
			protectedStyle := strings.ReplaceAll(style, `\`, backslashSentinel)
			protectedStyle = strings.ReplaceAll(protectedStyle, "`", backtickSentinel)
			tag = strings.Replace(tag, `style="`+style+`"`, `style="`+protectedStyle+`"`, 1)
		}
		builder.WriteString(tag)
		remaining = remaining[end+1:]
	}
	return builder.String(), backslashSentinel, backtickSentinel
}

func valueTextRichBlockDOMTagEnd(tag string) int {
	var quote byte
	for i := len("<span"); i < len(tag); i++ {
		character := tag[i]
		if 0 != quote {
			if quote == character {
				quote = 0
			}
			continue
		}
		if '\'' == character || '"' == character {
			quote = character
			continue
		}
		if '>' == character {
			return i
		}
	}
	return -1
}

func valueTextRichBlockDOMAttribute(tag, name string) (value string, ok bool) {
	marker := " " + name + `="`
	start := strings.Index(tag, marker)
	if 0 > start {
		return "", false
	}
	start += len(marker)
	end := strings.IndexByte(tag[start:], '"')
	if 0 > end {
		return "", false
	}
	return tag[start : start+end], true
}

func containsValueTextRichDataType(dataType, expected string) bool {
	for _, typ := range strings.Fields(dataType) {
		if expected == typ {
			return true
		}
	}
	return false
}

type valueTextRichStyleEntityProtection struct {
	sentinel string
	token    string
	encoded  string
	decoded  string
}

type valueTextRichLiteralRange struct {
	start int
	end   int
}

func protectValueTextRichKramdownStyleEntities(markdown string) (ret string,
	protections []valueTextRichStyleEntityProtection, err error) {
	const marker = `</span>{:`
	if !strings.Contains(markdown, marker) {
		return markdown, nil, nil
	}
	sentinel := newValueTextRichBackslashSentinel(markdown)
	literalRanges := valueTextRichLiteralMarkdownRanges(markdown)
	literalRangeIndex := 0
	var builder strings.Builder
	cursor := 0
	for {
		start := strings.Index(markdown[cursor:], marker)
		if 0 > start {
			builder.WriteString(markdown[cursor:])
			break
		}
		start += cursor
		builder.WriteString(markdown[cursor:start])
		for literalRangeIndex < len(literalRanges) && literalRanges[literalRangeIndex].end <= start {
			literalRangeIndex++
		}
		if literalRangeIndex < len(literalRanges) && literalRanges[literalRangeIndex].start <= start {
			builder.WriteString(marker)
			cursor = start + len(marker)
			continue
		}
		ialStart := start + len("</span>")
		valueStart, valueEnd, ialEnd, ok := valueTextRichSpanIALStyleBounds(markdown[ialStart:])
		if !ok {
			return "", nil, fmt.Errorf("invalid attribute view rich text span style IAL")
		}
		valueStart += ialStart
		valueEnd += ialStart
		ialEnd += ialStart
		builder.WriteString(markdown[start:valueStart])
		style, protected := protectValueTextRichStyleEntities(markdown[valueStart:valueEnd],
			sentinel, len(protections))
		builder.WriteString(style)
		protections = append(protections, protected...)
		builder.WriteString(markdown[valueEnd:ialEnd])
		cursor = ialEnd
	}
	return builder.String(), protections, nil
}

func valueTextRichSpanIALStyleBounds(ial string) (valueStart, valueEnd, end int, ok bool) {
	if !strings.HasPrefix(ial, "{: ") && !strings.HasPrefix(ial, "{:\t") &&
		!strings.HasPrefix(ial, "{:\n") && !strings.HasPrefix(ial, "{:\r") {
		return 0, 0, 0, false
	}
	position := 2
	for position < len(ial) && isValueTextRichCSSWhitespace(ial[position]) {
		position++
	}
	nameStart := position
	for position < len(ial) && ('a' <= ial[position] && ial[position] <= 'z' || '-' == ial[position]) {
		position++
	}
	if "style" != ial[nameStart:position] {
		return 0, 0, 0, false
	}
	for position < len(ial) && isValueTextRichCSSWhitespace(ial[position]) {
		position++
	}
	if len(ial) <= position || '=' != ial[position] {
		return 0, 0, 0, false
	}
	position++
	for position < len(ial) && isValueTextRichCSSWhitespace(ial[position]) {
		position++
	}
	if len(ial) <= position || ('\'' != ial[position] && '"' != ial[position]) {
		return 0, 0, 0, false
	}
	quote := ial[position]
	valueStart = position + 1
	valueEnd = strings.IndexByte(ial[valueStart:], quote)
	if 0 > valueEnd {
		return 0, 0, 0, false
	}
	valueEnd += valueStart
	position = valueEnd + 1
	for position < len(ial) && isValueTextRichCSSWhitespace(ial[position]) {
		position++
	}
	if len(ial) <= position || '}' != ial[position] {
		return 0, 0, 0, false
	}
	return valueStart, valueEnd, position + 1, true
}

func valueTextRichLiteralMarkdownRanges(markdown string) (ret []valueTextRichLiteralRange) {
	blockRanges := valueTextRichBlockLiteralMarkdownRanges(markdown)
	cursor := 0
	for _, blockRange := range blockRanges {
		if cursor < blockRange.start {
			ret = append(ret, valueTextRichCodeSpanRanges(markdown[cursor:blockRange.start], cursor)...)
		}
		ret = append(ret, blockRange)
		cursor = blockRange.end
	}
	if cursor < len(markdown) {
		ret = append(ret, valueTextRichCodeSpanRanges(markdown[cursor:], cursor)...)
	}
	return
}

func valueTextRichBlockLiteralMarkdownRanges(markdown string) (ret []valueTextRichLiteralRange) {
	var fence byte
	var fenceLength int
	inMathBlock := false
	literalStart := -1
	for offset := 0; offset <= len(markdown); {
		end := strings.IndexByte(markdown[offset:], '\n')
		if 0 > end {
			end = len(markdown)
		} else {
			end += offset
		}
		nextLine := end
		if end < len(markdown) {
			nextLine++
		}
		line := strings.TrimSpace(stripValueTextRichMarkdownContainer(markdown[offset:end]))
		inLiteral := 0 != fence || inMathBlock
		if 0 != fence {
			if isValueTextRichClosingFence(line, fence, fenceLength) {
				fence, fenceLength = 0, 0
			}
		} else if inMathBlock {
			if "$$" == line {
				inMathBlock = false
			}
		} else if marker, length := valueTextRichOpeningFence(line); 0 != marker {
			fence, fenceLength, inLiteral = marker, length, true
		} else if "$$" == line {
			inMathBlock, inLiteral = true, true
		}
		if inLiteral {
			if 0 > literalStart {
				literalStart = offset
			}
			if 0 == fence && !inMathBlock {
				ret = append(ret, valueTextRichLiteralRange{start: literalStart, end: nextLine})
				literalStart = -1
			}
		}
		if len(markdown) == end {
			break
		}
		offset = nextLine
	}
	if 0 <= literalStart {
		ret = append(ret, valueTextRichLiteralRange{start: literalStart, end: len(markdown)})
	}
	return
}

func stripValueTextRichMarkdownContainer(line string) string {
	for {
		line = strings.TrimLeft(line, " \t")
		if strings.HasPrefix(line, ">") {
			line = strings.TrimPrefix(line, ">")
			continue
		}
		if 2 <= len(line) && ('-' == line[0] || '+' == line[0] || '*' == line[0]) &&
			(' ' == line[1] || '\t' == line[1]) {
			line = line[2:]
			continue
		}
		orderedEnd := -1
		for i := 0; i < len(line); i++ {
			if '0' <= line[i] && line[i] <= '9' {
				continue
			}
			if 0 < i && ('.' == line[i] || ')' == line[i]) && i+1 < len(line) &&
				(' ' == line[i+1] || '\t' == line[i+1]) {
				orderedEnd = i + 2
			}
			break
		}
		if 0 <= orderedEnd {
			line = line[orderedEnd:]
			continue
		}
		return line
	}
}

func valueTextRichOpeningFence(line string) (marker byte, length int) {
	if "" == line {
		return 0, 0
	}
	marker = line[0]
	if '`' != marker && '~' != marker {
		return 0, 0
	}
	for length < len(line) && marker == line[length] {
		length++
	}
	if 3 > length || ('`' == marker && strings.ContainsRune(line[length:], '`')) {
		return 0, 0
	}
	return marker, length
}

func isValueTextRichClosingFence(line string, marker byte, openingLength int) bool {
	if "" == line || marker != line[0] {
		return false
	}
	length := 0
	for length < len(line) && marker == line[length] {
		length++
	}
	return openingLength <= length && "" == strings.TrimSpace(line[length:])
}

func valueTextRichCodeSpanRanges(content string, offset int) (ret []valueTextRichLiteralRange) {
	type markerRun struct {
		start  int
		end    int
		length int
	}
	var runs []markerRun
	flushRuns := func() {
		nextSame := make([]int, len(runs))
		nextByLength := map[int]int{}
		for i := len(runs) - 1; 0 <= i; i-- {
			nextSame[i] = -1
			if next, ok := nextByLength[runs[i].length]; ok {
				nextSame[i] = next
			}
			nextByLength[runs[i].length] = i
		}
		for i := 0; i < len(runs); {
			close := nextSame[i]
			if 0 > close {
				i++
				continue
			}
			ret = append(ret, valueTextRichLiteralRange{
				start: offset + runs[i].start,
				end:   offset + runs[close].end,
			})
			i = close + 1
		}
		runs = nil
	}

	paragraphBreaks := valueTextRichParagraphBreakRanges(content)
	paragraphBreakIndex := 0
	backslashes := 0
	for index := 0; index < len(content); {
		for paragraphBreakIndex < len(paragraphBreaks) && paragraphBreaks[paragraphBreakIndex].end <= index {
			paragraphBreakIndex++
		}
		var paragraphBreak *valueTextRichLiteralRange
		if paragraphBreakIndex < len(paragraphBreaks) {
			paragraphBreak = &paragraphBreaks[paragraphBreakIndex]
			if paragraphBreak.start <= index {
				flushRuns()
				index = paragraphBreak.end
				backslashes = 0
				continue
			}
		}
		limit := len(content)
		if nil != paragraphBreak {
			limit = paragraphBreak.start
		}
		if '<' == content[index] {
			if end := valueTextRichQuotedDelimiterEnd(content, index+1, limit, '>'); 0 <= end {
				index = end + 1
				backslashes = 0
				continue
			}
		} else if strings.HasPrefix(content[index:], "{:") {
			if end := valueTextRichQuotedDelimiterEnd(content, index+2, limit, '}'); 0 <= end {
				index = end + 1
				backslashes = 0
				continue
			}
		}
		if '\\' == content[index] {
			backslashes++
			index++
			continue
		}
		if '`' != content[index] {
			backslashes = 0
			index++
			continue
		}
		length := valueTextRichMarkerRunLength(content, index, '`')
		start := index
		if 1 == backslashes%2 {
			start++
			length--
		}
		if 0 < length {
			runs = append(runs, markerRun{start: start, end: start + length, length: length})
		}
		index += valueTextRichMarkerRunLength(content, index, '`')
		backslashes = 0
	}
	flushRuns()
	return
}

func valueTextRichParagraphBreakRanges(content string) (ret []valueTextRichLiteralRange) {
	for cursor := 0; cursor < len(content); {
		lineEnd := strings.IndexByte(content[cursor:], '\n')
		if 0 > lineEnd {
			break
		}
		lineEnd += cursor
		start := lineEnd
		if 0 < start && '\r' == content[start-1] {
			start--
		}
		next := lineEnd + 1
		for next < len(content) && (' ' == content[next] || '\t' == content[next]) {
			next++
		}
		end := -1
		if len(content) == next {
			end = next
		} else if '\n' == content[next] {
			end = next + 1
		} else if '\r' == content[next] && next+1 < len(content) && '\n' == content[next+1] {
			end = next + 2
		}
		if 0 <= end {
			ret = append(ret, valueTextRichLiteralRange{start: start, end: end})
			cursor = end
			continue
		}
		cursor = lineEnd + 1
	}
	return
}

func valueTextRichQuotedDelimiterEnd(content string, start, limit int, delimiter byte) int {
	var quote byte
	escaped := false
	for i := start; i < limit; i++ {
		character := content[i]
		if escaped {
			escaped = false
			continue
		}
		if 0 != quote {
			if '\\' == character {
				escaped = true
			} else if quote == character {
				quote = 0
			}
			continue
		}
		if '\'' == character || '"' == character {
			quote = character
			continue
		}
		if delimiter == character {
			return i
		}
	}
	return -1
}

func valueTextRichMarkerRunLength(line string, start int, marker byte) int {
	length := 0
	for start+length < len(line) && marker == line[start+length] {
		length++
	}
	return length
}

func protectValueTextRichStyleEntities(style, sentinel string, offset int) (ret string,
	protections []valueTextRichStyleEntityProtection) {
	var builder strings.Builder
	remaining := style
	for {
		start := strings.IndexAny(remaining, "&`")
		if 0 > start {
			builder.WriteString(remaining)
			break
		}
		builder.WriteString(remaining[:start])
		remaining = remaining[start:]
		if '`' == remaining[0] {
			token := sentinel + strconv.Itoa(offset+len(protections)) + "\ue002"
			builder.WriteString(token)
			protections = append(protections, valueTextRichStyleEntityProtection{
				sentinel: sentinel, token: token, encoded: "`", decoded: "`",
			})
			remaining = remaining[1:]
			continue
		}
		end := strings.IndexByte(remaining, ';')
		if 0 > end {
			builder.WriteByte(remaining[0])
			remaining = remaining[1:]
			continue
		}
		encoded := remaining[:end+1]
		decoded := html.UnescapeString(encoded)
		if encoded == decoded {
			builder.WriteByte(remaining[0])
			remaining = remaining[1:]
			continue
		}
		token := sentinel + strconv.Itoa(offset+len(protections)) + "\ue002"
		builder.WriteString(token)
		protections = append(protections, valueTextRichStyleEntityProtection{
			sentinel: sentinel, token: token, encoded: encoded, decoded: decoded,
		})
		remaining = remaining[end+1:]
	}
	return builder.String(), protections
}

func restoreValueTextRichTreeStyleEntities(tree *parse.Tree,
	protections []valueTextRichStyleEntityProtection) (err error) {
	if 1 > len(protections) {
		return
	}
	sentinel := protections[0].sentinel
	stylePairs := make([]string, 0, len(protections)*2)
	literalPairs := make([]string, 0, len(protections)*2)
	textMarkCodePairs := make([]string, 0, len(protections)*2)
	textMarkInlineMathPairs := make([]string, 0, len(protections)*2)
	tokenIndexes := make(map[string]int, len(protections))
	restored := make([]bool, len(protections))
	for i, protection := range protections {
		if sentinel != protection.sentinel {
			return fmt.Errorf("inconsistent attribute view rich text style entity sentinel")
		}
		tokenIndexes[protection.token] = i
		stylePairs = append(stylePairs, protection.token, protection.decoded)
		literalPairs = append(literalPairs, protection.token, protection.encoded)
		encoded := strings.ReplaceAll(protection.encoded, "&", "&amp;")
		textMarkCodePairs = append(textMarkCodePairs, protection.token, encoded)
		textMarkInlineMathPairs = append(textMarkInlineMathPairs, protection.token,
			strings.ReplaceAll(encoded, "&", "&amp;"))
	}
	styleReplacer := strings.NewReplacer(stylePairs...)
	literalReplacer := strings.NewReplacer(literalPairs...)
	textMarkCodeReplacer := strings.NewReplacer(textMarkCodePairs...)
	textMarkInlineMathReplacer := strings.NewReplacer(textMarkInlineMathPairs...)

	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		style := node.IALAttr("style")
		styleProtected := strings.Contains(style, sentinel)
		textProtected := ast.NodeTextMark == node.Type && strings.Contains(node.TextMarkTextContent, sentinel)
		inlineMathProtected := ast.NodeTextMark == node.Type &&
			strings.Contains(node.TextMarkInlineMathContent, sentinel)
		tokens := string(node.Tokens)
		tokensProtected := strings.Contains(tokens, sentinel)
		if styleProtected {
			if !node.IsTextMarkType("text") {
				err = fmt.Errorf("encoded style entity is not attached to an attribute view rich text span")
				return ast.WalkStop
			}
			if textProtected || inlineMathProtected || tokensProtected ||
				!markValueTextRichStyleProtections(style, sentinel, tokenIndexes, restored) {
				err = fmt.Errorf("invalid encoded style entity in attribute view rich text span")
				return ast.WalkStop
			}
			style = styleReplacer.Replace(style)
			node.SetIALAttr("style", style)
			if nil != node.Next && ast.NodeKramdownSpanIAL == node.Next.Type {
				node.Next.Tokens = parse.IAL2Tokens(node.KramdownIAL)
			}
			return ast.WalkContinue
		}
		if textProtected || inlineMathProtected {
			if !node.IsTextMarkType("code") && !node.IsTextMarkType("inline-math") {
				err = fmt.Errorf("invalid encoded style entity in attribute view rich text mark [%s]", node.TextMarkType)
				return ast.WalkStop
			}
			if tokensProtected || textProtected &&
				!markValueTextRichStyleProtections(node.TextMarkTextContent, sentinel, tokenIndexes, restored) ||
				inlineMathProtected &&
					!markValueTextRichStyleProtections(node.TextMarkInlineMathContent, sentinel, tokenIndexes, restored) {
				err = fmt.Errorf("invalid encoded style entity in attribute view rich text mark [%s]", node.TextMarkType)
				return ast.WalkStop
			}
			node.TextMarkTextContent = textMarkCodeReplacer.Replace(node.TextMarkTextContent)
			node.TextMarkInlineMathContent = textMarkInlineMathReplacer.Replace(node.TextMarkInlineMathContent)
			return ast.WalkContinue
		}
		if !tokensProtected {
			return ast.WalkContinue
		}
		switch node.Type {
		case ast.NodeCodeBlockCode, ast.NodeMathBlockContent, ast.NodeCodeSpanContent, ast.NodeInlineMathContent:
			if !markValueTextRichStyleProtections(tokens, sentinel, tokenIndexes, restored) {
				err = fmt.Errorf("invalid encoded style entity in attribute view rich text node [%s]", node.Type.String())
				return ast.WalkStop
			}
			node.Tokens = []byte(literalReplacer.Replace(tokens))
		default:
			err = fmt.Errorf("invalid encoded style entity in attribute view rich text node [%s]", node.Type.String())
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if nil != err {
		return
	}
	for _, found := range restored {
		if !found {
			return fmt.Errorf("attribute view rich text style entity was not restored")
		}
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && valueTextRichNodeContainsSentinel(node, sentinel) {
			err = fmt.Errorf("attribute view rich text style entity sentinel was not removed from node [%s]",
				node.Type.String())
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

func valueTextRichNodeContainsSentinel(node *ast.Node, sentinel string) bool {
	values := []string{
		node.ID, node.Spec, node.Data, string(node.Tokens), string(node.CodeBlockOpenFence),
		string(node.CodeBlockInfo), string(node.CodeBlockCloseFence), string(node.LinkRefLabel),
		string(node.FootnotesRefLabel), node.FootnotesRefId, string(node.HtmlEntityTokens),
		node.TextMarkType, node.TextMarkAHref, node.TextMarkATitle, node.TextMarkInlineMathContent,
		node.TextMarkInlineMemoContent, node.TextMarkBlockRefID, node.TextMarkBlockRefSubtype,
		node.TextMarkFileAnnotationRefID, node.TextMarkFlashcardOcclusionID, node.TextMarkTextContent,
	}
	for _, value := range values {
		if strings.Contains(value, sentinel) {
			return true
		}
	}
	for _, attr := range node.KramdownIAL {
		for _, value := range attr {
			if strings.Contains(value, sentinel) {
				return true
			}
		}
	}
	for name, value := range node.Properties {
		if strings.Contains(name, sentinel) || strings.Contains(value, sentinel) {
			return true
		}
	}
	return false
}

func markValueTextRichStyleProtections(value, sentinel string, tokenIndexes map[string]int, restored []bool) bool {
	const suffix = "\ue002"
	for cursor := 0; cursor < len(value); {
		start := strings.Index(value[cursor:], sentinel)
		if 0 > start {
			return true
		}
		start += cursor
		end := strings.Index(value[start+len(sentinel):], suffix)
		if 0 > end {
			return false
		}
		end += start + len(sentinel) + len(suffix)
		index, ok := tokenIndexes[value[start:end]]
		if !ok {
			return false
		}
		restored[index] = true
		cursor = end
	}
	return true
}

func newValueTextRichBackslashSentinel(content string) string {
	const (
		prefix = "\ue000siyuan-av-rich-text-backslash"
		suffix = "\ue001"
	)
	maxSuffixes := 0
	for cursor := 0; cursor < len(content); {
		start := strings.Index(content[cursor:], prefix)
		if 0 > start {
			break
		}
		start += cursor + len(prefix)
		suffixes := 0
		for strings.HasPrefix(content[start:], suffix) {
			suffixes++
			start += len(suffix)
		}
		if maxSuffixes < suffixes {
			maxSuffixes = suffixes
		}
		cursor = start
	}
	return prefix + strings.Repeat(suffix, maxSuffixes+1)
}

// NormalizeValueTextRich 校验并将文本字段的富文本源规范化为 SiYuan Kramdown。
func NormalizeValueTextRich(rich *ValueTextRich) (tree *parse.Tree, err error) {
	_, tree, err = parseValueTextRich(rich)
	if nil != err || nil == rich {
		return tree, err
	}
	var normalized string
	if normalized, tree, err = normalizeValueTextRichTreeSource(tree); nil != err {
		return nil, err
	}
	rich.Content = normalized
	return tree, nil
}

func normalizeValueTextRichTreeSource(tree *parse.Tree) (content string, normalizedTree *parse.Tree, err error) {
	normalizedTree = tree
	previous := ""
	for iteration := 0; iteration < 4; iteration++ {
		if err = normalizeValueTextRichTreeStyles(normalizedTree); nil != err {
			return "", nil, err
		}
		luteEngine := newValueTextRichLute()
		blockDOM := luteEngine.Tree2BlockDOM(normalizedTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		content = valueTextRichBlockDOM2Kramdown(luteEngine, blockDOM)
		if 0 < iteration && previous == content {
			return content, normalizedTree, nil
		}
		previous = content
		candidate := &ValueTextRich{
			Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: content,
		}
		if _, normalizedTree, err = parseValueTextRich(candidate); nil != err {
			return "", nil, err
		}
	}
	return "", nil, fmt.Errorf("attribute view rich text normalization did not converge")
}

// NormalizeRichContent 校验富文本载荷，并根据富文本源刷新纯文本投影。
func (value *ValueText) NormalizeRichContent() (err error) {
	if !value.IsRich() {
		return
	}
	tree, err := NormalizeValueTextRich(value.Rich)
	if nil != err {
		return err
	}
	value.Content = valueTextRichPlainContent(tree)
	return
}

func valueTextRichPlainContent(tree *parse.Tree) string {
	if nil == tree || nil == tree.Root {
		return ""
	}
	var blocks []string
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		switch node.Type {
		case ast.NodeParagraph, ast.NodeCodeBlock, ast.NodeMathBlock:
			blocks = append(blocks, strings.TrimRight(node.Content(), "\n"))
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	if 0 == len(blocks) {
		return tree.Root.Content()
	}
	return strings.TrimRight(strings.Join(blocks, "\n"), "\n")
}

type ValueNumber struct {
	Content          float64      `json:"content"`
	IsNotEmpty       bool         `json:"isNotEmpty"`
	Format           NumberFormat `json:"format"`
	FormattedContent string       `json:"formattedContent"`
}

type NumberFormat string

const (
	NumberFormatNone    NumberFormat = ""
	NumberFormatCommas  NumberFormat = "commas"
	NumberFormatPercent NumberFormat = "percent"

	NumberFormatUSD NumberFormat = "USD" // 美元
	NumberFormatCNY NumberFormat = "CNY" // 人民币
	NumberFormatEUR NumberFormat = "EUR" // 欧元
	NumberFormatGBP NumberFormat = "GBP" // 英镑
	NumberFormatJPY NumberFormat = "JPY" // 日元
	NumberFormatRUB NumberFormat = "RUB" // 卢布
	NumberFormatINR NumberFormat = "INR" // 卢比
	NumberFormatKRW NumberFormat = "KRW" // 韩元
	NumberFormatTRY NumberFormat = "TRY" // 土耳其里拉
	NumberFormatCAD NumberFormat = "CAD" // 加拿大元
	NumberFormatCHF NumberFormat = "CHF" // 瑞士法郎
	NumberFormatTHB NumberFormat = "THB" // 泰铢
	NumberFormatAUD NumberFormat = "AUD" // 澳大利亚元
	NumberFormatHKD NumberFormat = "HKD" // 港币
	NumberFormatTWD NumberFormat = "TWD" // 新台币
	NumberFormatMOP NumberFormat = "MOP" // 澳门币
	NumberFormatSGD NumberFormat = "SGD" // 新加坡元
	NumberFormatNZD NumberFormat = "NZD" // 新西兰元
	NumberFormatILS NumberFormat = "ILS" // 以色列新谢克尔
	NumberFormatSKK NumberFormat = "SKK" // 斯洛伐克克朗
)

func NewFormattedValueNumber(content float64, format NumberFormat) (ret *ValueNumber) {
	ret = &ValueNumber{
		Content:          content,
		IsNotEmpty:       true,
		Format:           format,
		FormattedContent: fmt.Sprintf("%f", content),
	}

	ret.FormattedContent = formatNumber(content, format)

	switch format {
	case NumberFormatNone:
		s := fmt.Sprintf("%.5f", content)
		ret.FormattedContent = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return
}

func (number *ValueNumber) FormatNumber() {
	if !number.IsNotEmpty {
		number.FormattedContent = ""
	} else {
		number.FormattedContent = formatNumber(number.Content, number.Format)
	}
}

func formatNumber(content float64, format NumberFormat) string {
	switch format {
	case NumberFormatNone:
		return strconv.FormatFloat(content, 'f', -1, 64)
	case NumberFormatCommas:
		p := message.NewPrinter(language.English)
		s := p.Sprintf("%f", content)
		return strings.TrimRight(strings.TrimRight(s, "0"), ".")
	case NumberFormatPercent:
		s := fmt.Sprintf("%.2f", content*100)
		return strings.TrimRight(strings.TrimRight(s, "0"), ".") + "%"
	case NumberFormatUSD, "usDollar":
		p := message.NewPrinter(language.English)
		return p.Sprintf("$%.2f", content)
	case NumberFormatCNY, "yuan":
		p := message.NewPrinter(language.Chinese)
		return p.Sprintf("CN¥%.2f", content)
	case NumberFormatEUR, "euro":
		p := message.NewPrinter(language.German)
		return p.Sprintf("€%.2f", content)
	case NumberFormatGBP, "pound":
		p := message.NewPrinter(language.English)
		return p.Sprintf("£%.2f", content)
	case NumberFormatJPY, "yen":
		p := message.NewPrinter(language.Japanese)
		return p.Sprintf("¥%.0f", content)
	case NumberFormatRUB, "ruble":
		p := message.NewPrinter(language.Russian)
		return p.Sprintf("₽%.2f", content)
	case NumberFormatINR, "rupee":
		p := message.NewPrinter(language.Hindi)
		return p.Sprintf("₹%.2f", content)
	case NumberFormatKRW, "won":
		p := message.NewPrinter(language.Korean)
		return p.Sprintf("₩%.0f", content)
	case NumberFormatTRY, "turkishLira":
		p := message.NewPrinter(language.Turkish)
		return p.Sprintf("₺%.2f", content)
	case NumberFormatCAD, "canadianDollar":
		p := message.NewPrinter(language.English)
		return p.Sprintf("CA$%.2f", content)
	case NumberFormatCHF, "franc":
		p := message.NewPrinter(language.French)
		return p.Sprintf("CHF%.2f", content)
	case NumberFormatTHB:
		p := message.NewPrinter(language.Thai)
		return p.Sprintf("฿%.2f", content)
	case NumberFormatAUD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("A$%.2f", content)
	case NumberFormatHKD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("HK$%.2f", content)
	case NumberFormatTWD:
		p := message.NewPrinter(language.Chinese)
		return p.Sprintf("NT$%.2f", content)
	case NumberFormatMOP:
		p := message.NewPrinter(language.Chinese)
		return p.Sprintf("MOP$%.2f", content)
	case NumberFormatSGD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("S$%.2f", content)
	case NumberFormatNZD:
		p := message.NewPrinter(language.English)
		return p.Sprintf("NZ$%.2f", content)
	case NumberFormatILS:
		p := message.NewPrinter(language.Hebrew)
		return p.Sprintf("ILS₪%.2f", content)
	case NumberFormatSKK:
		p := message.NewPrinter(language.Slovak)
		return p.Sprintf("SKK%.2f", content)
	default:
		return strconv.FormatFloat(content, 'f', -1, 64)
	}
}

type ValueDate struct {
	Content          int64  `json:"content"`
	IsNotEmpty       bool   `json:"isNotEmpty"`
	HasEndDate       bool   `json:"hasEndDate"`
	IsNotTime        bool   `json:"isNotTime"`
	Content2         int64  `json:"content2"`
	IsNotEmpty2      bool   `json:"isNotEmpty2"`
	FormattedContent string `json:"formattedContent"`
}

type DateDisplayFormat string

const (
	DateDisplayFormatDefault      DateDisplayFormat = ""
	DateDisplayFormatFull         DateDisplayFormat = "full"
	DateDisplayFormatMonthDayYear DateDisplayFormat = "month-day-year"
	DateDisplayFormatDayMonthYear DateDisplayFormat = "day-month-year"
	DateDisplayFormatYearMonthDay DateDisplayFormat = "year-month-day"
)

func (format DateDisplayFormat) IsValid() bool {
	switch format {
	case DateDisplayFormatDefault, DateDisplayFormatFull, DateDisplayFormatMonthDayYear,
		DateDisplayFormatDayMonthYear, DateDisplayFormatYearMonthDay:
		return true
	}
	return false
}

func formatDateDisplay(content int64, format DateDisplayFormat, isNotTime bool) string {
	contentTime := time.UnixMilli(content)
	var formatted string
	switch format {
	case DateDisplayFormatFull:
		months := strings.Split(GetAttributeViewI18n("dateMonths"), "|")
		month := contentTime.Month().String()
		if monthIndex := int(contentTime.Month()) - 1; 0 <= monthIndex && monthIndex < len(months) {
			month = months[monthIndex]
		}
		formatted = GetAttributeViewI18n("dateFormatFullTemplate")
		formatted = strings.ReplaceAll(formatted, "${year}", strconv.Itoa(contentTime.Year()))
		formatted = strings.ReplaceAll(formatted, "${month}", month)
		formatted = strings.ReplaceAll(formatted, "${day}", strconv.Itoa(contentTime.Day()))
	case DateDisplayFormatMonthDayYear:
		formatted = contentTime.Format("01/02/2006")
	case DateDisplayFormatDayMonthYear:
		formatted = contentTime.Format("02/01/2006")
	case DateDisplayFormatYearMonthDay:
		formatted = contentTime.Format("2006/01/02")
	default:
		formatted = contentTime.Format("2006-01-02")
	}
	if !isNotTime {
		formatted += " " + contentTime.Format("15:04")
	}
	return formatted
}

func (date *ValueDate) FormatDate(format DateDisplayFormat) {
	if nil == date || !date.IsNotEmpty || 0 == date.Content {
		if nil != date {
			date.FormattedContent = ""
		}
		return
	}
	date.FormattedContent = formatDateDisplay(date.Content, format, date.IsNotTime)
	if date.HasEndDate && date.IsNotEmpty2 && 0 != date.Content2 {
		date.FormattedContent += " → " + formatDateDisplay(date.Content2, format, date.IsNotTime)
	}
}

// DateEndpoint 描述日期筛选或排序使用的时间端点。
type DateEndpoint string

const (
	DateEndpointStart DateEndpoint = "start"
	DateEndpointEnd   DateEndpoint = "end"
)

// GetByEndpoint 获取指定端点的时间和值状态，未启用结束时间时回退到开始时间。
func (date *ValueDate) GetByEndpoint(endpoint DateEndpoint) (content int64, isNotEmpty bool) {
	if nil == date {
		return
	}
	if DateEndpointEnd == endpoint && date.HasEndDate {
		return date.Content2, date.IsNotEmpty2
	}
	return date.Content, date.IsNotEmpty
}

type DateFormat string

const (
	DateFormatNone     DateFormat = ""
	DateFormatDuration DateFormat = "duration"
)

func NewFormattedValueDate(content, content2 int64, format DateFormat, isNotTime, hasEndDate bool) (ret *ValueDate) {
	var formatted string
	contentTime := time.UnixMilli(content)
	if 0 == content || contentTime.IsZero() {
		ret = &ValueDate{
			Content:          content,
			Content2:         content2,
			HasEndDate:       false,
			IsNotTime:        isNotTime,
			FormattedContent: formatted,
		}
		return
	}

	if isNotTime {
		formatted = contentTime.Format("2006-01-02")
	} else {
		formatted = contentTime.Format("2006-01-02 15:04")
	}

	content2Time := time.UnixMilli(content2)
	if hasEndDate {
		var formattedContent2 string
		if isNotTime {
			formattedContent2 = content2Time.Format("2006-01-02")
		} else {
			formattedContent2 = content2Time.Format("2006-01-02 15:04")
		}
		if !content2Time.IsZero() {
			formatted += " → " + formattedContent2
		}
	}
	switch format {
	case DateFormatNone:
	case DateFormatDuration:
		t1 := time.UnixMilli(content)
		t2 := time.UnixMilli(content2)
		formatted = util.HumanizeRelTime(t1, t2, util.Lang)
	}
	ret = &ValueDate{
		Content:          content,
		Content2:         content2,
		IsNotEmpty:       true,
		IsNotEmpty2:      !content2Time.IsZero(),
		HasEndDate:       hasEndDate,
		IsNotTime:        isNotTime,
		FormattedContent: formatted,
	}
	return
}

// RoundUp rounds like 12.3416 -> 12.35
func RoundUp(val float64, precision int) float64 {
	return math.Ceil(val*(math.Pow10(precision))) / math.Pow10(precision)
}

// RoundDown rounds like 12.3496 -> 12.34
func RoundDown(val float64, precision int) float64 {
	return math.Floor(val*(math.Pow10(precision))) / math.Pow10(precision)
}

// Round rounds to nearest like 12.3456 -> 12.35
func Round(val float64, precision int) float64 {
	return math.Round(val*(math.Pow10(precision))) / math.Pow10(precision)
}

type ValueSelect struct {
	Content       string              `json:"content"`
	Color         string              `json:"color"`                   // 1-78
	ResolvedColor *AttributeViewColor `json:"resolvedColor,omitempty"` // 渲染阶段解析后的自定义颜色
}

func MSelectRemoveOption(mSelect []*ValueSelect, opt string) (ret []*ValueSelect) {
	for _, s := range mSelect {
		if s.Content != opt {
			ret = append(ret, s)
		}
	}
	return
}

func MSelectExistOption(mSelect []*ValueSelect, opt string) bool {
	for _, s := range mSelect {
		if s.Content == opt {
			return true
		}
	}
	return false
}

type ValueURL struct {
	Content string `json:"content"`
}

type ValueEmail struct {
	Content string `json:"content"`
}

type ValuePhone struct {
	Content string `json:"content"`
}

type AssetType string

const (
	AssetTypeFile  = "file" // 链接也使用文件类型
	AssetTypeImage = "image"
)

type ValueAsset struct {
	Type    AssetType `json:"type"`
	Name    string    `json:"name"`
	Content string    `json:"content"`
}

type ValueTemplate struct {
	Content string `json:"content"`
}

type ValueCreated struct {
	Content          int64  `json:"content"`
	IsNotEmpty       bool   `json:"isNotEmpty"`
	Content2         int64  `json:"content2"`
	IsNotEmpty2      bool   `json:"isNotEmpty2"`
	FormattedContent string `json:"formattedContent"`
}

type CreatedFormat string

const (
	CreatedFormatNone     CreatedFormat = "" // 2006-01-02 15:04
	CreatedFormatDuration CreatedFormat = "duration"
)

func NewFormattedValueCreated(content, content2 int64, format CreatedFormat, isNotTime bool) (ret *ValueCreated) {
	var formatted string
	if isNotTime {
		formatted = time.UnixMilli(content).Format("2006-01-02")
	} else {
		formatted = time.UnixMilli(content).Format("2006-01-02 15:04")
	}

	if 0 < content2 {
		formatted += " → " + time.UnixMilli(content2).Format("2006-01-02 15:04")
	}
	switch format {
	case CreatedFormatNone:
	case CreatedFormatDuration:
		t1 := time.UnixMilli(content)
		t2 := time.UnixMilli(content2)
		formatted = util.HumanizeRelTime(t1, t2, util.Lang)
	}
	ret = &ValueCreated{
		Content:          content,
		IsNotEmpty:       0 != content,
		Content2:         content2,
		IsNotEmpty2:      0 != content2,
		FormattedContent: formatted,
	}
	return
}

func (created *ValueCreated) FormatDate(format DateDisplayFormat, isNotTime bool) {
	if nil == created || !created.IsNotEmpty || 0 == created.Content {
		if nil != created {
			created.FormattedContent = ""
		}
		return
	}
	created.FormattedContent = formatDateDisplay(created.Content, format, isNotTime)
	if created.IsNotEmpty2 && 0 != created.Content2 {
		created.FormattedContent += " → " + formatDateDisplay(created.Content2, format, isNotTime)
	}
}

type ValueUpdated struct {
	Content          int64  `json:"content"`
	IsNotEmpty       bool   `json:"isNotEmpty"`
	Content2         int64  `json:"content2"`
	IsNotEmpty2      bool   `json:"isNotEmpty2"`
	FormattedContent string `json:"formattedContent"`
}

type UpdatedFormat string

const (
	UpdatedFormatNone     UpdatedFormat = "" // 2006-01-02 15:04
	UpdatedFormatDuration UpdatedFormat = "duration"
)

func NewFormattedValueUpdated(content, content2 int64, format UpdatedFormat, isNotTime bool) (ret *ValueUpdated) {
	var formatted string
	if isNotTime {
		formatted = time.UnixMilli(content).Format("2006-01-02")
	} else {
		formatted = time.UnixMilli(content).Format("2006-01-02 15:04")
	}

	if 0 < content2 {
		formatted += " → " + time.UnixMilli(content2).Format("2006-01-02 15:04")
	}
	switch format {
	case UpdatedFormatNone:
	case UpdatedFormatDuration:
		t1 := time.UnixMilli(content)
		t2 := time.UnixMilli(content2)
		formatted = util.HumanizeRelTime(t1, t2, util.Lang)
	}
	ret = &ValueUpdated{
		Content:          content,
		IsNotEmpty:       0 != content,
		Content2:         content2,
		IsNotEmpty2:      0 != content2,
		FormattedContent: formatted,
	}
	return
}

func (updated *ValueUpdated) FormatDate(format DateDisplayFormat, isNotTime bool) {
	if nil == updated || !updated.IsNotEmpty || 0 == updated.Content {
		if nil != updated {
			updated.FormattedContent = ""
		}
		return
	}
	updated.FormattedContent = formatDateDisplay(updated.Content, format, isNotTime)
	if updated.IsNotEmpty2 && 0 != updated.Content2 {
		updated.FormattedContent += " → " + formatDateDisplay(updated.Content2, format, isNotTime)
	}
}

type ValueCheckbox struct {
	Checked bool `json:"checked"`
}

type ValueRelation struct {
	BlockIDs []string `json:"blockIDs"`
	Contents []*Value `json:"contents"`
}

type ValueRollup struct {
	Contents []*Value `json:"contents"`
}

type RollupRenderContext struct {
	FurtherCollection Collection
	EligibleItemIDs   map[string]bool
}

func (r *ValueRollup) BuildContents(attrView *AttributeView, destKey *Key, relationVal *Value, calc *RollupCalc,
	context *RollupRenderContext) {
	r.Contents = nil
	if nil == attrView {
		return
	}
	var customColors []*AttributeViewCustomColor
	if KeyTypeSelect == destKey.Type || KeyTypeMSelect == destKey.Type {
		customColors, _ = attrView.customColorPalette()
	}
	for _, blockID := range relationVal.Relation.BlockIDs {
		if nil != context && nil != context.EligibleItemIDs && !context.EligibleItemIDs[blockID] {
			continue
		}

		destVal := GetValue(attrView.KeyValues, destKey.ID, blockID)
		if nil != context && nil != context.FurtherCollection &&
			(KeyTypeTemplate == destKey.Type || KeyTypeUpdated == destKey.Type || KeyTypeCreated == destKey.Type) {
			destVal = context.FurtherCollection.GetValue(blockID, destKey.ID)
		}

		if nil == destVal {
			if KeyTypeCheckbox == destKey.Type {
				// 没有编辑过复选框的时候没有值，没有值等同于未选中，所以这里补一个未选中的值 https://github.com/siyuan-note/siyuan/issues/15858
				defaultVal := GetAttributeViewDefaultValue(ast.NewNodeID(), destKey.ID, blockID, destKey.Type, false)
				r.Contents = append(r.Contents, defaultVal)
			}
			continue
		}

		if val := destVal.GetValByType(destKey.Type); nil == val || reflect.ValueOf(val).IsNil() {
			// 目标字段因为修改类型导致空值
			continue
		}

		if KeyTypeNumber == destKey.Type {
			destVal.Number.Format = destKey.NumberFormat
			destVal.Number.FormatNumber()
		} else if KeyTypeDate == destKey.Type {
			destVal.Date.FormatDate(destKey.DateFormat)
		} else if KeyTypeCreated == destKey.Type {
			isNotTime := nil != destKey.Created && !destKey.Created.IncludeTime
			destVal.Created.FormatDate(destKey.DateFormat, isNotTime)
		} else if KeyTypeUpdated == destKey.Type {
			isNotTime := nil != destKey.Updated && !destKey.Updated.IncludeTime
			destVal.Updated.FormatDate(destKey.DateFormat, isNotTime)
		}

		cloned := destVal.Clone()
		if KeyTypeSelect == destKey.Type || KeyTypeMSelect == destKey.Type {
			resolveValueSelectColors(cloned, customColors)
		}
		r.Contents = append(r.Contents, cloned)
	}

	r.calcContents(calc, destKey)
}

func (r *ValueRollup) calcContents(calc *RollupCalc, destKey *Key) {
	if nil == calc {
		return
	}

	switch calc.Operator {
	case CalcOperatorNone:
	case CalcOperatorUniqueValues:
		var newContents []*Value
		uniqueValues := map[string]bool{}
		for _, content := range r.Contents {
			switch content.Type {
			case KeyTypeRelation:
				var newRelationContents []*Value
				for _, relationVal := range content.Relation.Contents {
					key := relationVal.String(true)
					if !uniqueValues[key] {
						uniqueValues[key] = true
						newRelationContents = append(newRelationContents, relationVal)
					}
				}
				content.Relation.Contents = newRelationContents
				if 0 < len(newRelationContents) {
					newContents = append(newContents, content)
				}
			case KeyTypeMSelect:
				var newMSelect []*ValueSelect
				for _, mSelect := range content.MSelect {
					if !uniqueValues[mSelect.Content] {
						uniqueValues[mSelect.Content] = true
						newMSelect = append(newMSelect, mSelect)
					}
				}
				content.MSelect = newMSelect
				if 0 < len(newMSelect) {
					newContents = append(newContents, content)
				}
			case KeyTypeMAsset:
				var newMAsset []*ValueAsset
				for _, mAsset := range content.MAsset {
					if !uniqueValues[mAsset.Content] {
						uniqueValues[mAsset.Content] = true
						newMAsset = append(newMAsset, mAsset)
					}
				}
				content.MAsset = newMAsset
				if 0 < len(newMAsset) {
					newContents = append(newContents, content)
				}
			default:
				key := content.String(true)
				if !uniqueValues[key] {
					uniqueValues[key] = true
					newContents = append(newContents, content)
				}
			}
		}
		r.Contents = newContents
	case CalcOperatorCountAll:
		countAll := len(r.Contents)
		if KeyTypeRelation == destKey.Type {
			countAll = 0
			for _, content := range r.Contents {
				if nil != content.Relation {
					countAll += len(content.Relation.BlockIDs)
				}
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countAll), NumberFormatNone)}}
	case CalcOperatorCountValues:
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(len(r.Contents)), NumberFormatNone)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, v := range r.Contents {
			if _, ok := uniqueValues[v.String(true)]; !ok {
				uniqueValues[v.String(true)] = true
				countUniqueValues++
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, v := range r.Contents {
			if "" == v.String(true) {
				countEmpty++
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}}
	case CalcOperatorCountNotEmpty:
		countNonEmpty := 0
		for _, v := range r.Contents {
			if "" != v.String(true) {
				countNonEmpty++
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countNonEmpty), NumberFormatNone)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, v := range r.Contents {
			if "" == v.String(true) {
				countEmpty++
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(r.Contents)), NumberFormatPercent)}}
		}
	case CalcOperatorPercentNotEmpty:
		countNonEmpty := 0
		for _, v := range r.Contents {
			if "" != v.String(true) {
				countNonEmpty++
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countNonEmpty)/float64(len(r.Contents)), NumberFormatPercent)}}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, v := range r.Contents {
			if _, ok := uniqueValues[v.String(true)]; !ok {
				uniqueValues[v.String(true)] = true
				countUniqueValues++
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(r.Contents)), NumberFormatPercent)}}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				sum += v.Number.Content
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				sum += f
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(sum, destKey.NumberFormat)}}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				sum += v.Number.Content
				count++
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				sum += f
				count++
			}
		}
		if 0 < count {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(sum/float64(count), destKey.NumberFormat)}}
		}
	case CalcOperatorMedian:
		var numbers []float64
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				numbers = append(numbers, v.Number.Content)
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				numbers = append(numbers, f)
			}
		}
		sort.Float64s(numbers)
		if 0 < len(numbers) {
			if 0 == len(numbers)%2 {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber((numbers[len(numbers)/2-1]+numbers[len(numbers)/2])/2, destKey.NumberFormat)}}
			} else {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(numbers[len(numbers)/2], destKey.NumberFormat)}}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				if v.Number.Content < minVal {
					minVal = v.Number.Content
				}
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				if f < minVal {
					minVal = f
				}
			}
		}
		if math.MaxFloat64 != minVal {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(minVal, destKey.NumberFormat)}}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				if v.Number.Content > maxVal {
					maxVal = v.Number.Content
				}
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				if f > maxVal {
					maxVal = f
				}
			}
		}
		if -math.MaxFloat64 != maxVal {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(maxVal, destKey.NumberFormat)}}
		}
	case CalcOperatorRange:
		if 2 > len(r.Contents) {
			return
		}

		minVal := math.MaxFloat64
		maxVal := -math.MaxFloat64
		earliest := int64(0)
		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, v := range r.Contents {
			if KeyTypeNumber == v.Type && nil != v.Number && v.Number.IsNotEmpty {
				if v.Number.Content < minVal {
					minVal = v.Number.Content
				}
				if v.Number.Content > maxVal {
					maxVal = v.Number.Content
				}
			} else if KeyTypeDate == v.Type && nil != v.Date && v.Date.IsNotEmpty {
				if 0 == earliest || v.Date.Content < earliest {
					earliest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
				if 0 == latest || v.Date.Content > latest {
					latest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
			} else if KeyTypeUpdated == v.Type && nil != v.Updated && v.Updated.IsNotEmpty {
				if 0 == earliest || v.Updated.Content < earliest {
					earliest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
				if 0 == latest || v.Updated.Content > latest {
					latest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
			} else if KeyTypeCreated == v.Type && nil != v.Created && v.Created.IsNotEmpty {
				if 0 == earliest || v.Created.Content < earliest {
					earliest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
				if 0 == latest || v.Created.Content > latest {
					latest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
			} else {
				content := v.String(false)
				f, _ := util.Convert2Float(content)
				if f < minVal {
					minVal = f
				}
				if f > maxVal {
					maxVal = f
				}
			}
		}

		typ := r.Contents[0].Type
		switch typ {
		case KeyTypeNumber:
			if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(maxVal-minVal, destKey.NumberFormat)}}
			}
		case KeyTypeDate:
			if 0 != earliest && 0 != latest {
				r.Contents = []*Value{{Type: KeyTypeDate, Date: NewFormattedValueDate(earliest, latest, DateFormatDuration, isNotTime, hasEndDate)}}
			}
		case KeyTypeUpdated:
			if 0 != earliest && 0 != latest {
				isNotTime = false
				if nil != destKey.Updated {
					isNotTime = !destKey.Updated.IncludeTime
				}

				r.Contents = []*Value{{Type: KeyTypeUpdated, Updated: NewFormattedValueUpdated(earliest, latest, UpdatedFormatDuration, isNotTime)}}
			}
		case KeyTypeCreated:
			if 0 != earliest && 0 != latest {
				isNotTime = false
				if nil != destKey.Created {
					isNotTime = !destKey.Created.IncludeTime
				}

				r.Contents = []*Value{{Type: KeyTypeCreated, Created: NewFormattedValueCreated(earliest, latest, CreatedFormatDuration, isNotTime)}}
			}
		default:
			if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
				r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(maxVal-minVal, destKey.NumberFormat)}}
			}
		}
	case CalcOperatorEarliest:
		if 1 > len(r.Contents) {
			return
		}

		earliest := int64(0)
		var isNotTime, hasEndDate bool
		for _, v := range r.Contents {
			if KeyTypeDate == v.Type && nil != v.Date && v.Date.IsNotEmpty {
				if 0 == earliest || v.Date.Content < earliest {
					earliest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
			} else if KeyTypeUpdated == v.Type && nil != v.Updated && v.Updated.IsNotEmpty {
				if 0 == earliest || v.Updated.Content < earliest {
					earliest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
			} else if KeyTypeCreated == v.Type && nil != v.Created && v.Created.IsNotEmpty {
				if 0 == earliest || v.Created.Content < earliest {
					earliest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
			}
		}

		typ := r.Contents[0].Type
		switch typ {
		case KeyTypeDate:
			if 0 != earliest {
				date := NewFormattedValueDate(earliest, 0, DateFormatNone, isNotTime, hasEndDate)
				date.FormatDate(destKey.DateFormat)
				r.Contents = []*Value{{Type: KeyTypeDate, Date: date}}
			}
		case KeyTypeUpdated:
			if 0 != earliest {
				isNotTime = false
				if nil != destKey.Updated {
					isNotTime = !destKey.Updated.IncludeTime
				}

				updated := NewFormattedValueUpdated(earliest, 0, UpdatedFormatNone, isNotTime)
				updated.FormatDate(destKey.DateFormat, isNotTime)
				r.Contents = []*Value{{Type: KeyTypeUpdated, Updated: updated}}
			}
		case KeyTypeCreated:
			if 0 != earliest {
				isNotTime = false
				if nil != destKey.Created {
					isNotTime = !destKey.Created.IncludeTime
				}

				created := NewFormattedValueCreated(earliest, 0, CreatedFormatNone, isNotTime)
				created.FormatDate(destKey.DateFormat, isNotTime)
				r.Contents = []*Value{{Type: KeyTypeCreated, Created: created}}
			}
		}
	case CalcOperatorLatest:
		if 1 > len(r.Contents) {
			return
		}

		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, v := range r.Contents {
			if KeyTypeDate == v.Type && nil != v.Date && v.Date.IsNotEmpty {
				if 0 == latest || latest < v.Date.Content {
					latest = v.Date.Content
					isNotTime = v.Date.IsNotTime
					hasEndDate = v.Date.HasEndDate
				}
			} else if KeyTypeUpdated == v.Type && nil != v.Updated && v.Updated.IsNotEmpty {
				if 0 == latest || latest < v.Updated.Content {
					latest = v.Updated.Content
					isNotTime = true
					hasEndDate = false
				}
			} else if KeyTypeCreated == v.Type && nil != v.Created && v.Created.IsNotEmpty {
				if 0 == latest || latest < v.Created.Content {
					latest = v.Created.Content
					isNotTime = true
					hasEndDate = false
				}
			}
		}

		typ := r.Contents[0].Type
		switch typ {
		case KeyTypeDate:
			if 0 != latest {
				date := NewFormattedValueDate(latest, 0, DateFormatNone, isNotTime, hasEndDate)
				date.FormatDate(destKey.DateFormat)
				r.Contents = []*Value{{Type: KeyTypeDate, Date: date}}
			}
		case KeyTypeUpdated:
			if 0 != latest {
				isNotTime = false
				if nil != destKey.Updated {
					isNotTime = !destKey.Updated.IncludeTime
				}
				updated := NewFormattedValueUpdated(latest, 0, UpdatedFormatNone, isNotTime)
				updated.FormatDate(destKey.DateFormat, isNotTime)
				r.Contents = []*Value{{Type: KeyTypeUpdated, Updated: updated}}
			}
		case KeyTypeCreated:
			if 0 != latest {
				isNotTime = false
				if nil != destKey.Created {
					isNotTime = !destKey.Created.IncludeTime
				}

				created := NewFormattedValueCreated(latest, 0, CreatedFormatNone, isNotTime)
				created.FormatDate(destKey.DateFormat, isNotTime)
				r.Contents = []*Value{{Type: KeyTypeCreated, Created: created}}
			}
		}
	case CalcOperatorChecked:
		countChecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if v.Checkbox.Checked {
					countChecked++
				}
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countChecked), NumberFormatNone)}}
	case CalcOperatorUnchecked:
		countUnchecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if !v.Checkbox.Checked {
					countUnchecked++
				}
			}
		}
		r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUnchecked), NumberFormatNone)}}
	case CalcOperatorPercentChecked:
		countChecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if v.Checkbox.Checked {
					countChecked++
				}
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countChecked*100/len(r.Contents)), NumberFormatNone)}}
		}
	case CalcOperatorPercentUnchecked:
		countUnchecked := 0
		for _, v := range r.Contents {
			if nil != v.Checkbox {
				if !v.Checkbox.Checked {
					countUnchecked++
				}
			}
		}
		if 0 < len(r.Contents) {
			r.Contents = []*Value{{Type: KeyTypeNumber, Number: NewFormattedValueNumber(float64(countUnchecked*100/len(r.Contents)), NumberFormatNone)}}
		}
	}
}

func GetAttributeViewDefaultValue(valueID, keyID, blockID string, typ KeyType, keyDateIsTime bool) (ret *Value) {
	if "" == valueID {
		valueID = ast.NewNodeID()
	}

	ret = &Value{ID: valueID, KeyID: keyID, BlockID: blockID, Type: typ}

	createdStr := valueID[:len("20060102150405")]
	created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
	if nil == parseErr {
		ret.CreatedAt = created.UnixMilli()
	} else {
		ret.CreatedAt = time.Now().UnixMilli()
	}
	if 0 == ret.UpdatedAt {
		ret.UpdatedAt = ret.CreatedAt
	}

	switch typ {
	case KeyTypeBlock:
		ret.Block = &ValueBlock{Created: ret.CreatedAt, Updated: ret.UpdatedAt}
	case KeyTypeText:
		ret.Text = &ValueText{}
	case KeyTypeNumber:
		ret.Number = &ValueNumber{}
	case KeyTypeDate:
		ret.Date = &ValueDate{IsNotTime: !keyDateIsTime}
	case KeyTypeSelect:
		ret.MSelect = []*ValueSelect{}
	case KeyTypeMSelect:
		ret.MSelect = []*ValueSelect{}
	case KeyTypeURL:
		ret.URL = &ValueURL{}
	case KeyTypeEmail:
		ret.Email = &ValueEmail{}
	case KeyTypePhone:
		ret.Phone = &ValuePhone{}
	case KeyTypeMAsset:
		ret.MAsset = []*ValueAsset{}
	case KeyTypeTemplate:
		ret.Template = &ValueTemplate{}
	case KeyTypeCreated:
		ret.Created = &ValueCreated{}
	case KeyTypeUpdated:
		ret.Updated = &ValueUpdated{}
	case KeyTypeCheckbox:
		ret.Checkbox = &ValueCheckbox{}
	case KeyTypeRelation:
		ret.Relation = &ValueRelation{}
	case KeyTypeRollup:
		ret.Rollup = &ValueRollup{}
	}
	return
}
