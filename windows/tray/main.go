// Windows systray host for Ankara Yazılım Connector.
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/getlantern/systray"
)

//go:embed ankara-yazilim.ico
var iconData []byte

const (
	version    = "1.1.2"
	statusPort = 4781
	statusURL  = "http://127.0.0.1:4781/"
)

var (
	coreMu   sync.Mutex
	coreProc *exec.Cmd
)

type healthPayload struct {
	Paired   bool   `json:"paired"`
	DeviceID string `json:"deviceId"`
	Label    string `json:"label"`
}

func main() {
	systray.Run(onReady, onExit)
}

func onReady() {
	systray.SetIcon(iconData)
	systray.SetTitle("Ankara Yazılım Connector")
	updateTooltip()

	if err := startCore(); err != nil {
		systray.SetTooltip(fmt.Sprintf("Ankara Yazılım Connector — hata: %v", err))
	}

	mOpen := systray.AddMenuItem("Durumu Aç", "Tarayıcıda durum sayfasını aç")
	mAbout := systray.AddMenuItem("Hakkında…", "Sürüm bilgisi")
	systray.AddSeparator()
	mLogout := systray.AddMenuItem("Oturumu Kapat", "Yerel oturumu sıfırla")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Çıkış", "Connector'ı kapat")

	go pollHealth()
	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openBrowser(statusURL)
			case <-mAbout.ClickedCh:
				showAbout()
			case <-mLogout.ClickedCh:
				doLogout()
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func onExit() {
	stopCore()
}

func installDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func coreExe() string {
	return filepath.Join(installDir(), "ankara-connector-core.exe")
}

func startCore() error {
	coreMu.Lock()
	defer coreMu.Unlock()
	if coreProc != nil && coreProc.Process != nil {
		return nil
	}
	path := coreExe()
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("çekirdek bulunamadı (%s)", path)
	}
	cmd := exec.Command(path, "run")
	cmd.Dir = installDir()
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	}
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
	 return err
	}
	coreProc = cmd
	go pipeLogs(stdout)
	go pipeLogs(stderr)
	go func() {
		_ = cmd.Wait()
		coreMu.Lock()
		coreProc = nil
		coreMu.Unlock()
	}()
	return nil
}

func pipeLogs(r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			fmt.Fprint(os.Stderr, string(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

func stopCore() {
	coreMu.Lock()
	defer coreMu.Unlock()
	if coreProc == nil || coreProc.Process == nil {
		return
	}
	_ = coreProc.Process.Kill()
	_ = coreProc.Wait()
	coreProc = nil
}

func doLogout() {
	stopCore()
	path := coreExe()
	if _, err := os.Stat(path); err == nil {
		cmd := exec.Command(path, "logout")
		cmd.Dir = installDir()
		if runtime.GOOS == "windows" {
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		}
		_ = cmd.Run()
	}
	_ = startCore()
	updateTooltip()
}

func pollHealth() {
	ticker := time.NewTicker(12 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		updateTooltip()
	}
}

func updateTooltip() {
	client := http.Client{Timeout: 2 * time.Second}
	res, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", statusPort))
	if err != nil {
		systray.SetTooltip("Ankara Yazılım Connector — başlatılıyor…")
		return
	}
	defer res.Body.Close()
	var h healthPayload
	if err := json.NewDecoder(res.Body).Decode(&h); err != nil {
		systray.SetTooltip("Ankara Yazılım Connector")
		return
	}
	if h.Paired {
		label := h.Label
		if label == "" {
			label = h.DeviceID
		}
		systray.SetTooltip(fmt.Sprintf("Ankara Yazılım Connector — Bağlı (%s)", label))
		return
	}
	systray.SetTooltip("Ankara Yazılım Connector — Oturum bekleniyor")
}

func openBrowser(url string) {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		_ = cmd.Start()
	}
}

func showAbout() {
	body := fmt.Sprintf(
		"Ankara Yazılım Connector %s\r\n\r\nFiziksel donanımı Ankara Yazılım paneli ile köprüler.\r\nTüm ayarlar web panelden yapılır.\r\n\r\nhttps://ankarayazilim.org/indir",
		version,
	)
	if runtime.GOOS == "windows" {
		title, _ := syscall.UTF16PtrFromString("Ankara Yazılım Connector")
		text, _ := syscall.UTF16PtrFromString(body)
		user32 := syscall.NewLazyDLL("user32.dll")
		messageBoxW := user32.NewProc("MessageBoxW")
		const mbOK = 0
		const mbIconInformation = 0x40
		messageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbOK|mbIconInformation)
	}
}
