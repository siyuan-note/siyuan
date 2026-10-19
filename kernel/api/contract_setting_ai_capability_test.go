package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestAPIContractSettingAICapabilityOverrideClear 验证能力开关的恢复协议：设置补丁不会删除省略的字典键，
// 前端以空决策提交被删除的覆盖项，由内核规范化移除。
func TestAPIContractSettingAICapabilityOverrideClear(t *testing.T) {
	previousConf, previousReadOnly, previousConfDir := model.Conf, util.ReadOnly, util.ConfDir
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.ConfDir = previousConf, previousReadOnly, previousConfDir })
	util.ReadOnly, util.ConfDir = true, t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())

	const id = "native/backend/asset"
	patch := func(body string) {
		t.Helper()
		code, message, _ := settingContractRequest(t, "patch", patchSetting, body)
		if code != 0 {
			t.Fatalf("capability patch failed: %d %s", code, message)
		}
	}
	policy := func() *conf.CapabilityPolicy { return model.Conf.AI.Load().Agent.CapabilityPolicy }

	patch(`{"ai":{"agent":{"capabilityPolicy":{"default":"allow","overrides":{"` + id + `":"deny"}}}}}`)
	if policy().Allows(id) {
		t.Fatal("capability was not disabled")
	}

	// 补丁按对象递归合并，省略该键不会移除已有覆盖项，因此不能靠省略条目恢复能力。
	patch(`{"ai":{"agent":{"capabilityPolicy":{"default":"allow","overrides":{}}}}}`)
	if policy().Allows(id) {
		t.Fatal("omitted overrides must not be removed by the patch merge")
	}

	patch(`{"ai":{"agent":{"capabilityPolicy":{"default":"allow","overrides":{"` + id + `":""}}}}}`)
	if !policy().Allows(id) {
		t.Fatal("empty decision did not restore the capability")
	}
	if _, exists := policy().Overrides[id]; exists {
		t.Fatal("cleared override must be removed from the stored policy")
	}
}
