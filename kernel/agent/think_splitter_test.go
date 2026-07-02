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

import "testing"

// feedAll 依次喂入多段 delta，累积返回 reasoning 与 content。
func feedAll(t *testing.T, deltas []string) (reasoning, content string) {
	t.Helper()
	s := newThinkSplitter()
	var r, c string
	for _, d := range deltas {
		rr, cc := s.Feed(d)
		r += rr
		c += cc
	}
	fr, fc := s.Flush()
	return r + fr, c + fc
}

func TestThinkSplitter_NoTags(t *testing.T) {
	// 普通模型不带 <think> 标签，应原样作为 content。
	r, c := feedAll(t, []string{"你好", "世界"})
	if r != "" || c != "你好世界" {
		t.Fatalf("expected content=你好世界, got reasoning=%q content=%q", r, c)
	}
}

func TestThinkSplitter_TagsInOneChunk(t *testing.T) {
	// 单 chunk 内完整出现开闭标签（日志观测到的 MINIMAX 实际形态）。
	// 闭合标签后紧跟正文。
	r, c := feedAll(t, []string{"<think>思考内容</think>正文"})
	if r != "思考内容" {
		t.Fatalf("expected reasoning=思考内容, got %q", r)
	}
	if c != "正文" {
		t.Fatalf("expected content=正文, got %q", c)
	}
}

func TestThinkSplitter_OpenTagCrossChunk(t *testing.T) {
	// <think> 标签跨多个 chunk 拆分。
	r, c := feedAll(t, []string{"<thi", "nk>", "思考", "</think>", "正文"})
	if r != "思考" {
		t.Fatalf("expected reasoning=思考, got %q", r)
	}
	if c != "正文" {
		t.Fatalf("expected content=正文, got %q", c)
	}
}

func TestThinkSplitter_CloseTagCrossChunk(t *testing.T) {
	// </think> 闭合标签跨 chunk 拆分，且闭合后紧跟正文在同一后续 chunk。
	r, c := feedAll(t, []string{"<think>", "思考", "</thi", "nk>正文"})
	if r != "思考" {
		t.Fatalf("expected reasoning=思考, got %q", r)
	}
	if c != "正文" {
		t.Fatalf("expected content=正文, got %q", c)
	}
}

func TestThinkSplitter_RealMinimaxTrace(t *testing.T) {
	// 复刻日志中 MINIMAX 的真实输出序列。
	deltas := []string{
		"<think>The",
		" user sent \"测试\" twice.",
		" This is a test.",
		"</think>\n\n你好！\n\n",
		"- 项目一\n",
		"- 项目二\n",
	}
	r, c := feedAll(t, deltas)
	wantR := "The user sent \"测试\" twice. This is a test."
	if r != wantR {
		t.Fatalf("expected reasoning=%q, got %q", wantR, r)
	}
	// </think> 后的 \n\n 是模型输出的正文一部分，剥离标签只移除 <think>...</think> 本身，
	// 不改动标签外的任何字符（包括闭合标签后的换行）。
	wantC := "\n\n你好！\n\n- 项目一\n- 项目二\n"
	if c != wantC {
		t.Fatalf("expected content=%q, got %q", wantC, c)
	}
}

func TestThinkSplitter_UnclosedThink(t *testing.T) {
	// 只有 <think> 开标签，流结束时未闭合：思考内容全部归 reasoning。
	r, c := feedAll(t, []string{"<think>", "只有思考", "没有结束"})
	if r != "只有思考没有结束" {
		t.Fatalf("expected reasoning=只有思考没有结束, got %q", r)
	}
	if c != "" {
		t.Fatalf("expected empty content, got %q", c)
	}
}

func TestThinkSplitter_LoneAngleBracket(t *testing.T) {
	// 普通文本里出现的 '<' 不是标签开头，应原样输出。
	r, c := feedAll(t, []string{"a < b && b > c", " 后续"})
	if r != "" || c != "a < b && b > c 后续" {
		t.Fatalf("expected no split, got reasoning=%q content=%q", r, c)
	}
}

func TestThinkSplitter_LoneAngleAtChunkEnd(t *testing.T) {
	// '<' 出现在 chunk 末尾且不是标签开头，下一 chunk 才能确认。
	// 这里 '<' 后跟空格，明确不是 <think> 前缀。
	r, c := feedAll(t, []string{"x <", " y"})
	if r != "" || c != "x < y" {
		t.Fatalf("expected content=x < y, got reasoning=%q content=%q", r, c)
	}
}

func TestThinkSplitter_IncompleteTagAtEOF(t *testing.T) {
	// 流结束时 pending 里残留 "<thi"（半个标签前缀），应按普通文本冲出，不丢字。
	r, c := feedAll(t, []string{"正文", "<thi"})
	// "<thi" 不是完整 <think>，Flush 后作为 content。
	if r != "" {
		t.Fatalf("expected no reasoning, got %q", r)
	}
	if c != "正文<thi" {
		t.Fatalf("expected content=正文<thi, got %q", c)
	}
}

func TestThinkSplitter_StreamingEvents(t *testing.T) {
	// 验证流式过程中每个 chunk 的分类，确保前端能收到连续的 reasoning/content 事件。
	s := newThinkSplitter()

	// chunk 1: <think> 开标签，无文本输出
	r, c := s.Feed("<think>")
	if r != "" || c != "" {
		t.Fatalf("chunk1: expected empty, got r=%q c=%q", r, c)
	}
	// chunk 2: 思考内容
	r, c = s.Feed("思考")
	if r != "思考" || c != "" {
		t.Fatalf("chunk2: expected r=思考, got r=%q c=%q", r, c)
	}
	// chunk 3: 闭合 + 正文
	r, c = s.Feed("</think>正文")
	if r != "" || c != "正文" {
		t.Fatalf("chunk3: expected c=正文, got r=%q c=%q", r, c)
	}
	// chunk 4: 纯正文
	r, c = s.Feed("更多")
	if r != "" || c != "更多" {
		t.Fatalf("chunk4: expected c=更多, got r=%q c=%q", r, c)
	}
}

func TestThinkSplitter_MultipleThinkBlocks(t *testing.T) {
	// 同一回复中出现多个 <think> 块。
	r, c := feedAll(t, []string{
		"<think>第一段思考</think>",
		"中间正文",
		"<think>第二段思考</think>",
		"结尾正文",
	})
	if r != "第一段思考第二段思考" {
		t.Fatalf("expected reasoning=第一段思考第二段思考, got %q", r)
	}
	if c != "中间正文结尾正文" {
		t.Fatalf("expected content=中间正文结尾正文, got %q", c)
	}
}

func TestStripThinkTags_NoTags(t *testing.T) {
	got := stripThinkTags("普通标题")
	if got != "普通标题" {
		t.Fatalf("expected 普通标题, got %q", got)
	}
}

func TestStripThinkTags_TitleWithThink(t *testing.T) {
	// 复刻 MINIMAX 标题生成场景：<think> + 实际标题。
	got := stripThinkTags("<think>这是一条测试消息，需要生成标题</think>测试消息")
	if got != "测试消息" {
		t.Fatalf("expected 测试消息, got %q", got)
	}
}

func TestStripThinkTags_TitleWithNewlineAfterClose(t *testing.T) {
	// 闭合标签后紧跟换行再是标题（常见形态）。
	got := stripThinkTags("<think>思考</think>\n\n关于笔记的整理")
	if got != "\n\n关于笔记的整理" {
		t.Fatalf("expected \\n\\n关于笔记的整理, got %q", got)
	}
}

func TestStripThinkTags_Unclosed(t *testing.T) {
	// 只有开标签未闭合：其后内容视为思考、整体移除。
	got := stripThinkTags("标题前缀<think>未闭合的思考内容")
	if got != "标题前缀" {
		t.Fatalf("expected 标题前缀, got %q", got)
	}
}

func TestStripThinkTags_LoneAngleBracket(t *testing.T) {
	// 普通文本里的 '<' 不是 think 标签，应保留原样。
	got := stripThinkTags("a < b 的比较")
	if got != "a < b 的比较" {
		t.Fatalf("expected 原样保留, got %q", got)
	}
}

func TestStripThinkTags_MultipleBlocks(t *testing.T) {
	got := stripThinkTags("<think>块一</think>A<think>块二</think>B")
	if got != "AB" {
		t.Fatalf("expected AB, got %q", got)
	}
}
