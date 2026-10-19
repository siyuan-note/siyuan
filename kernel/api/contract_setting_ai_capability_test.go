package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestAPIContractSettingAICapabilityOverrideClear 验证能力开关的提交协议：前端只提交改动的条目，
// 补丁合并保留其他覆盖项，恢复默认时写入的空决策由规范化清除。
func TestAPIContractSettingAICapabilityOverrideClear(t *testing.T) {
	previousConf, previousReadOnly, previousConfDir := model.Conf, util.ReadOnly, util.ConfDir
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.ConfDir = previousConf, previousReadOnly, previousConfDir })
	util.ReadOnly, util.ConfDir = true, t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())

	const id, otherID = "native/backend/asset", "native/backend/block"
	patch := func(body string) {
		t.Helper()
		code, message, _ := settingContractRequest(t, "patch", patchSetting, body)
		if code != 0 {
			t.Fatalf("capability patch failed: %d %s", code, message)
		}
	}
	policy := func() *conf.CapabilityPolicy { return model.Conf.AI.Load().Agent.CapabilityPolicy }

	patch(`{"ai":{"agent":{"capabilityPolicy":{"overrides":{"` + id + `":"deny"}}}}}`)
	patch(`{"ai":{"agent":{"capabilityPolicy":{"overrides":{"` + otherID + `":"deny"}}}}}`)
	if policy().Allows(id) || policy().Allows(otherID) {
		t.Fatal("partial patches must disable both capabilities and preserve each other")
	}

	patch(`{"ai":{"agent":{"capabilityPolicy":{"overrides":{"` + id + `":""}}}}}`)
	if !policy().Allows(id) {
		t.Fatal("empty decision did not restore the capability")
	}
	if policy().Allows(otherID) {
		t.Fatal("restoring one capability must not clear another override")
	}
	if policy().Default != "allow" {
		t.Fatalf("partial patch must keep the policy default: %s", policy().Default)
	}
	if _, exists := policy().Overrides[id]; exists {
		t.Fatal("cleared override must be removed from the stored policy")
	}
}
