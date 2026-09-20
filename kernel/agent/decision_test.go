package agent

import (
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func TestDecisionCapabilityAvailabilityAndApproval(t *testing.T) {
	original := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = conf.NewAI()
	t.Cleanup(func() { kernelModel.Conf = original })
	check := func(want bool) *capabilitySet {
		t.Helper()
		set, err := buildCapabilitySet(nil, capabilityAccessContext{})
		if err != nil {
			t.Fatal(err)
		}
		if (set.registration("decision") != nil) != want {
			t.Fatalf("decision exposure, want %v", want)
		}
		if strings.Contains(buildSystemPrompt("en", set), "## Decision model") != want {
			t.Fatal("decision prompt did not follow capability exposure")
		}
		return set
	}
	check(false)
	kernelModel.Conf.AI.Decision.Enabled = true
	check(false)
	kernelModel.Conf.AI.Decision.APIKey = "key"
	set := check(true)
	registration := set.registration("decision")
	if !tools.DecisionTool.AgentOnly || !needsCapabilityConfirm(registration, "evaluate", nil, false, nil) {
		t.Fatal("decision bypassed data egress/cost confirmation")
	}
	kernelModel.Conf.AI.Decision.Enabled = false
	if capabilityStillExecutable(registration, nil) {
		t.Fatal("disabled decision remained executable")
	}
	check(false)
	kernelModel.Conf.AI.Decision.Enabled = true
	kernelModel.Conf.AI.Agent.CapabilityPolicy.Overrides["native/backend/decision"] = "deny"
	check(false)
	if capabilityStillExecutable(registration, nil) {
		t.Fatal("denied decision remained executable")
	}
}
