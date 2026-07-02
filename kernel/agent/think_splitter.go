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

package agent

import "strings"

// thinkOpenTag / thinkCloseTag 是部分模型（MINIMAX、DeepSeek-V3、Qwen3、GLM 等）
// 用来包裹推理内容的文本标签。这些模型把推理内容混在 delta.content 中返回，
// 而非放进 OpenAI 约定的 reasoning_content 字段，导致 <think> 文本泄露进对话正文。
const (
	thinkOpenTag  = "<think>"
	thinkCloseTag = "</think>"
)

// thinkSplitter 解析流式 delta.content 中的 <think>...</think> 标签，
// 把标签内文本分流为 reasoning、标签外文本才作为 content。
//
// 标签可能跨多个流式 chunk 到达（如 "<thi" + "nk>"），故采用前缀缓冲 + 状态机处理。
// 对不输出 <think> 的模型：每个 delta 走一次扫描后全部归 content，无额外开销。
type thinkSplitter struct {
	// inThink 表示当前是否处于 <think> 标签内部。
	inThink bool
	// pending 缓冲以 '<' 开头但尚无法判定是否为标签的文本：
	// 它可能是 <think>/</think> 的不完整前缀，需等后续 chunk 拼接后才能确定。
	pending strings.Builder
}

func newThinkSplitter() *thinkSplitter {
	return &thinkSplitter{}
}

// Feed 处理一个流式 chunk，返回其中应归入 reasoning 与 content 的文本。
// 同一 chunk 可能同时产生两部分（如 "</think>正文" 先结束思考再开始正文）。
func (s *thinkSplitter) Feed(delta string) (reasoning, content string) {
	var rBuf, cBuf strings.Builder
	// flush 把普通文本按当前状态写入对应缓冲区。
	flush := func(text string) {
		if text == "" {
			return
		}
		if s.inThink {
			rBuf.WriteString(text)
		} else {
			cBuf.WriteString(text)
		}
	}

	// 把上一轮残留的 pending 与新 delta 拼接后统一处理。
	work := s.pending.String() + delta
	s.pending.Reset()

	for len(work) > 0 {
		// 块内找闭合标签，块外找开标签。
		tag := thinkCloseTag
		if !s.inThink {
			tag = thinkOpenTag
		}

		lt := strings.IndexByte(work, '<')
		if lt < 0 {
			// 整段无 '<'，全是普通文本。
			flush(work)
			work = ""
			break
		}
		// '<' 之前的内容一定是普通文本，先输出。
		if lt > 0 {
			flush(work[:lt])
			work = work[lt:]
		}

		// 此时 work 以 '<' 开头，判断它是否为目标标签。
		if strings.HasPrefix(work, tag) {
			// 完整命中：切换状态，跳过整个标签。
			s.inThink = !s.inThink
			work = work[len(tag):]
			continue
		}
		if strings.HasPrefix(tag, work) {
			// work 是 tag 的不完整前缀（如 work="<thi"、tag="<think>"），
			// 标签可能尚未到齐，暂存待下一个 chunk。
			s.pending.WriteString(work)
			work = ""
			break
		}
		// work 以 '<' 开头，但既不是 tag 也不是 tag 的前缀，
		// 说明这个 '<' 只是普通文本。输出它后继续扫描剩余部分。
		flush("<")
		work = work[1:]
	}

	return rBuf.String(), cBuf.String()
}

// Flush 在流结束时调用，把 pending 中残留的不完整标签缓冲按普通文本冲出，避免丢字。
// 典型场景：模型输出了半个标签（如孤立的 "<thi"）就中断，或思考块未闭合。
func (s *thinkSplitter) Flush() (reasoning, content string) {
	leftover := s.pending.String()
	s.pending.Reset()
	if leftover == "" {
		return "", ""
	}
	if s.inThink {
		return leftover, ""
	}
	return "", leftover
}

// stripThinkTags 从一段完整文本中移除所有 <think>...</think> 块，返回剩余正文。
// 用于非流式场景（如标题生成）：一次性拿到完整 content 后剥离思考内容。
// 未闭合的 <think>（只有开标签）其后内容视为思考、整体移除；多个 think 块都会被处理。
func stripThinkTags(s string) string {
	var b strings.Builder
	for {
		open := strings.Index(s, thinkOpenTag)
		if open < 0 {
			// 没有更多 think 块，剩余全部是正文。
			b.WriteString(s)
			return b.String()
		}
		// 开标签之前是正文，先写入。
		b.WriteString(s[:open])
		rest := s[open+len(thinkOpenTag):]
		close := strings.Index(rest, thinkCloseTag)
		if close < 0 {
			// 未闭合：丢弃剩余思考内容。
			return b.String()
		}
		// 跳过闭标签，继续处理其后的文本（可能还有 think 块）。
		s = rest[close+len(thinkCloseTag):]
	}
}
