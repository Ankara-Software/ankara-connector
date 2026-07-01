//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

// applyHideWindow is a no-op on non-Windows (no console window to hide).
func applyHideWindow(cmd *exec.Cmd) {}

func openBrowser(url string) {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", url)
	default:
		// Linux/BSD: try xdg-open, fall back to sensible-browser.
		c = exec.Command("xdg-open", url)
	}
	_ = c.Start()
}

// showAboutDialog prints the about text to the terminal on Unix; a GUI dialog
// would require a toolkit dependency. The tray menu item still works.
func showAboutDialog(body string) {
	fmt.Println(body)
}
