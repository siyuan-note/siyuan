package util

import "testing"

func TestNormalizeStatusBarDefaults(t *testing.T) {
	desktop := NormalizeStatusBar(nil, false)
	if desktop.Version != StatusBarVersion || desktop.MsgTaskDatabaseIndexCommitDisabled ||
		desktop.MsgTaskHistoryDatabaseIndexCommitDisabled || desktop.MsgTaskAssetDatabaseIndexCommitDisabled {
		t.Fatalf("unexpected desktop status bar defaults: %#v", desktop)
	}

	mobile := NormalizeStatusBar(&StatusBar{}, true)
	if mobile.Version != StatusBarVersion || !mobile.MsgTaskDatabaseIndexCommitDisabled ||
		!mobile.MsgTaskHistoryDatabaseIndexCommitDisabled || !mobile.MsgTaskAssetDatabaseIndexCommitDisabled {
		t.Fatalf("unexpected mobile status bar defaults: %#v", mobile)
	}

	mobile.MsgTaskAssetDatabaseIndexCommitDisabled = false
	mobile = NormalizeStatusBar(mobile, true)
	if mobile.MsgTaskAssetDatabaseIndexCommitDisabled {
		t.Fatal("normalized status bar settings should preserve user changes")
	}
}

func TestNewNotificationsEnablesFormatPainterTip(t *testing.T) {
	notifications := NewNotifications()
	if nil == notifications.FormatPainterTip || !*notifications.FormatPainterTip {
		t.Fatal("format painter notifications should be enabled by default")
	}
}
