package apicontract

import (
	"strings"
	"testing"
)

func TestAISkillManagementContract(t *testing.T) {
	for _, body := range []string{``, `{}`, `{"action":null}`, `{"action":false}`, `{"action":"read","path":null}`, `{"action":"write","content":123}`, `{"action":"remove","revision":false}`} {
		if _, err := AIManageSkills.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid request %s", body)
		}
	}
	for _, body := range []string{`{"action":"list"}`, `{"action":"write","path":"skill/a.md","content":"","revision":""}`, `{"action":"move","path":"a","target":"b","revision":"hash"}`} {
		if _, err := AIManageSkills.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("rejected valid request %s: %v", body, err)
		}
	}
}
