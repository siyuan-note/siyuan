package model

import (
	"html"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type attributeViewSearchRange struct {
	start, end int
}

type attributeViewSearchPart struct {
	text   string
	start  int
	key    *av.Key
	value  *av.Value
	view   bool
	ranges []attributeViewSearchRange
}

// compactAttributeViewSearchResults 只精简已命中的数据库块，不改变索引、结果数量和排序。
func compactAttributeViewSearchResults(blocks []*Block) {
	for _, block := range blocks {
		if "NodeAttributeView" != block.Type || !strings.Contains(block.Content, "<mark>") {
			continue
		}
		tree, err := LoadTreeByBlockIDInExactBox(block.ID, block.Box)
		if nil != err || nil == tree {
			continue
		}
		node := treenode.GetNodeInTree(tree, block.ID)
		if nil == node || ast.NodeAttributeView != node.Type || "" == node.AttributeViewID {
			continue
		}
		avBox := ""
		if IsEncryptedBox(tree.Box) {
			avBox = tree.Box
		}
		attrView, err := av.ParseAttributeViewForIndexInBox(node.AttributeViewID, avBox)
		if nil != err || nil == attrView {
			continue
		}
		block.Content = compactAttributeViewSearchContent(attrView, block.Content)
	}
}

func compactAttributeViewSearchContent(attrView *av.AttributeView, fallback string) string {
	// 按索引内容的顺序记录字段边界，将现有高亮映射回原文，不重新匹配关键词。
	var source strings.Builder
	var parts []*attributeViewSearchPart
	appendPart := func(text string, key *av.Key, value *av.Value, view bool) {
		parts = append(parts, &attributeViewSearchPart{text: text, start: source.Len(), key: key, value: value, view: view})
		source.WriteString(text)
		source.WriteByte(' ')
	}
	appendPart(attrView.Name, nil, nil, false)
	for _, view := range attrView.Views {
		if nil == view {
			return fallback
		}
		appendPart(view.Name, nil, nil, true)
	}
	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			return fallback
		}
		appendPart(keyValues.Key.Name, keyValues.Key, nil, false)
		for _, value := range keyValues.Values {
			if nil != value {
				appendPart(value.String(true), keyValues.Key, value, false)
			}
		}
	}
	ranges, ok := mapAttributeViewSearchRanges(source.String(), fallback)
	if !ok {
		return fallback
	}
	for _, match := range ranges {
		found := false
		for _, part := range parts {
			if part.start <= match.start && match.end <= part.start+len(part.text) {
				if part.view {
					return fallback
				}
				part.ranges = append(part.ranges, attributeViewSearchRange{match.start - part.start, match.end - part.start})
				found = true
				break
			}
		}
		if !found {
			// 跨字段短语、视图名称或过期索引无法精确归属时保留原片段。
			return fallback
		}
	}
	rowTitles := map[string]string{}
	for _, part := range parts {
		if nil != part.value && av.KeyTypeBlock == part.key.Type {
			rowTitles[part.value.BlockID] = part.text
		}
	}
	var lines []string
	if "" != attrView.Name {
		lines = append(lines, attributeViewSearchPartHTML(parts[0]))
	}
	const maxFields = 6
	fields := 0
	for _, part := range parts {
		if nil == part.key || 0 == len(part.ranges) {
			continue
		}
		key := util.EscapeHTML(attributeViewSearchSummary(part.key.Name, 60))
		if nil == part.value {
			key = attributeViewSearchPartHTML(part)
		}
		line := `<span class="fn__code">` + key + `</span>`
		if nil != part.value {
			line += " " + attributeViewSearchPartHTML(part)
			if av.KeyTypeBlock != part.key.Type {
				if rowTitle := rowTitles[part.value.BlockID]; "" != rowTitle {
					line = util.EscapeHTML(attributeViewSearchSummary(rowTitle, 48)) + " · " + line
				}
			}
		}
		lines = append(lines, line)
		fields++
		if fields >= maxFields {
			break
		}
	}
	if 0 == len(lines) {
		return fallback
	}
	return strings.Join(lines, "<br>")
}

// mapAttributeViewSearchRanges 只接受可唯一定位的搜索片段，避免把同词子串误归到其他字段。
func mapAttributeViewSearchRanges(source, marked string) ([]attributeViewSearchRange, bool) {
	plain, ranges, ok := parseAttributeViewSearchMarks(marked)
	if !ok || 0 == len(ranges) {
		return nil, false
	}
	mapWindow := func(window string, matches []attributeViewSearchRange, after int) ([]attributeViewSearchRange, bool) {
		pos := strings.Index(source, window)
		if "" == window || pos < after || strings.LastIndex(source, window) != pos {
			return nil, false
		}
		mapped := make([]attributeViewSearchRange, len(matches))
		for i, match := range matches {
			mapped[i] = attributeViewSearchRange{pos + match.start, pos + match.end}
		}
		return mapped, true
	}
	if mapped, found := mapWindow(plain, ranges, 0); found {
		return mapped, true
	}
	if strings.Contains(source, "...") {
		return nil, false
	}
	var mapped []attributeViewSearchRange
	offset, after := 0, 0
	for _, window := range strings.Split(plain, "...") {
		var matches []attributeViewSearchRange
		for _, match := range ranges {
			if offset <= match.start && match.end <= offset+len(window) {
				matches = append(matches, attributeViewSearchRange{match.start - offset, match.end - offset})
			}
		}
		if 0 < len(matches) {
			resolved, found := mapWindow(window, matches, after)
			if !found {
				return nil, false
			}
			mapped = append(mapped, resolved...)
			after = resolved[len(resolved)-1].end
		}
		offset += len(window) + len("...")
	}
	return mapped, len(mapped) == len(ranges)
}

func parseAttributeViewSearchMarks(marked string) (string, []attributeViewSearchRange, bool) {
	var plain strings.Builder
	var ranges []attributeViewSearchRange
	for {
		start := strings.Index(marked, "<mark>")
		if start < 0 {
			plain.WriteString(html.UnescapeString(marked))
			return plain.String(), ranges, !strings.Contains(marked, "</mark>")
		}
		if strings.Contains(marked[:start], "</mark>") {
			return "", nil, false
		}
		plain.WriteString(html.UnescapeString(marked[:start]))
		marked = marked[start+len("<mark>"):]
		end := strings.Index(marked, "</mark>")
		if end <= 0 || strings.Contains(marked[:end], "<mark>") {
			return "", nil, false
		}
		matchStart := plain.Len()
		plain.WriteString(html.UnescapeString(marked[:end]))
		ranges = append(ranges, attributeViewSearchRange{matchStart, plain.Len()})
		marked = marked[end+len("</mark>"):]
	}
}

func attributeViewSearchSummary(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit]) + "..."
	}
	return text
}

func attributeViewSearchPartHTML(part *attributeViewSearchPart) string {
	if 0 == len(part.ranges) {
		return util.EscapeHTML(attributeViewSearchSummary(part.text, 80))
	}
	start, end := part.ranges[0].start, part.ranges[0].end
	for i := 0; i < 32 && start > 0; i++ {
		_, size := utf8.DecodeLastRuneInString(part.text[:start])
		start -= size
	}
	for i := 0; i < 64 && end < len(part.text); i++ {
		_, size := utf8.DecodeRuneInString(part.text[end:])
		end += size
	}
	var result strings.Builder
	if start > 0 {
		result.WriteString("...")
	}
	cursor := start
	for _, match := range part.ranges {
		if match.start >= end {
			break
		}
		if match.end > end {
			end = match.end
		}
		result.WriteString(util.EscapeHTML(part.text[cursor:match.start]))
		result.WriteString("<mark>" + util.EscapeHTML(part.text[match.start:match.end]) + "</mark>")
		cursor = match.end
	}
	result.WriteString(util.EscapeHTML(part.text[cursor:end]))
	if end < len(part.text) {
		result.WriteString("...")
	}
	return result.String()
}
