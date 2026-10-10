package tools

import (
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRepoCheckoutFailure(t *testing.T) {
	previousConf := model.Conf
	previousLangs := util.Langs
	previousReadOnly := util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.Repo = &conf.Repo{}
	model.Conf.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {26: "repository key is not configured"}}
	util.ReadOnly = false
	t.Cleanup(func() {
		model.Conf, util.Langs, util.ReadOnly = previousConf, previousLangs, previousReadOnly
	})
	result, err := repoHandler(map[string]any{"action": "checkout", "id": "missing-snapshot"})
	if err != nil || !result.IsError {
		t.Fatalf("failed checkout must be a tool error: %+v, %v", result, err)
	}
	text := probeText(result)
	if !strings.Contains(text, "repository key is not configured") || strings.Contains(text, "checkout to snapshot:") {
		t.Fatalf("failed checkout must return its cause without success text: %s", text)
	}
}
