// Windows systray host for Ankara Yazılım Connector.
package main

import (
	"bytes"
	"crypto/tls"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/getlantern/systray"
)

//go:embed ankara-yazilim.ico
var iconData []byte

var (
	version = "1.1.6"
	build   = "dev"
)

const statusPort = 4781

type healthPayload struct {
	Paired        bool   `json:"paired"`
	DeviceID      string `json:"deviceId"`
	Label         string `json:"label"`
	TenantName    string `json:"tenantName"`
	TLS           bool   `json:"tls"`
	CertTrusted   bool   `json:"certTrusted"`
	Version       string `json:"version"`
	SessionPaused bool   `json:"sessionPaused"`
	PendingUpdate *struct {
		Version  string `json:"version"`
		Filename string `json:"filename"`
	} `json:"pendingUpdate"`
}

var (
	coreMu   sync.Mutex
	coreProc *exec.Cmd
)

func httpClient() *http.Client {
	return &http.Client{
		Timeout: 3 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // localhost self-signed
		},
	}
}

func fetchHealth() (*healthPayload, string, error) {
	client := httpClient()
	for _, scheme := range []string{"https", "http"} {
		url := fmt.Sprintf("%s://127.0.0.1:%d/health", scheme, statusPort)
		res, err := client.Get(url)
		if err != nil {
			continue
		}
		defer res.Body.Close()
		var h healthPayload
		if json.NewDecoder(res.Body).Decode(&h) == nil {
			return &h, scheme, nil
		}
	}
	return nil, "https", fmt.Errorf("health unreachable")
}

func statusBaseURL() string {
	_, scheme, err := fetchHealth()
	if err != nil {
		return fmt.Sprintf("https://127.0.0.1:%d/", statusPort)
	}
	return fmt.Sprintf("%s://127.0.0.1:%d/", scheme, statusPort)
}

func statusPath(path string) string {
	base := strings.TrimRight(statusBaseURL(), "/")
	return base + "/" + strings.TrimLeft(path, "/")
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
	mTrust := systray.AddMenuItem("Yerel sertifikayı güven…", "Panel için yerel TLS sertifikasını onayla")
	mLogin := systray.AddMenuItem("Oturum aç…", "Panelde oturum aç")
	mUpdate := systray.AddMenuItem("Güncellemeyi uygula…", "Bekleyen güncellemeyi kur")
	mUpdate.Hide()
	mAbout := systray.AddMenuItem("Hakkında…", "Sürüm bilgisi")
	mPrivacy := systray.AddMenuItem("Gizlilik politikası…", "Web sitesinde aç")
	mKvkk := systray.AddMenuItem("KVKK aydınlatma…", "Web sitesinde aç")
	systray.AddSeparator()
	mLogout := systray.AddMenuItem("Oturumu Kapat", "Yerel oturumu sıfırla")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Çıkış", "Connector'ı kapat")

	go pollHealth(mUpdate, mLogin, mLogout)
	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openBrowser(statusBaseURL())
			case <-mTrust.ClickedCh:
				openBrowser(statusPath("trust-cert"))
			case <-mLogin.ClickedCh:
				doLogin()
			case <-mUpdate.ClickedCh:
				doApplyUpdate()
			case <-mAbout.ClickedCh:
				showAbout()
			case <-mPrivacy.ClickedCh:
				openBrowser("https://ankarayazilim.org/gizlilik/")
			case <-mKvkk.ClickedCh:
				openBrowser("https://ankarayazilim.org/kvkk/")
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
	killAllCore()
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

func killAllCore() {
	coreMu.Lock()
	if coreProc != nil && coreProc.Process != nil {
		_ = coreProc.Process.Kill()
		_ = coreProc.Wait()
		coreProc = nil
	}
	coreMu.Unlock()
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill", "/F", "/IM", "ankara-connector-core.exe", "/T").Run()
	}
}

func postJSON(path string) (map[string]interface{}, int, error) {
	client := httpClient()
	url := statusPath(path)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader([]byte("{}")))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	var out map[string]interface{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out, res.StatusCode, nil
}

func doLogout() {
	_, _, _ = postJSON("session/logout")
	killAllCore()
	time.Sleep(300 * time.Millisecond)
	_ = startCore()
	updateTooltip()
}

func doLogin() {
	_, status, err := postJSON("session/login")
	if err != nil {
		openBrowser(statusPath(""))
		return
	}
	if status >= 400 {
		openBrowser(statusPath(""))
	}
	updateTooltip()
}

func doApplyUpdate() {
	_, _, _ = postJSON("update/apply")
}

func pollHealth(mUpdate, mLogin, mLogout *systray.MenuItem) {
	ticker := time.NewTicker(12 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		h, _, err := fetchHealth()
		if err != nil {
			mUpdate.Hide()
			continue
		}
		if h.PendingUpdate != nil && h.PendingUpdate.Version != "" {
			mUpdate.SetTitle(fmt.Sprintf("Güncellemeyi uygula… (v%s)", h.PendingUpdate.Version))
			mUpdate.Show()
		} else {
			mUpdate.Hide()
		}
		if h.Paired {
			mLogin.Disable()
			mLogout.Enable()
		} else {
			mLogin.Enable()
			mLogout.Disable()
		}
		updateTooltip()
	}
}

func updateTooltip() {
	h, _, err := fetchHealth()
	if err != nil {
		systray.SetTooltip("Ankara Yazılım Connector — başlatılıyor…")
		return
	}
	if h.Paired {
		label := h.TenantName
		if label == "" {
			label = h.Label
		}
		if label == "" {
			label = h.DeviceID
		}
		systray.SetTooltip(fmt.Sprintf("Ankara Yazılım Connector — Bağlı (%s)", label))
		return
	}
	if h.SessionPaused {
		systray.SetTooltip("Ankara Yazılım Connector — Oturum kapalı")
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
	coreVer := "—"
	if h, _, err := fetchHealth(); err == nil && h.Version != "" {
		coreVer = h.Version
	}
	body := fmt.Sprintf(
		"Ankara Yazılım Connector\r\n\r\nTray sürümü: %s (%s)\r\nÇekirdek sürümü: %s\r\nİşletim sistemi: %s/%s\r\n\r\nFiziksel donanımı Ankara Yazılım paneli ile köprüler.\r\nTüm ayarlar web panelden yapılır.\r\n\r\nhttps://ankarayazilim.org/indir",
		version,
		build,
		coreVer,
		runtime.GOOS,
		runtime.GOARCH,
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
