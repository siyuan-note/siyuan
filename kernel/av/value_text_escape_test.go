package av

import (
	"testing"

	"github.com/88250/lute/html"
)

func TestValueTextRichEscapedContentRoundTrip(t *testing.T) {
	for _, mark := range []string{"em", "strong", "s", "mark", "sup", "sub", "u", "code", "kbd", "text", "a em"} {
		t.Run(mark, func(t *testing.T) {
			const content = `<vitae> & &lt; "quote"`
			value := &ValueText{Rich: &ValueTextRich{
				Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown,
				Content: `<span data-type="` + mark + `" data-href="https://example.com">` + html.EscapeHTMLStr(content) + `</span>`,
			}}
			for i := 0; i < 3; i++ {
				if err := value.NormalizeRichContent(); err != nil {
					t.Fatal(err)
				}
				if value.Content != content {
					t.Fatalf("round %d: want %q, got %q, source %q", i, content, value.Content, value.Rich.Content)
				}
			}
		})
	}
	value := &ValueText{Rich: &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: "*<vitae>*"}}
	if err := value.NormalizeRichContent(); err != nil || value.Content != "<vitae>" {
		t.Fatalf("Markdown content lost: %q, %v", value.Content, err)
	}
}
