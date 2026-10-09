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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var shorthandContainerPrefix = regexp.MustCompile(`^[ \t]*(?:(?:>[ \t]*)|(?:(?:[*+-]|[0-9]{1,9}[.)])[ \t]+))*`)
var shorthandListPrefix = regexp.MustCompile(`(?:[*+-]|[0-9]{1,9}[.)])[ \t]+$`)

type shorthandMarker struct {
	start, end  int
	token       string
	dots        int
	task        byte
	listed      bool
	rootPrefix  bool
	blankBefore bool
	blankAfter  bool
	closing     bool
	opened      bool
	rejected    bool
	replacement string
}

// parseShorthandMarkdown 仅在消费速记时应用编辑器语法，不改变普通 Markdown 导入的解析配置。
func parseShorthandMarkdown(md string, created time.Time, engine *lute.Lute) *parse.Tree {
	engine.SetMark(util.MarkdownSettings.InlineMark)
	md, tasks := normalizeShorthandMarkdown(md, engine.ParseOptions)
	tree := parse.Parse("", []byte(md), engine.ParseOptions)
	if nil == tree {
		return nil
	}
	if 0 < len(tasks) {
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeText != node.Type || nil == node.Parent || ast.NodeParagraph != node.Parent.Type {
				return ast.WalkContinue
			}
			item := node.Parent.Parent
			if nil == item || ast.NodeListItem != item.Type {
				return ast.WalkContinue
			}
			text := bytes.TrimLeft(node.Tokens, " \t")
			end := bytes.IndexByte(text, 'z')
			if 0 <= end {
				if marker, ok := tasks[string(text[:end+1])]; ok {
					node.Tokens = text[end+1:]
					task := item.ChildByType(ast.NodeTaskListItemMarker)
					if nil == task {
						task = node.Parent.ChildByType(ast.NodeTaskListItemMarker)
					}
					if nil != task {
						task.ReviveFromMarker(marker)
						item.ListData.Checked = task.TaskListItemChecked
						task.Unlink()
						item.PrependChild(task)
					}
				}
			}
			return ast.WalkContinue
		})
	}
	parse.TextMarks2Inlines(tree)
	parse.NestedInlines2FlattedSpansHybrid(tree, false)
	resetBlockIDsByTime(tree.Root, created)
	return tree
}

// normalizeShorthandMarkdown 由解析器判断标记的上下文，避免修改代码、公式、HTML 块和转义正文。
func normalizeShorthandMarkdown(md string, options *parse.Options) (string, map[string]byte) {
	settings := util.MarkdownSettings
	dotsEnabled := nil == settings.CodeBlockMiddleDot || *settings.CodeBlockMiddleDot
	tasksEnabled := nil == settings.BlockFullWidthTaskList || *settings.BlockFullWidthTaskList
	if !dotsEnabled && !tasksEnabled {
		return md, nil
	}
	// 探针仅用于临时解析；使用不与原文冲突的前缀，最终只保留用户正文。
	prefix := "siyuanshorthandprobe"
	for strings.Contains(md, prefix) {
		prefix += "q"
	}
	var markers []*shorthandMarker
	previousBlank := true
	for offset := 0; offset < len(md); {
		end := strings.IndexByte(md[offset:], '\n')
		if 0 > end {
			end = len(md)
		} else {
			end += offset
		}
		line := strings.TrimSuffix(md[offset:end], "\r")
		container := shorthandContainerPrefix.FindString(line)
		text := line[len(container):]
		marker := &shorthandMarker{start: offset + len(container), listed: shorthandListPrefix.MatchString(container),
			rootPrefix: len(container) <= 3 && "" == strings.Trim(container, " "), blankBefore: previousBlank}
		previousBlank = "" == strings.Trim(line, " \t")
		marker.blankAfter = end+1 >= len(md)
		if !marker.blankAfter {
			nextLine := md[end+1:]
			if nextEnd := strings.IndexByte(nextLine, '\n'); 0 <= nextEnd {
				nextLine = nextLine[:nextEnd]
			}
			marker.blankAfter = "" == strings.Trim(nextLine, " \t\r")
		}
		if dotsEnabled && strings.HasPrefix(text, "···") {
			for strings.HasPrefix(text[marker.dots*len("·"):], "·") {
				marker.dots++
			}
			marker.end = marker.start + marker.dots*len("·")
			suffix := text[marker.dots*len("·"):]
			marker.closing = "" == strings.TrimSpace(suffix)
			if strings.ContainsAny(suffix, "`·") || (options.ProtyleWYSIWYG && strings.Contains(suffix, "~")) {
				marker.dots = 0
			}
		} else if tasksEnabled {
			length, status := shorthandTaskMarker(text)
			marker.end, marker.task = marker.start+length, status
		}
		if 0 < marker.dots || 0 != marker.task {
			marker.token = prefix + strconv.Itoa(len(markers)) + "z"
			markers = append(markers, marker)
		}
		offset = end + 1
	}
	if 0 == len(markers) {
		return md, nil
	}
	// 探测时将完整 HTML 块视为不透明正文，避免所见即所得模式把 pre 等标签当作普通段落。
	probeOptions := *options
	probeOptions.ProtyleWYSIWYG = false
	probeOptions.KramdownBlockIAL = false
	fenceOptions := *options
	fenceOptions.KramdownBlockIAL = false
	build := func(probe bool) string {
		var result strings.Builder
		offset := 0
		for _, marker := range markers {
			result.WriteString(md[offset:marker.start])
			if "" != marker.replacement {
				result.WriteString(marker.replacement)
				if probe && marker.opened {
					result.WriteString(marker.token + " ")
				}
			} else {
				if probe {
					result.WriteString(marker.token)
				}
				result.WriteString(md[marker.start:marker.end])
			}
			offset = marker.end
		}
		result.WriteString(md[offset:])
		return result.String()
	}
	// 使用原文中不存在的长围栏，代码正文里的普通围栏不会提前结束中点代码块。
	fenceLen, run := 3, 0
	for _, char := range md {
		if '~' == char {
			run++
			if run >= fenceLen {
				fenceLen = run + 1
			}
		} else {
			run = 0
		}
	}
	for {
		probe := parse.Parse("", []byte(build(true)), &probeOptions)
		plain := shorthandPlainMarkers(probe, markers, prefix, false)
		if batchShorthandRootFences(probe, markers, prefix, strings.Repeat("~", fenceLen), build, &fenceOptions, &probeOptions) {
			continue
		}
		var opening *shorthandMarker
		for _, marker := range markers {
			if 0 < marker.dots && !marker.rejected && "" == marker.replacement && plain[marker] {
				opening = marker
				break
			}
		}
		if nil == opening {
			break
		}
		fence := strings.Repeat("~", fenceLen)
		opening.replacement = fence
		opening.opened = true
		probe = parse.Parse("", []byte(build(true)), &fenceOptions)
		opened := false
		ast.Walk(probe.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeCodeBlockCode != node.Type || nil == node.Parent ||
				string(node.Parent.CodeBlockInfo) != opening.token {
				return ast.WalkContinue
			}
			opened = true
			for _, marker := range markers {
				if marker.start <= opening.start || marker.dots < opening.dots || !marker.closing || "" != marker.replacement {
					continue
				}
				at := bytes.Index(node.Tokens, []byte(marker.token))
				if 0 > at {
					continue
				}
				line := node.Tokens[bytes.LastIndexByte(node.Tokens[:at], '\n')+1 : at]
				if len(line) > 3 || 0 != len(bytes.Trim(line, " ")) {
					continue
				}
				// 代码正文已被解析器去掉部分缩进，必须让解析器再次确认这个位置确实能关闭围栏。
				closingFence := fence + "~"
				marker.replacement = closingFence
				closed := false
				trial := parse.Parse("", []byte(build(true)), &fenceOptions)
				ast.Walk(trial.Root, func(candidate *ast.Node, entering bool) ast.WalkStatus {
					if entering && ast.NodeCodeBlock == candidate.Type &&
						string(candidate.CodeBlockInfo) == opening.token &&
						string(candidate.CodeBlockCloseFence) == closingFence {
						closed = true
					}
					return ast.WalkContinue
				})
				if closed {
					break
				}
				marker.replacement = ""
			}
			return ast.WalkSkipChildren
		})
		if !opened {
			opening.replacement = ""
			opening.opened = false
			opening.rejected = true
		}
	}
	probe := parse.Parse("", []byte(build(true)), &probeOptions)
	plain := shorthandPlainMarkers(probe, markers, prefix, false)
	tasks := map[string]byte{}
	for _, marker := range markers {
		if 0 == marker.task || !plain[marker] {
			continue
		}
		marker.replacement = "[ ] " + marker.token
		if !marker.listed {
			marker.replacement = "- " + marker.replacement
		}
		tasks[marker.token] = marker.task
	}
	// 缩进或容器上下文可能阻止列表形成；只有实际解析成任务的候选才保留替换。
	for 0 < len(tasks) {
		valid := map[string]bool{}
		trial := parse.Parse("", []byte(build(false)), options)
		ast.Walk(trial.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeText != node.Type || nil == node.Parent || ast.NodeParagraph != node.Parent.Type {
				return ast.WalkContinue
			}
			item := node.Parent.Parent
			if nil == item || ast.NodeListItem != item.Type ||
				(nil == item.ChildByType(ast.NodeTaskListItemMarker) && nil == node.Parent.ChildByType(ast.NodeTaskListItemMarker)) {
				return ast.WalkContinue
			}
			text := bytes.TrimLeft(node.Tokens, " \t")
			if end := bytes.IndexByte(text, 'z'); 0 <= end {
				valid[string(text[:end+1])] = true
			}
			return ast.WalkContinue
		})
		reverted := false
		for _, marker := range markers {
			if 0 != marker.task && "" != marker.replacement && !valid[marker.token] {
				marker.replacement = ""
				delete(tasks, marker.token)
				reverted = true
			}
		}
		if !reverted {
			break
		}
	}
	return build(false), tasks
}

// batchShorthandRootFences 对空行隔开的顶层围栏批量验证，避免长速记逐块重复解析全部正文。
// 复杂容器或任何验证不通过的批次仍由逐块解析处理。
func batchShorthandRootFences(tree *parse.Tree, markers []*shorthandMarker, prefix, fence string,
	build func(bool) string, options, protectedOptions *parse.Options) bool {
	plain := shorthandPlainMarkers(tree, markers, prefix, true)
	type pair struct{ opening, closing *shorthandMarker }
	var pairs []pair
	for i := 0; i < len(markers); i++ {
		opening := markers[i]
		if 0 == opening.dots || opening.rejected || "" != opening.replacement {
			continue
		}
		if !opening.rootPrefix || !plain[opening] || !opening.blankBefore {
			break
		}
		matched := false
		for j := i + 1; j < len(markers); j++ {
			closing := markers[j]
			if closing.dots >= opening.dots && closing.closing && closing.rootPrefix && "" == closing.replacement {
				if !closing.blankAfter {
					break
				}
				pairs = append(pairs, pair{opening, closing})
				i = j
				matched = true
				break
			}
		}
		if !matched {
			break
		}
	}
	if len(pairs) < 2 {
		return false
	}
	for _, pair := range pairs {
		pair.opening.replacement, pair.opening.opened = fence, true
		pair.closing.replacement = fence + "~"
	}
	for _, profile := range []*parse.Options{options, protectedOptions} {
		valid := map[string]bool{}
		trial := parse.Parse("", []byte(build(true)), profile)
		ast.Walk(trial.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeCodeBlock == node.Type && ast.NodeDocument == node.Parent.Type &&
				string(node.CodeBlockCloseFence) == fence+"~" {
				valid[string(node.CodeBlockInfo)] = true
			}
			return ast.WalkContinue
		})
		for _, pair := range pairs {
			if !valid[pair.opening.token] {
				for _, pair := range pairs {
					pair.opening.replacement, pair.opening.opened = "", false
					pair.closing.replacement = ""
				}
				return false
			}
		}
	}
	return true
}

func shorthandPlainMarkers(tree *parse.Tree, markers []*shorthandMarker, prefix string, rootOnly bool) map[*shorthandMarker]bool {
	ret := map[*shorthandMarker]bool{}
	byToken := map[string]*shorthandMarker{}
	for _, marker := range markers {
		byToken[marker.token] = marker
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeText == node.Type && nil != node.Parent && ast.NodeParagraph == node.Parent.Type &&
			(!rootOnly || node.Parent.Parent == tree.Root) {
			text := string(node.Tokens)
			for {
				at := strings.Index(text, prefix)
				if 0 > at {
					break
				}
				text = text[at:]
				end := strings.IndexByte(text, 'z')
				if 0 > end {
					break
				}
				if marker := byToken[text[:end+1]]; nil != marker {
					ret[marker] = true
				}
				text = text[end+1:]
			}
		}
		return ast.WalkContinue
	})
	return ret
}

func shorthandTaskMarker(text string) (int, byte) {
	if strings.HasPrefix(text, "【】") {
		return len("【】"), ' '
	}
	opening := 0
	if strings.HasPrefix(text, "【") {
		opening = len("【")
	} else if strings.HasPrefix(text, "[") {
		opening = 1
	}
	if 0 == opening || len(text) <= opening+1 {
		return 0, 0
	}
	status := text[opening]
	if ' ' > status || '~' < status || '[' == status || ']' == status {
		return 0, 0
	}
	if strings.HasPrefix(text[opening+1:], "】") {
		return opening + 1 + len("】"), status
	}
	if 1 < opening && ']' == text[opening+1] {
		return opening + 2, status
	}
	return 0, 0
}
