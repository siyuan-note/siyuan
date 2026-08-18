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
