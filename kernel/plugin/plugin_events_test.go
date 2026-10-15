// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"errors"
	"fmt"
	"testing"

	"github.com/asaskevich/EventBus"
)

type panicEventBus struct {
	EventBus.Bus
	topic string
	value any
}

func (b *panicEventBus) Subscribe(topic string, _ any) error {
	if topic == b.topic {
		panic(b.value)
	}
	return nil
}

func (b *panicEventBus) Unsubscribe(topic string, _ any) error {
	if topic == b.topic {
		panic(b.value)
	}
	return nil
}

func TestPluginEventHandlersRecoverPanicValues(t *testing.T) {
	for _, operation := range []struct {
		name string
		call func(*KernelPlugin) error
	}{
		{"subscribe", (*KernelPlugin).subscribeEventHandlers},
		{"unsubscribe", (*KernelPlugin).unsubscribeEventHandlers},
	} {
		for _, topic := range []string{EventBusTopicRuntime, EventBusTopicPlugin} {
			for _, value := range []any{errors.New("event bus failure"), "event bus panic", 42, struct{ Reason string }{"failure"}} {
				t.Run(fmt.Sprintf("%s/%s/%T", operation.name, topic, value), func(t *testing.T) {
					defer func() {
						if recovered := recover(); recovered != nil {
							t.Fatalf("event handler recovery panicked: %v", recovered)
						}
					}()
					p := &KernelPlugin{bus: &panicEventBus{topic: topic, value: value}}
					err := operation.call(p)
					if err == nil || err.Error() != fmt.Sprint(value) {
						t.Fatalf("got %v, want panic value %v", err, value)
					}
					if original, ok := value.(error); ok && err != original {
						t.Fatalf("original error identity was lost: %v", err)
					}
				})
			}
		}
	}
}

func TestPluginEventHandlersLifecycle(t *testing.T) {
	p := &KernelPlugin{bus: EventBus.New()}
	if err := p.subscribeEventHandlers(); err != nil {
		t.Fatal(err)
	}
	for _, topic := range []string{EventBusTopicRuntime, EventBusTopicPlugin} {
		if !p.bus.HasCallback(topic) {
			t.Fatalf("missing subscription: %s", topic)
		}
	}
	if err := p.unsubscribeEventHandlers(); err != nil {
		t.Fatal(err)
	}
	for _, topic := range []string{EventBusTopicRuntime, EventBusTopicPlugin} {
		if p.bus.HasCallback(topic) {
			t.Fatalf("subscription remains: %s", topic)
		}
	}
	if err := p.unsubscribeEventHandlers(); err == nil {
		t.Fatal("missing subscription error was lost")
	}
}
