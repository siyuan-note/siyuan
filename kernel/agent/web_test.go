package agent

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestWebToolProviderConfirmation(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())
	for _, name := range []string{"web_search", "web_fetch"} {
		if needsConfirm(name, "", nil) || needsLocalSnapshot(name, "") {
			t.Fatal("legacy web provider confirmation changed")
		}
	}
	model.Conf.AI.Load().Web.SearchProvider = "deepseek"
	if !needsConfirm("web_search", "", nil) || needsConfirm("web_fetch", "", nil) {
		t.Fatal("search confirmation did not follow independent provider selection")
	}
	model.Conf.AI.Load().Web.FetchProvider = "deepseek"
	if !needsConfirm("web_fetch", "", nil) || needsLocalSnapshot("web_fetch", "") || needsLocalSnapshot("web_search", "") {
		t.Fatal("paid external web calls need confirmation without a local snapshot")
	}
	if needsConfirm("web_search", "", map[string]bool{"*": true}) {
		t.Fatal("existing explicit approval was ignored")
	}
}
