package model

import (
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewSearchParseMarks(t *testing.T) {
	tests := []struct {
		name, marked, plain string
		ranges              []attributeViewSearchRange
		ok                  bool
	}{
		{name: "plain", marked: "A&amp;B", plain: "A&B", ok: true},
		{name: "entities and multibyte offsets", marked: "前&amp;<mark>🙂&lt;x&gt;</mark>后", plain: "前&🙂<x>后", ranges: []attributeViewSearchRange{{len("前&"), len("前&🙂<x>")}}, ok: true},
		{name: "literal markup", marked: "&lt;mark&gt;<mark>safe</mark>&lt;/mark&gt;", plain: "<mark>safe</mark>", ranges: []attributeViewSearchRange{{6, 10}}, ok: true},
		{name: "adjacent marks", marked: "<mark>a</mark><mark>b</mark>", plain: "ab", ranges: []attributeViewSearchRange{{0, 1}, {1, 2}}, ok: true},
		{name: "unclosed mark", marked: "before <mark>hit"},
		{name: "empty mark", marked: "<mark></mark>"},
		{name: "nested mark", marked: "<mark>a<mark>b</mark></mark>"},
		{name: "stray closing tail", marked: "<mark>a</mark></mark>"},
		{name: "stray closing prefix", marked: "</mark><mark>a</mark>"},
		{name: "stray closing between marks", marked: "<mark>a</mark></mark><mark>b</mark>"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plain, ranges, ok := parseAttributeViewSearchMarks(test.marked)
			if ok != test.ok {
				t.Fatalf("valid = %v, want %v; plain = %q, ranges = %#v", ok, test.ok, plain, ranges)
			}
			if ok && (plain != test.plain || !reflect.DeepEqual(ranges, test.ranges)) {
				t.Fatalf("got (%q, %#v), want (%q, %#v)", plain, ranges, test.plain, test.ranges)
			}
		})
	}
}

func TestAttributeViewSearchMapRanges(t *testing.T) {
	tests := []struct {
		name, source, marked string
		matches              []string
		ok                   bool
	}{
		{name: "full indexed text", source: "DB View Field value ", marked: "DB View Field <mark>value</mark>", matches: []string{"value"}, ok: true},
		{name: "trimmed outer whitespace", source: "  DB  Field value \t ", marked: "DB  Field <mark>value</mark>", matches: []string{"value"}, ok: true},
		{name: "unique context resolves repeated word", source: "DB first foo second foo ", marked: "first <mark>foo</mark>", matches: []string{"foo"}, ok: true},
		{name: "ellipsis windows", source: "DB first foo long unused text second bar ", marked: "...first <mark>foo</mark>...second <mark>bar</mark>...", matches: []string{"foo", "bar"}, ok: true},
		{name: "literal ellipsis exact text", source: "DB Field a...b ", marked: "DB Field <mark>a...b</mark>", matches: []string{"a...b"}, ok: true},
		{name: "entities", source: "DB A&B <x> ", marked: "DB A&amp;B <mark>&lt;x&gt;</mark>", matches: []string{"<x>"}, ok: true},
		{name: "unmarked snippet", source: "DB foo ", marked: "DB foo"},
		{name: "ambiguous word", source: "DB first foo second foo ", marked: "<mark>foo</mark>"},
		{name: "stale snippet", source: "DB new value ", marked: "DB <mark>old</mark> value"},
		{name: "reversed windows", source: "DB first foo second bar ", marked: "...second <mark>bar</mark>...first <mark>foo</mark>..."},
		{name: "mark crosses omitted text", source: "DB foo gap bar ", marked: "...<mark>foo...bar</mark>..."},
		{name: "literal ellipsis prevents guessing", source: "DB a...b Field target ", marked: "...Field <mark>target</mark>..."},
		{name: "truncated generated markup", source: "DB target ", marked: "DB <mark>target"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ranges, ok := mapAttributeViewSearchRanges(test.source, test.marked)
			if ok != test.ok {
				t.Fatalf("mapped = %v, want %v; ranges = %#v", ok, test.ok, ranges)
			}
			if !ok {
				return
			}
			if len(ranges) != len(test.matches) {
				t.Fatalf("got %d ranges, want %d", len(ranges), len(test.matches))
			}
			lastEnd := 0
			for i, match := range ranges {
				if match.start < lastEnd || match.end > len(test.source) || match.start >= match.end {
					t.Fatalf("invalid or out-of-order range %#v", match)
				}
				if got := test.source[match.start:match.end]; got != test.matches[i] {
					t.Fatalf("range %d = %q, want %q", i, got, test.matches[i])
				}
				lastEnd = match.end
			}
		})
	}
}

func TestAttributeViewSearchCompactActualMatches(t *testing.T) {
	attrView := attributeViewSearchTestFixture()
	const source = "Contacts All people Title Project Apollo Project Borealis Status cat concatenate"
	tests := []struct {
		name, marked string
		contains     []string
		absent       []string
	}{
		{
			name:     "field name only",
			marked:   strings.Replace(source, "Status", "<mark>Status</mark>", 1),
			contains: []string{`<span class="fn__code"><mark>Status</mark></span>`},
			absent:   []string{"Project Apollo", "Project Borealis", "concatenate", ">cat<", "All people"},
		},
		{
			name:     "FTS term does not expand into another value",
			marked:   strings.Replace(source, "cat concatenate", "<mark>cat</mark> concatenate", 1),
			contains: []string{"Project Apollo", `<span class="fn__code">Status</span>`, "<mark>cat</mark>"},
			absent:   []string{"Project Borealis", "concatenate", "All people"},
		},
		{
			name:     "regex substring retains actual value",
			marked:   strings.Replace(source, "concatenate", "con<mark>cat</mark>enate", 1),
			contains: []string{"Project Borealis", "con<mark>cat</mark>enate"},
			absent:   []string{"Project Apollo", "All people"},
		},
		{
			name:     "primary value needs no duplicate row label",
			marked:   strings.Replace(source, "Project Apollo", "Project <mark>Apollo</mark>", 1),
			contains: []string{`<span class="fn__code">Title</span> Project <mark>Apollo</mark>`},
			absent:   []string{"Project Apollo ·", "Status", "Project Borealis", "concatenate"},
		},
		{
			name:     "two actual value hits",
			marked:   strings.Replace(strings.Replace(source, "cat concatenate", "<mark>cat</mark> concatenate", 1), "concatenate", "<mark>concatenate</mark>", 1),
			contains: []string{"Project Apollo", "Project Borealis", "<mark>cat</mark>", "<mark>concatenate</mark>"},
			absent:   []string{"All people"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := compactAttributeViewSearchContent(attrView, test.marked)
			if got == test.marked {
				t.Fatalf("expected compact content, retained fallback %q", got)
			}
			for _, want := range test.contains {
				if !strings.Contains(got, want) {
					t.Errorf("content %q does not contain %q", got, want)
				}
			}
			for _, unwanted := range test.absent {
				if strings.Contains(got, unwanted) {
					t.Errorf("content %q includes unrelated text %q", got, unwanted)
				}
			}
		})
	}
}

func TestAttributeViewSearchCompactFallback(t *testing.T) {
	const source = "Contacts All people Title Project Apollo Project Borealis Status cat concatenate"
	tests := []struct {
		name, marked string
		mutate       func(*av.AttributeView)
	}{
		{name: "view only", marked: strings.Replace(source, "All people", "<mark>All people</mark>", 1)},
		{name: "value plus view", marked: strings.Replace(strings.Replace(source, "All people", "<mark>All people</mark>", 1), "cat concatenate", "<mark>cat</mark> concatenate", 1)},
		{name: "cross-field phrase", marked: strings.Replace(source, "Status cat", "<mark>Status cat</mark>", 1)},
		{name: "cross-value phrase", marked: strings.Replace(source, "cat concatenate", "<mark>cat concatenate</mark>", 1)},
		{name: "valid value plus cross-field phrase", marked: strings.Replace(strings.Replace(source, "Project Apollo", "Project <mark>Apollo</mark>", 1), "Status cat", "<mark>Status cat</mark>", 1)},
		{name: "stale AV", marked: strings.Replace(source, "cat concatenate", "<mark>cat</mark> concatenate", 1), mutate: func(attrView *av.AttributeView) { attrView.KeyValues[1].Values[0].Text.Content = "changed" }},
		{name: "no marks", marked: source},
		{name: "nil field", marked: "<mark>cat</mark>", mutate: func(attrView *av.AttributeView) { attrView.KeyValues = append(attrView.KeyValues, nil) }},
		{name: "missing key", marked: "<mark>cat</mark>", mutate: func(attrView *av.AttributeView) { attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{}) }},
		{name: "nil view", marked: "<mark>cat</mark>", mutate: func(attrView *av.AttributeView) { attrView.Views = append(attrView.Views, nil) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			attrView := attributeViewSearchTestFixture()
			if test.mutate != nil {
				test.mutate(attrView)
			}
			if got := compactAttributeViewSearchContent(attrView, test.marked); got != test.marked {
				t.Fatalf("fallback changed: got %q, want %q", got, test.marked)
			}
		})
	}
}

func TestAttributeViewSearchFormattedIndexValues(t *testing.T) {
	tests := []struct {
		name, content string
		value         *av.Value
	}{
		{name: "number", content: "$1,200.00", value: &av.Value{Type: av.KeyTypeNumber, Number: &av.ValueNumber{Content: 1200, FormattedContent: "$1,200.00"}}},
		{name: "date", content: "2026-10-01", value: &av.Value{Type: av.KeyTypeDate, Date: &av.ValueDate{Content: 1790812800000, FormattedContent: "2026-10-01"}}},
		{name: "multiple selections", content: "first second", value: &av.Value{Type: av.KeyTypeMSelect, MSelect: []*av.ValueSelect{{Content: "first"}, {Content: "second"}}}},
		{name: "checkbox", content: "√", value: &av.Value{Type: av.KeyTypeCheckbox, Checkbox: &av.ValueCheckbox{Checked: true}}},
		{name: "relation", content: "linked one, linked two", value: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{Contents: []*av.Value{attributeViewSearchTestText("linked one"), attributeViewSearchTestText("linked two")}}}},
		{name: "rollup", content: "rolled one, rolled two", value: &av.Value{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{attributeViewSearchTestText("rolled one"), attributeViewSearchTestText("rolled two")}}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			attrView := &av.AttributeView{
				Name:      "  DB  ",
				Views:     []*av.View{{Name: "First view"}, {Name: "Second view"}},
				KeyValues: []*av.KeyValues{{Key: &av.Key{Name: "Field", Type: test.value.Type}, Values: []*av.Value{nil, test.value, nil}}},
			}
			marked := "DB   First view Second view Field <mark>" + util.EscapeHTML(test.content) + "</mark>"
			got := compactAttributeViewSearchContent(attrView, marked)
			if got == marked || !strings.Contains(got, `<span class="fn__code">Field</span> <mark>`+util.EscapeHTML(test.content)+`</mark>`) {
				t.Fatalf("formatted index value was not mapped: %q", got)
			}
		})
	}
}

func TestAttributeViewSearchEscapesUserContent(t *testing.T) {
	attrView := &av.AttributeView{
		Name: "<img src=x onerror=alert(1)>",
		KeyValues: []*av.KeyValues{{
			Key:    &av.Key{Name: "<script>field</script>&", Type: av.KeyTypeText},
			Values: []*av.Value{attributeViewSearchTestText("before <mark>literal</mark> A&B <script>value</script> after")},
		}},
	}
	source := attrView.Name + " " + attrView.KeyValues[0].Key.Name + " " + attrView.KeyValues[0].Values[0].String(true)
	marked := strings.Replace(util.EscapeHTML(source), "A&amp;B", "<mark>A&amp;B</mark>", 1)
	got := compactAttributeViewSearchContent(attrView, marked)
	if got == marked || !strings.Contains(got, "<mark>A&amp;B</mark>") {
		t.Fatalf("escaped match was not mapped: %q", got)
	}
	for _, raw := range []string{"<img", "<script>", "<mark>literal</mark>"} {
		if strings.Contains(got, raw) {
			t.Errorf("unescaped user markup %q in %q", raw, got)
		}
	}
	if strings.Count(got, "<mark>") != 1 || strings.Count(got, "</mark>") != 1 {
		t.Fatalf("unexpected generated highlights: %q", got)
	}
}

func TestAttributeViewSearchPartHTMLBounds(t *testing.T) {
	prefix, suffix := strings.Repeat("前🙂&", 40), strings.Repeat("后🙂&", 40)
	text := prefix + "<hit>" + suffix
	part := &attributeViewSearchPart{text: text, ranges: []attributeViewSearchRange{{len(prefix), len(prefix) + len("<hit>")}}}
	got := attributeViewSearchPartHTML(part)
	prefixRunes, suffixRunes := []rune(prefix), []rune(suffix)
	want := "..." + util.EscapeHTML(string(prefixRunes[len(prefixRunes)-32:])) + "<mark>&lt;hit&gt;</mark>" + util.EscapeHTML(string(suffixRunes[:64])) + "..."
	if got != want || !utf8.ValidString(got) {
		t.Fatalf("invalid or unbounded snippet: got %q, want %q", got, want)
	}

	longMatch := strings.Repeat("界", 100)
	part = &attributeViewSearchPart{text: "hit " + longMatch, ranges: []attributeViewSearchRange{{0, 3}, {4, 4 + len(longMatch)}}}
	got = attributeViewSearchPartHTML(part)
	if want = "<mark>hit</mark> <mark>" + longMatch + "</mark>"; got != want {
		t.Fatalf("match crossing context edge was split: %q", got)
	}

	part = &attributeViewSearchPart{text: "hit " + strings.Repeat("x", 100) + " distant", ranges: []attributeViewSearchRange{{0, 3}, {105, 112}}}
	got = attributeViewSearchPartHTML(part)
	if strings.Contains(got, "distant") || strings.Count(got, "<mark>") != 1 || !strings.HasSuffix(got, "...") {
		t.Fatalf("distant match escaped the context limit: %q", got)
	}
}

func TestAttributeViewSearchCompactFieldLimit(t *testing.T) {
	attrView := &av.AttributeView{Name: "DB"}
	var marked strings.Builder
	marked.WriteString("DB")
	for _, field := range []string{"one", "two", "three", "four", "five", "six", "seven", "eight"} {
		attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: &av.Key{Name: field, Type: av.KeyTypeText}, Values: []*av.Value{attributeViewSearchTestText("match")}})
		marked.WriteString(" " + field + " <mark>match</mark>")
	}
	got := compactAttributeViewSearchContent(attrView, marked.String())
	if strings.Count(got, `class="fn__code"`) != 6 || strings.Contains(got, "seven") || strings.Contains(got, "eight") {
		t.Fatalf("unexpected field limit: %q", got)
	}
}

func attributeViewSearchTestFixture() *av.AttributeView {
	return &av.AttributeView{
		Name:  "Contacts",
		Views: []*av.View{{Name: "All people"}},
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{Name: "Title", Type: av.KeyTypeBlock}, Values: []*av.Value{
				{Type: av.KeyTypeBlock, BlockID: "row-a", Block: &av.ValueBlock{Content: "Project Apollo"}},
				{Type: av.KeyTypeBlock, BlockID: "row-b", Block: &av.ValueBlock{Content: "Project Borealis"}},
			}},
			{Key: &av.Key{Name: "Status", Type: av.KeyTypeText}, Values: []*av.Value{
				{Type: av.KeyTypeText, BlockID: "row-a", Text: &av.ValueText{Content: "cat"}},
				nil,
				{Type: av.KeyTypeText, BlockID: "row-b", Text: &av.ValueText{Content: "concatenate"}},
			}},
		},
	}
}

func attributeViewSearchTestText(content string) *av.Value {
	return &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: content}}
}
