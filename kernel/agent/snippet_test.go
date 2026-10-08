package agent

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func TestSnippetWritesAlwaysRequireExplicitConfirmation(t *testing.T) {
	previous := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = conf.NewAI()
	t.Cleanup(func() { kernelModel.Conf = previous })
	registration := &capabilityRegistration{ID: "native/backend/snippet", ModelName: "snippet", Source: "native", Runtime: "kernel", Tool: tools.SnippetTool}
	kernelModel.Conf.AI.Agent.ApprovalPolicy.Overrides[registration.ID] = &conf.CapabilityApproval{Default: conf.ApprovalDecisionAllow}
	for _, action := range []string{"create", "update", "enable", "disable", "remove"} {
		for _, session := range []bool{false, true} {
			required, forced := capabilityConfirmRequirement(registration, action, nil, session, map[string]bool{"*": true})
			if !required || !forced {
				t.Fatalf("%s escaped confirmation (session=%v)", action, session)
			}
		}
	}
	for _, action := range []string{"list", "get"} {
		if needsCapabilityConfirm(registration, action, nil, false, nil) {
			t.Fatalf("read %s unexpectedly requires confirmation", action)
		}
	}
}
