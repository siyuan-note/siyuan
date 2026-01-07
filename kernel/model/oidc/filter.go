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

package oidc

import (
	"regexp"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model/oidc/provider"
)

func IsAllowed(filters map[string][]string, claims *provider.OIDCClaims) bool {
	if 0 == len(filters) {
		return true
	}

	values := claims.FilterValues()
	for key, patterns := range filters {
		if 0 == len(patterns) {
			continue
		}
		vals, ok := values[key]
		if !ok || 0 == len(vals) {
			return false
		}

		if !matchAnyPattern(vals, patterns) {
			return false
		}
	}
	return true
}

func matchAnyPattern(values []string, patterns []string) bool {
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if "" == pattern {
			continue
		}

		matcher, err := buildMatcher(pattern)
		if err != nil {
			logging.LogErrorf("invalid oidc filter pattern [%s]: %s", pattern, err)
			continue
		}
		for _, value := range values {
			if matcher.Match(value) {
				return true
			}
		}
	}
	return false
}

type patternMatcher interface {
	Match(value string) bool
}

type matcherFactory func(pattern string) (patternMatcher, error)

var matcherFactories = map[string]matcherFactory{
	"regex": func(pattern string) (patternMatcher, error) { return newRegexMatcher(pattern, false) },
	"re":    func(pattern string) (patternMatcher, error) { return newRegexMatcher(pattern, false) },

	"regexi": func(pattern string) (patternMatcher, error) { return newRegexMatcher(pattern, true) },

	"str":    func(pattern string) (patternMatcher, error) { return newStringMatcher(pattern, true) },
	"string": func(pattern string) (patternMatcher, error) { return newStringMatcher(pattern, true) },

	"exact": func(pattern string) (patternMatcher, error) { return newStringMatcher(pattern, false) },
}

func buildMatcher(pattern string) (patternMatcher, error) {
	if prefix, after, ok := strings.Cut(pattern, ":"); ok {
		prefix = strings.ToLower(strings.TrimSpace(prefix))
		if factory, ok := matcherFactories[prefix]; ok {
			return factory(strings.TrimSpace(after))
		}
	}

	return newRegexMatcher(pattern, true)
}

type regexMatcher struct {
	re *regexp.Regexp
}

func newRegexMatcher(pattern string, forceCaseInsensitive bool) (patternMatcher, error) {
	if forceCaseInsensitive {
		pattern = ensureCaseInsensitiveRegex(pattern)
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}
	return &regexMatcher{re: re}, nil
}

func (m *regexMatcher) Match(value string) bool {
	return m.re.MatchString(value)
}

func ensureCaseInsensitiveRegex(pattern string) string {
	if strings.HasPrefix(pattern, "(?i)") || strings.HasPrefix(pattern, "(?-i)") {
		return pattern
	}
	return "(?i)" + pattern
}

type stringMatcher struct {
	pattern         string
	caseInsensitive bool
}

func newStringMatcher(pattern string, caseInsensitive bool) (patternMatcher, error) {
	return &stringMatcher{pattern: pattern, caseInsensitive: caseInsensitive}, nil
}

func (m *stringMatcher) Match(value string) bool {
	if m.caseInsensitive {
		return strings.EqualFold(value, m.pattern)
	}
	return value == m.pattern
}
