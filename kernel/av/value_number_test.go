package av

import "testing"

func TestFormattedValueNumberPrecision(t *testing.T) {
	for _, test := range []struct {
		name    string
		content float64
		format  NumberFormat
		want    string
	}{
		{"decimal", 1.2345678, NumberFormatNone, "1.2345678"},
		{"sum", 1.2345678 + 2.3456789, NumberFormatNone, "3.5802467"},
		{"small positive", 0.000001, NumberFormatNone, "0.000001"},
		{"small negative", -0.000001, NumberFormatNone, "-0.000001"},
		{"zero", 0, NumberFormatNone, "0"},
		{"integer", 42, NumberFormatNone, "42"},
		{"commas", 1234.5, NumberFormatCommas, "1,234.5"},
		{"percent", 0.12345678, NumberFormatPercent, "12.35%"},
		{"currency", 1234.5678, NumberFormatUSD, "$1,234.57"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := NewFormattedValueNumber(test.content, test.format)
			if result.FormattedContent != test.want {
				t.Errorf("formatted content = %q, want %q", result.FormattedContent, test.want)
			}
			cell := &ValueNumber{Content: test.content, Format: test.format, IsNotEmpty: true}
			cell.FormatNumber()
			if result.FormattedContent != cell.FormattedContent {
				t.Errorf("calculation = %q, cell = %q", result.FormattedContent, cell.FormattedContent)
			}
			if result.Content != test.content || result.Format != test.format || !result.IsNotEmpty {
				t.Errorf("unexpected number metadata: %+v", result)
			}
		})
	}
}
