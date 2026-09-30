package model

import (
	"encoding/json"
	"errors"
	"path"
	"strconv"
	"strings"
	"unicode"

	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
)

type ankiConnectQuery struct {
	tokens []string
	index  int
}
type ankiConnectPredicate func(ankiConnectNoteInfo) bool

func findAnkiConnectNotes(query string, notes []ankiConnectNoteInfo) ([]byte, error) {
	match, err := parseAnkiConnectQuery(query)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0)
	for _, note := range notes {
		if match(note) {
			ids = append(ids, note.NoteID)
		}
	}
	return json.Marshal(ids)
}

// parseAnkiConnectQuery 支持字段、笔记、牌组、标签、数字身份及布尔组合，拒绝未支持的限定词。
func parseAnkiConnectQuery(query string) (ankiConnectPredicate, error) {
	if len(query) > 8192 {
		return nil, errors.New("query is too large")
	}
	var tokens []string
	var current strings.Builder
	quoted, escaped := false, false
	flush := func() {
		if current.Len() > 0 {
			tokens = append(tokens, current.String())
			current.Reset()
		}
	}
	for _, char := range query {
		if escaped {
			current.WriteRune(char)
			escaped = false
			continue
		}
		if char == '\\' {
			escaped = true
			continue
		}
		if char == '"' {
			quoted = !quoted
			continue
		}
		if !quoted && (unicode.IsSpace(char) || char == '(' || char == ')') {
			flush()
			if char == '(' || char == ')' {
				tokens = append(tokens, string(char))
			}
			continue
		}
		current.WriteRune(char)
	}
	if quoted || escaped {
		return nil, errors.New("invalid quoted query")
	}
	flush()
	if len(tokens) == 0 {
		return func(ankiConnectNoteInfo) bool { return true }, nil
	}
	parser := ankiConnectQuery{tokens: tokens}
	result, err := parser.or(0)
	if err != nil {
		return nil, err
	}
	if parser.index != len(tokens) {
		return nil, errors.New("invalid query expression")
	}
	return result, nil
}

func (query *ankiConnectQuery) or(depth int) (ankiConnectPredicate, error) {
	left, err := query.and(depth)
	if err != nil {
		return nil, err
	}
	for query.index < len(query.tokens) && strings.EqualFold(query.tokens[query.index], "or") {
		query.index++
		right, err := query.and(depth)
		if err != nil {
			return nil, err
		}
		previous := left
		left = func(note ankiConnectNoteInfo) bool { return previous(note) || right(note) }
	}
	return left, nil
}

func (query *ankiConnectQuery) and(depth int) (ankiConnectPredicate, error) {
	if depth > 32 {
		return nil, errors.New("query is too deeply nested")
	}
	var parts []ankiConnectPredicate
	for query.index < len(query.tokens) && query.tokens[query.index] != ")" && !strings.EqualFold(query.tokens[query.index], "or") {
		if strings.EqualFold(query.tokens[query.index], "and") {
			if len(parts) == 0 {
				return nil, errors.New("invalid and expression")
			}
			query.index++
		}
		if query.index >= len(query.tokens) || query.tokens[query.index] == ")" || strings.EqualFold(query.tokens[query.index], "or") || strings.EqualFold(query.tokens[query.index], "and") {
			return nil, errors.New("missing query operand")
		}
		token := query.tokens[query.index]
		query.index++
		negate := strings.HasPrefix(token, "-")
		if negate {
			token = strings.TrimPrefix(token, "-")
		}
		if token == "" && query.index < len(query.tokens) {
			token = query.tokens[query.index]
			query.index++
		}
		if token == "" || token == ")" || strings.EqualFold(token, "or") || strings.EqualFold(token, "and") {
			return nil, errors.New("missing query operand")
		}
		var part ankiConnectPredicate
		var err error
		if token == "(" {
			part, err = query.or(depth + 1)
			if err == nil {
				if query.index >= len(query.tokens) || query.tokens[query.index] != ")" {
					return nil, errors.New("unclosed query group")
				}
				query.index++
			}
		} else {
			part, err = ankiConnectQueryTerm(token)
		}
		if err != nil {
			return nil, err
		}
		if negate {
			original := part
			part = func(note ankiConnectNoteInfo) bool { return !original(note) }
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return nil, errors.New("missing query operand")
	}
	return func(note ankiConnectNoteInfo) bool {
		for _, part := range parts {
			if !part(note) {
				return false
			}
		}
		return true
	}, nil
}

func ankiConnectQueryTerm(token string) (ankiConnectPredicate, error) {
	field, value, qualified := strings.Cut(token, ":")
	if !qualified {
		value = token
	}
	field = strings.ToLower(field)
	if qualified && (field == "is" || field == "prop" || field == "rated" || field == "added" || field == "edited") {
		return nil, errors.New("unsupported query qualifier: " + field)
	}
	if qualified && field == "nid" {
		ids := make(map[int64]bool)
		for _, text := range strings.Split(value, ",") {
			id, err := strconv.ParseInt(text, 10, 64)
			if err != nil || id <= 0 {
				return nil, errors.New("invalid note ID query")
			}
			ids[id] = true
		}
		return func(note ankiConnectNoteInfo) bool { return ids[note.NoteID] }, nil
	}
	match := func(text string, exact bool) bool {
		text, pattern := strings.ToLower(text), strings.ToLower(value)
		if strings.ContainsAny(pattern, "*?") {
			found, err := path.Match(pattern, text)
			return err == nil && found
		}
		if exact {
			return text == pattern
		}
		return strings.Contains(text, pattern)
	}
	return func(note ankiConnectNoteInfo) bool {
		if qualified {
			switch field {
			case "deck":
				return match(note.DeckName, true) || strings.HasPrefix(strings.ToLower(note.DeckName), strings.ToLower(value)+"::")
			case "note":
				return match(note.ModelName, true)
			case "tag":
				for _, tag := range note.Tags {
					if match(tag, true) {
						return true
					}
				}
				return false
			default:
				for name, item := range note.Fields {
					if strings.EqualFold(name, field) {
						return match(flashcardv2.NormalizeAnkiConnectField(item.Value), true)
					}
				}
				return false
			}
		}
		for _, item := range note.Fields {
			if match(flashcardv2.NormalizeAnkiConnectField(item.Value), false) {
				return true
			}
		}
		return false
	}, nil
}
