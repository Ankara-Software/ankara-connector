//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

// applyHideWindow hides the console window for child processes on Windows.
func applyHideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func openBrowser(url string) {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
}

func showAboutDialog(body string) {
	title, _ := syscall.UTF16PtrFromString("Ankara Yazılım Connector")
	text, _ := syscall.UTF16PtrFromString(body)
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBoxW := user32.NewProc("MessageBoxW")
	const mbOK = 0
	const mbIconInformation = 0x40
	messageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbOK|mbIconInformation)
}
