package util

import "testing"

func TestNewNotificationsEnablesFormatPainterTip(t *testing.T) {
	notifications := NewNotifications()
	if nil == notifications.FormatPainterTip || !*notifications.FormatPainterTip {
		t.Fatal("format painter notifications should be enabled by default")
	}
}
