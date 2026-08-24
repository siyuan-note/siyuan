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

package tools

import (
	"bufio"
	"fmt"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	agentLogDefaultReadLimit   = 200
	agentLogMaxReadLimit       = 2000
	agentLogDefaultSearchLimit = 50
	agentLogMaxSearchLimit     = 200
	agentLogDefaultContext     = 2
	agentLogMaxContext         = 20
	agentLogMaxQueryLength     = 512
	agentLogMaxLineBytes       = 4 * 1024 * 1024
	agentLogMaxOutputBytes     = 128 * 1024
	agentLogRedacted           = "[REDACTED]"
)

var (
	agentLogQuerySecretPattern = regexp.MustCompile(
		`(?i)([?&](?:token|api[_-]?key|access[_-]?token|password|secret|client[_-]?secret|accessauthcode)=)[^&\s"'<>]+`)
	agentLogNamedSecretPattern = regexp.MustCompile(
		`(?i)(["']?(?:token|api[_-]?key|access[_-]?token|password|secret|client[_-]?secret|accessauthcode)["']?\s*[:=]\s*["']?)[^"',}\]\s]+`)
	agentLogAuthorizationPattern = regexp.MustCompile(
		`(?i)(authorization\s*[:=]\s*)["']?(?:(?:bearer|token|basic)\s+)?[^"',}\]\s]+`)
)

var AgentLogTool = &Tool{
	Name: "log",
	Description: "Inspect the sanitized SiYuan kernel log. Actions: stat(), tail(limit=200), " +
		"read(offset, limit=200), search(query, context=2, limit=50). The path is fixed and known credentials are redacted.",
	AgentOnly:    true,
	ReadOnlyHint: true,
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":  {Type: "string", Description: "Operation", Enum: []string{"stat", "tail", "read", "search"}},
			"offset":  {Type: "number", Description: "First 1-based line number for read"},
			"limit":   {Type: "number", Description: "Maximum lines for tail/read or matches for search"},
			"query":   {Type: "string", Description: "Case-insensitive plain-text query for search"},
			"context": {Type: "number", Description: "Context lines before and after each search match (maximum 20)"},
		},
		Required: []string{"action"},
	},
	EffectScope: EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{
		"stat":   {LocalRead: true},
		"tail":   {LocalRead: true},
		"read":   {LocalRead: true},
		"search": {LocalRead: true},
	},
	Handler: agentLogHandler,
}

type numberedAgentLogLine struct {
	number int
	text   string
}

func init() {
	register(AgentLogTool)
}

func agentLogHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "stat":
		return agentLogStat()
	case "tail":
		return agentLogTail(args)
	case "read":
		return agentLogRead(args)
	case "search":
		return agentLogSearch(args)
	}
	return agentLogError("unknown action '" + action + "', expected one of: [stat, tail, read, search]"), nil
}

func agentLogStat() (CallToolResult, error) {
	if util.LogPath == "" {
		return agentLogError("kernel log path is unavailable"), nil
	}
	info, err := os.Stat(util.LogPath)
	if err != nil {
		return agentLogError("stat kernel log failed: " + err.Error()), nil
	}
	lines, err := scanAgentLog(func(_ int, _ string) bool { return true })
	if err != nil {
		return agentLogError("read kernel log failed: " + err.Error()), nil
	}
	result := fmt.Sprintf("Size: %d bytes\nLines: %d\nModified: %s", info.Size(), lines,
		info.ModTime().Format(time.RFC3339))
	return agentLogResult(result), nil
}

func agentLogTail(args map[string]any) (CallToolResult, error) {
	limit := resolveAgentLogLimit(args, agentLogDefaultReadLimit, agentLogMaxReadLimit)
	ring := make([]numberedAgentLogLine, limit)
	total, err := scanAgentLog(func(number int, line string) bool {
		ring[(number-1)%limit] = numberedAgentLogLine{number: number, text: line}
		return true
	})
	if err != nil {
		return agentLogError("read kernel log failed: " + err.Error()), nil
	}
	if total == 0 {
		return agentLogResult("Kernel log is empty."), nil
	}
	count := min(total, limit)
	lines := make([]numberedAgentLogLine, 0, count)
	if total <= limit {
		lines = append(lines, ring[:count]...)
	} else {
		start := total % limit
		lines = append(lines, ring[start:]...)
		lines = append(lines, ring[:start]...)
	}
	header := fmt.Sprintf("Kernel log lines %d-%d of %d:", lines[0].number, lines[len(lines)-1].number, total)
	return agentLogResult(formatAgentLogLines(header, lines)), nil
}

func agentLogRead(args map[string]any) (CallToolResult, error) {
	offset := int(getFloat64Arg(args, "offset"))
	if offset < 1 {
		offset = 1
	}
	limit := resolveAgentLogLimit(args, agentLogDefaultReadLimit, agentLogMaxReadLimit)
	lines := make([]numberedAgentLogLine, 0, limit)
	total, err := scanAgentLog(func(number int, line string) bool {
		if number < offset {
			return true
		}
		lines = append(lines, numberedAgentLogLine{number: number, text: line})
		return len(lines) < limit
	})
	if err != nil {
		return agentLogError("read kernel log failed: " + err.Error()), nil
	}
	if len(lines) == 0 {
		return agentLogError(fmt.Sprintf("line offset %d is out of range; scanned %d lines", offset, total)), nil
	}
	header := fmt.Sprintf("Kernel log lines %d-%d:", lines[0].number, lines[len(lines)-1].number)
	return agentLogResult(formatAgentLogLines(header, lines)), nil
}

func agentLogSearch(args map[string]any) (CallToolResult, error) {
	query, _ := args["query"].(string)
	query = strings.TrimSpace(query)
	if query == "" {
		return agentLogError("query is required for search"), nil
	}
	if len([]rune(query)) > agentLogMaxQueryLength {
		return agentLogError(fmt.Sprintf("query exceeds the maximum length of %d characters", agentLogMaxQueryLength)), nil
	}
	contextLines := agentLogDefaultContext
	if _, ok := args["context"]; ok {
		contextLines = int(getFloat64Arg(args, "context"))
	}
	if contextLines < 0 {
		contextLines = 0
	} else if contextLines > agentLogMaxContext {
		contextLines = agentLogMaxContext
	}
	matchLimit := resolveAgentLogLimit(args, agentLogDefaultSearchLimit, agentLogMaxSearchLimit)
	queryLower := strings.ToLower(query)
	before := make([]numberedAgentLogLine, 0, contextLines)
	resultLines := []numberedAgentLogLine{}
	matches := 0
	pendingUntil := 0
	lastAdded := 0
	_, err := scanAgentLog(func(number int, line string) bool {
		current := numberedAgentLogLine{number: number, text: line}
		matched := matches < matchLimit && strings.Contains(strings.ToLower(line), queryLower)
		if matched {
			matches++
			for _, previous := range before {
				if previous.number > lastAdded {
					resultLines = append(resultLines, previous)
					lastAdded = previous.number
				}
			}
			if number > lastAdded {
				resultLines = append(resultLines, current)
				lastAdded = number
			}
			pendingUntil = max(pendingUntil, number+contextLines)
		} else if number <= pendingUntil && number > lastAdded {
			resultLines = append(resultLines, current)
			lastAdded = number
		}

		if contextLines > 0 {
			before = append(before, current)
			if len(before) > contextLines {
				before = before[len(before)-contextLines:]
			}
		}
		return matches < matchLimit || number < pendingUntil
	})
	if err != nil {
		return agentLogError("search kernel log failed: " + err.Error()), nil
	}
	if matches == 0 {
		return agentLogResult("No matches found in the kernel log."), nil
	}
	header := fmt.Sprintf("Kernel log search found %d match(es), with %d context line(s):", matches, contextLines)
	return agentLogResult(formatAgentLogLines(header, resultLines)), nil
}

func scanAgentLog(visit func(number int, line string) bool) (int, error) {
	if util.LogPath == "" {
		return 0, fmt.Errorf("kernel log path is unavailable")
	}
	file, err := os.Open(util.LogPath)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), agentLogMaxLineBytes)
	lineCount := 0
	for scanner.Scan() {
		lineCount++
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if !visit(lineCount, line) {
			break
		}
	}
	return lineCount, scanner.Err()
}

func resolveAgentLogLimit(args map[string]any, defaultLimit, maxLimit int) int {
	limit := int(getFloat64Arg(args, "limit"))
	if limit < 1 {
		return defaultLimit
	}
	return min(limit, maxLimit)
}

func formatAgentLogLines(header string, lines []numberedAgentLogLine) string {
	var builder strings.Builder
	builder.WriteString(header)
	builder.WriteByte('\n')
	previous := 0
	for _, line := range lines {
		if previous > 0 && line.number > previous+1 {
			builder.WriteString("--\n")
		}
		fmt.Fprintf(&builder, "%d: %s\n", line.number, line.text)
		previous = line.number
	}
	return builder.String()
}

func agentLogResult(text string) CallToolResult {
	text = redactAgentLog(text)
	text = truncateAgentLogOutput(text)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: text}}}
}

func agentLogError(message string) CallToolResult {
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: message}}, IsError: true}
}

func redactAgentLog(text string) string {
	for _, secret := range configuredAgentLogSecrets() {
		text = strings.ReplaceAll(text, secret, agentLogRedacted)
	}
	text = agentLogQuerySecretPattern.ReplaceAllString(text, "${1}"+agentLogRedacted)
	text = agentLogNamedSecretPattern.ReplaceAllString(text, "${1}"+agentLogRedacted)
	return agentLogAuthorizationPattern.ReplaceAllString(text, "${1}"+agentLogRedacted)
}

func configuredAgentLogSecrets() []string {
	if model.Conf == nil {
		return nil
	}
	snapshot, err := model.GetMaskedConf()
	if err != nil || snapshot == nil {
		return nil
	}
	secrets := map[string]struct{}{}
	collectAgentLogSecrets(reflect.ValueOf(snapshot), "", secrets)
	result := make([]string, 0, len(secrets))
	for secret := range secrets {
		result = append(result, secret)
	}
	sort.Slice(result, func(i, j int) bool { return len(result[i]) > len(result[j]) })
	return result
}

func collectAgentLogSecrets(value reflect.Value, ownerType string, secrets map[string]struct{}) {
	if !value.IsValid() {
		return
	}
	for value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface {
		if value.IsNil() {
			return
		}
		value = value.Elem()
	}

	switch value.Kind() {
	case reflect.Struct:
		valueType := value.Type()
		for i := 0; i < value.NumField(); i++ {
			fieldType := valueType.Field(i)
			if fieldType.PkgPath != "" {
				continue
			}
			name := strings.Split(fieldType.Tag.Get("json"), ",")[0]
			if name == "" || name == "-" {
				name = fieldType.Name
			}
			field := value.Field(i)
			if isAgentLogSecretField(valueType.Name(), name) {
				collectAgentLogSecretValues(field, secrets)
				continue
			}
			collectAgentLogSecrets(field, valueType.Name(), secrets)
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < value.Len(); i++ {
			collectAgentLogSecrets(value.Index(i), ownerType, secrets)
		}
	case reflect.Map:
		iterator := value.MapRange()
		for iterator.Next() {
			key := fmt.Sprint(iterator.Key().Interface())
			if isAgentLogSecretField(ownerType, key) {
				collectAgentLogSecretValues(iterator.Value(), secrets)
			} else {
				collectAgentLogSecrets(iterator.Value(), ownerType, secrets)
			}
		}
	}
}

func collectAgentLogSecretValues(value reflect.Value, secrets map[string]struct{}) {
	for value.IsValid() && (value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface) {
		if value.IsNil() {
			return
		}
		value = value.Elem()
	}
	if !value.IsValid() {
		return
	}
	if value.Kind() == reflect.String {
		secret := value.String()
		if len(secret) >= 8 && secret != model.MaskedAccessAuthCode {
			secrets[secret] = struct{}{}
		}
		return
	}
	collectAgentLogSecrets(value, "", secrets)
}

func isAgentLogSecretField(ownerType, name string) bool {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(name))
	switch normalized {
	case "token", "accesstoken", "refreshtoken", "usertoken", "apikey", "clientsecret", "secretkey",
		"accesskey", "password", "passphrase", "credential", "authorization", "proxyauthorization", "cookiekey",
		"mcpoauth":
		return true
	case "value":
		return ownerType == "Secret"
	}
	return false
}

func truncateAgentLogOutput(text string) string {
	if len(text) <= agentLogMaxOutputBytes {
		return text
	}
	marker := "\n[output truncated]\n"
	end := agentLogMaxOutputBytes - len(marker)
	for end > 0 && !utf8.ValidString(text[:end]) {
		end--
	}
	return text[:end] + marker
}
