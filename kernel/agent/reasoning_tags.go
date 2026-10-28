// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import "strings"

type reasoningTagSegment struct {
	text      string
	reasoning bool
}

type reasoningTagSplitter struct {
	buffer     string
	closingTag string
}

var reasoningOpeningTags = []struct {
	open  string
	close string
}{
	{open: "<thought>", close: "</thought>"},
	{open: "<think>", close: "</think>"},
}

func (s *reasoningTagSplitter) Write(text string) []reasoningTagSegment {
	s.buffer += text
	return s.drain(false)
}

func (s *reasoningTagSplitter) Flush() []reasoningTagSegment {
	return s.drain(true)
}

func (s *reasoningTagSplitter) drain(flush bool) (segments []reasoningTagSegment) {
	for s.buffer != "" {
		if s.closingTag != "" {
			if index := strings.Index(s.buffer, s.closingTag); index >= 0 {
				segments = appendReasoningTagSegment(segments, s.buffer[:index], true)
				s.buffer = s.buffer[index+len(s.closingTag):]
				s.closingTag = ""
				continue
			}
			keep := 0
			if !flush {
				keep = longestReasoningTagPrefixSuffix(s.buffer, []string{s.closingTag})
			}
			segments = appendReasoningTagSegment(segments, s.buffer[:len(s.buffer)-keep], true)
			s.buffer = s.buffer[len(s.buffer)-keep:]
			break
		}

		index, closingTag := findReasoningOpeningTag(s.buffer)
		if index >= 0 {
			segments = appendReasoningTagSegment(segments, s.buffer[:index], false)
			openingLength := len(reasoningOpeningTagForClose(closingTag))
			s.buffer = s.buffer[index+openingLength:]
			s.closingTag = closingTag
			continue
		}

		keep := 0
		if !flush {
			openingTags := make([]string, 0, len(reasoningOpeningTags))
			for _, tag := range reasoningOpeningTags {
				openingTags = append(openingTags, tag.open)
			}
			keep = longestReasoningTagPrefixSuffix(s.buffer, openingTags)
		}
		segments = appendReasoningTagSegment(segments, s.buffer[:len(s.buffer)-keep], false)
		s.buffer = s.buffer[len(s.buffer)-keep:]
		break
	}
	return
}

func findReasoningOpeningTag(text string) (index int, closingTag string) {
	index = -1
	for _, tag := range reasoningOpeningTags {
		candidate := strings.Index(text, tag.open)
		if candidate >= 0 && (index < 0 || candidate < index) {
			index = candidate
			closingTag = tag.close
		}
	}
	return
}

func reasoningOpeningTagForClose(closingTag string) string {
	for _, tag := range reasoningOpeningTags {
		if tag.close == closingTag {
			return tag.open
		}
	}
	return ""
}

func longestReasoningTagPrefixSuffix(text string, tags []string) int {
	longest := 0
	for _, tag := range tags {
		limit := min(len(text), len(tag)-1)
		for length := limit; length > longest; length-- {
			if strings.HasSuffix(text, tag[:length]) {
				longest = length
				break
			}
		}
	}
	return longest
}

func appendReasoningTagSegment(segments []reasoningTagSegment, text string, reasoning bool) []reasoningTagSegment {
	if text == "" {
		return segments
	}
	if len(segments) > 0 && segments[len(segments)-1].reasoning == reasoning {
		segments[len(segments)-1].text += text
		return segments
	}
	return append(segments, reasoningTagSegment{text: text, reasoning: reasoning})
}
