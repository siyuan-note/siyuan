package util

import (
	"strings"
	"testing"
)

func TestHasUnclosedHTMLVoidElements(t *testing.T) {
	for _, tag := range []string{"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"} {
		t.Run(tag, func(t *testing.T) {
			for _, value := range []string{"<" + tag + ">", "<" + tag + ` data-value="x">`, "<" + strings.ToUpper(tag) + ">", "<div><" + tag + "></div>"} {
				if HasUnclosedHtmlTag(value) {
					t.Errorf("void element was treated as unclosed: %s", value)
				}
			}
		})
	}
	for _, value := range []string{`<table><colgroup><col span="2"></colgroup><tr><td>text</td></tr></table>`, `<video><source src="video.mp4"><track src="captions.vtt"></video>`, "<div><!-- <col> --><wbr></div>"} {
		if HasUnclosedHtmlTag(value) {
			t.Errorf("balanced markup was treated as unclosed: %s", value)
		}
	}
	for _, value := range []string{"<div><wbr>", "<div><span></div>", "<div><!-- unclosed"} {
		if !HasUnclosedHtmlTag(value) {
			t.Errorf("unclosed markup was accepted: %s", value)
		}
	}
}
