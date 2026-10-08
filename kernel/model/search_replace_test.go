package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFindReplaceRejectsUnsupportedMethods(t *testing.T) {
	previousConf, previousLangs := Conf, util.Langs
	Conf = NewAppConf()
	Conf.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {132: "unsupported replacement"}}
	t.Cleanup(func() { Conf, util.Langs = previousConf, previousLangs })
	for _, method := range []int{2, 4} {
		for _, ids := range [][]string{nil, {"20261008120000-abcdefg"}} {
			for _, boxID := range []string{"", "20261008120000-box0001"} {
				if err := FindReplaceInBox("same", "same", nil, ids, nil, nil, nil, nil, method, boxID); err == nil || err.Error() != Conf.Language(132) {
					t.Fatalf("method %d, ids %v, box %q: expected unsupported replacement, got %v", method, ids, boxID, err)
				}
			}
		}
	}
	for _, method := range []int{0, 1, 3} {
		if err := FindReplace("same", "same", nil, nil, nil, nil, nil, nil, method, 0, 0); err != nil {
			t.Fatalf("method %d: unchanged replacement must remain a no-op: %v", method, err)
		}
	}
}
