package util

import "testing"

type countedBroadcastData struct{ count int }

func (data *countedBroadcastData) MarshalJSON() ([]byte, error) {
	data.count++
	return []byte(`{"id":"shared"}`), nil
}

func TestBroadcastSerializesOnceAndPreservesScope(t *testing.T) {
	for _, mode := range []string{"all", "exclude", "app", "absent"} {
		t.Run(mode, func(t *testing.T) {
			hub := newNotificationTestHub(t)
			data := &countedBroadcastData{}
			switch mode {
			case "all":
				BroadcastByType("main", "shared", 0, "", data)
			case "exclude":
				BroadcastByTypeAndExcludeApp(hub.first, "main", "shared", 0, "", data)
			case "app":
				BroadcastByTypeAndApp("main", hub.first, "shared", 0, "", data)
			case "absent":
				BroadcastByType("absent", "shared", 0, "", data)
			}
			wantCount := 1
			if mode == "absent" {
				wantCount = 0
			}
			if data.count != wantCount {
				t.Fatalf("serialized %d times, want %d", data.count, wantCount)
			}
			for i, events := range hub.readEvents(t) {
				want := mode == "all" && i < 2 || mode == "exclude" && i == 1 || mode == "app" && i == 0
				if want {
					if len(events) != 1 || events[0].Cmd != "shared" || events[0].Data.ID != "shared" {
						t.Fatalf("client %d received %+v", i, events)
					}
				} else if len(events) != 0 {
					t.Fatalf("excluded client %d received %+v", i, events)
				}
			}
		})
	}
}
