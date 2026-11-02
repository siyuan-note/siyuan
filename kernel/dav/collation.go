// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"errors"
	"net/http"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// 支持的文本匹配排序规则（RFC 4790、RFC 5051）。
const (
	CollationOctet          = "i;octet"
	CollationASCIICasemap   = "i;ascii-casemap"
	CollationUnicodeCasemap = "i;unicode-casemap"
)

// Collations 是 supported-collation-set 属性列出的排序规则。
var Collations = []string{CollationASCIICasemap, CollationOctet, CollationUnicodeCasemap}

// MatchType 是 CardDAV text-match 的匹配方式（RFC 6352 §10.5.4）；CalDAV 只做子串匹配。
type MatchType string

const (
	MatchEquals     MatchType = "equals"
	MatchContains   MatchType = "contains"
	MatchStartsWith MatchType = "starts-with"
	MatchEndsWith   MatchType = "ends-with"
)

// TextMatch 是 text-match 元素描述的文本条件。
type TextMatch struct {
	Text      string
	Collation string
	MatchType MatchType
	Negate    bool
}

// textMatchSyntax 描述 CalDAV 与 CardDAV 的 text-match 差异。
type textMatchSyntax struct {
	namespace        string
	defaultCollation string
	matchType        bool
	invalidFilter    string
}

var (
	calDAVTextMatch  = textMatchSyntax{namespace: NamespaceCalDAV, defaultCollation: CollationASCIICasemap, invalidFilter: "valid-filter"}
	cardDAVTextMatch = textMatchSyntax{namespace: NamespaceCardDAV, defaultCollation: CollationUnicodeCasemap, matchType: true, invalidFilter: "supported-filter"}
)

func (s textMatchSyntax) filterError(message string) *Error {
	err := NewConditionError(http.StatusForbidden, NewElement(xmlName(s.namespace, s.invalidFilter)))
	err.Err = errors.New(message)
	return err
}

func (s textMatchSyntax) parse(n *Node) (*TextMatch, error) {
	match := &TextMatch{Text: n.Text(), Collation: s.defaultCollation, MatchType: MatchContains}
	if collation, ok := n.Attr("collation"); ok && "" != collation && "default" != collation {
		if !isSupportedCollation(collation) {
			return nil, NewConditionError(http.StatusForbidden, NewElement(xmlName(s.namespace, "supported-collation")))
		}
		match.Collation = collation
	}
	switch negate, _ := n.Attr("negate-condition"); negate {
	case "", "no":
	case "yes":
		match.Negate = true
	default:
		return nil, s.filterError("invalid negate-condition")
	}
	if matchType, ok := n.Attr("match-type"); ok && s.matchType {
		switch MatchType(matchType) {
		case MatchEquals, MatchContains, MatchStartsWith, MatchEndsWith:
			match.MatchType = MatchType(matchType)
		default:
			return nil, s.filterError("invalid match-type")
		}
	}
	return match, nil
}

func isSupportedCollation(collation string) bool {
	for _, supported := range Collations {
		if supported == collation {
			return true
		}
	}
	return false
}

// Match 按排序规则比较值；negate-condition 为 yes 时结果取反。
func (m *TextMatch) Match(value string) bool {
	text, value := foldCollation(m.Collation, m.Text), foldCollation(m.Collation, value)
	var matched bool
	switch m.MatchType {
	case MatchEquals:
		matched = value == text
	case MatchStartsWith:
		matched = strings.HasPrefix(value, text)
	case MatchEndsWith:
		matched = strings.HasSuffix(value, text)
	default:
		matched = strings.Contains(value, text)
	}
	return matched != m.Negate
}

// foldCollation 把字符串转换为排序规则的比较形式：i;ascii-casemap 只把 ASCII 小写字母映射为大写（RFC 4790 §9.2），
// i;unicode-casemap 先做 Unicode 简单标题大小写映射再做 NFKD 分解（RFC 5051 §2）；分解出的字符（例如连字 ﬁ 分解出的 f、i）
// 还要再映射一次，否则不能与直接输入的字母相等。
func foldCollation(collation, s string) string {
	switch collation {
	case CollationOctet:
		return s
	case CollationUnicodeCasemap:
		return strings.Map(unicode.ToTitle, norm.NFKD.String(strings.Map(unicode.ToTitle, s)))
	}
	return strings.Map(func(r rune) rune {
		if 'a' <= r && r <= 'z' {
			return r - 'a' + 'A'
		}
		return r
	}, s)
}

// ParamFilter 是 param-filter 元素描述的参数条件，CalDAV 与 CardDAV 的语义相同。
type ParamFilter struct {
	Name         string
	IsNotDefined bool
	TextMatch    *TextMatch
}

func (s textMatchSyntax) parseParamFilter(n *Node) (*ParamFilter, error) {
	name, _ := n.Attr("name")
	if "" == name {
		return nil, s.filterError("param-filter requires a name")
	}
	filter := &ParamFilter{Name: strings.ToUpper(name)}
	children := n.Children()
	if 1 < len(children) {
		return nil, s.filterError("param-filter has more than one condition")
	}
	for _, child := range children {
		switch child.XMLName {
		case xmlName(s.namespace, "is-not-defined"):
			filter.IsNotDefined = true
		case xmlName(s.namespace, "text-match"):
			match, err := s.parse(child)
			if err != nil {
				return nil, err
			}
			filter.TextMatch = match
		default:
			return nil, s.filterError("unexpected element in param-filter")
		}
	}
	return filter, nil
}

// Match 判断参数值列表是否满足条件；values 为空表示参数不存在。
func (f *ParamFilter) Match(values []string) bool {
	if f.IsNotDefined {
		return 0 == len(values)
	}
	if nil == f.TextMatch {
		return 0 < len(values)
	}
	for _, value := range values {
		if f.TextMatch.Match(value) {
			return true
		}
	}
	return false
}
