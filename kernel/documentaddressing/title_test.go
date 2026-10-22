package documentaddressing

import (
	"errors"
	"strings"
	"testing"
)

func TestLegacyTitlePropertiesPreserveUnknownSources(t *testing.T) {
	for _, source := range []string{
		`{"title":{"format":"future","content":"private"}}`,
		`{"title":["private"]}`,
		`{"title":42,"title":"ordinary"}`,
		`{"title":false}`,
		`{"title":"ordinary"} {}`,
	} {
		if err := CheckLegacyTitleProperties([]byte(source)); !errors.Is(err, ErrInvalidTitle) || strings.Contains(err.Error(), "private") {
			t.Fatalf("unknown title was accepted or exposed: %v", err)
		}
	}
	for _, source := range []string{
		`{"title":null}`, `null`, `{}`, `{"title":"ordinary","other":"A/B"}`,
		`{"title":"A&amp;#47;B"}`, `{"title":"A%2FB／C **literal**"}`,
	} {
		if err := CheckLegacyTitleProperties([]byte(source)); err != nil {
			t.Fatal("legacy title semantics changed", err)
		}
	}
}
