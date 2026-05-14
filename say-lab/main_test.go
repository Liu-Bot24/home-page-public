package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestChooseProviderPrefersGoogleChirpThenFallsBackToWaveNet(t *testing.T) {
	usage := &UsageStore{Data: map[string]map[string]int{}}
	cfg := Config{TTS: TTSConfig{
		AutoOrder: []string{"google_chirp", "google_wavenet"},
		MonthlyLimits: map[string]int{
			"google_chirp":   10,
			"google_wavenet": 100,
		},
		GoogleRelay: GoogleRelayTTS{
			Endpoint:    "https://relay.example/v1/tts",
			RelaySecret: "secret",
		},
	}}
	app := &App{cfg: cfg, usage: usage}

	chosen, err := app.chooseProvider("auto", 5)
	if err != nil {
		t.Fatalf("chooseProvider returned error: %v", err)
	}
	if chosen != "google_chirp" {
		t.Fatalf("expected google_chirp, got %s", chosen)
	}

	month := usage.Month()
	usage.Data["google_chirp"] = map[string]int{month: 9}
	chosen, err = app.chooseProvider("auto", 2)
	if err != nil {
		t.Fatalf("chooseProvider fallback returned error: %v", err)
	}
	if chosen != "google_wavenet" {
		t.Fatalf("expected google_wavenet fallback, got %s", chosen)
	}
}

func TestChooseProviderAutoFallsBackToConfiguredCustom(t *testing.T) {
	app := &App{
		cfg: Config{TTS: TTSConfig{
			AutoOrder: []string{"google_chirp", "google_wavenet"},
			Custom: CustomTTS{
				BaseURL: "https://tts.example.com/v1",
				APIKey:  "custom-key",
				Model:   "tts-model",
				Voice:   "tts-voice",
			},
		}},
		usage: &UsageStore{Data: map[string]map[string]int{}},
	}

	chosen, err := app.chooseProvider("auto", 5)
	if err != nil {
		t.Fatalf("chooseProvider returned error: %v", err)
	}
	if chosen != "custom" {
		t.Fatalf("expected custom fallback, got %s", chosen)
	}
}

func TestHandleTTSAutoFallsBackToConfiguredCustom(t *testing.T) {
	var sawCustomRequest bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audio/speech" {
			t.Fatalf("unexpected custom TTS path: %s", r.URL.Path)
		}
		sawCustomRequest = true
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("custom-audio"))
	}))
	defer server.Close()

	app := &App{
		cfg: Config{TTS: TTSConfig{
			DefaultProvider: "auto",
			AutoOrder:       []string{"google_chirp", "google_wavenet"},
			Custom: CustomTTS{
				BaseURL:        server.URL,
				APIKey:         "custom-key",
				Model:          "tts-model",
				Voice:          "tts-voice",
				ResponseFormat: "mp3",
				Speed:          1,
				Timeout:        5,
			},
		}},
		usage: &UsageStore{file: filepath.Join(t.TempDir(), "usage.json"), Data: map[string]map[string]int{}},
	}
	body := bytes.NewBufferString(`{"text":"hello","provider":"auto"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/tts", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	app.handleTTS(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code = %d body = %s", rec.Code, rec.Body.String())
	}
	if !sawCustomRequest {
		t.Fatal("custom TTS was not called")
	}
	if got := rec.Header().Get("X-Say-Provider"); got != "custom" {
		t.Fatalf("provider header = %q, want custom", got)
	}
	if rec.Body.String() != "custom-audio" {
		t.Fatalf("audio body = %q", rec.Body.String())
	}
}

func TestCurrentProviderStatusUsesConfiguredCustomFallback(t *testing.T) {
	app := &App{
		cfg: Config{TTS: TTSConfig{
			AutoOrder: []string{"google_chirp", "google_wavenet"},
			Labels:    map[string]string{"custom": "SiliconFlow TTS"},
			Custom: CustomTTS{
				BaseURL: "https://tts.example.com/v1",
				APIKey:  "custom-key",
				Model:   "tts-model",
				Voice:   "tts-voice",
			},
		}},
		usage: &UsageStore{Data: map[string]map[string]int{}},
	}

	current := app.currentProviderStatus(app.ttsProviders())
	provider, ok := current.(struct {
		Name       string `json:"name"`
		Label      string `json:"label"`
		Configured bool   `json:"configured"`
		Used       int    `json:"used"`
		Limit      int    `json:"limit"`
	})
	if !ok {
		t.Fatalf("unexpected current provider type: %T", current)
	}
	if provider.Name != "custom" {
		t.Fatalf("expected custom current provider, got %s", provider.Name)
	}
}

func TestCallGoogleRelayTTSSignsRequestAndReturnsAudio(t *testing.T) {
	const secret = "relay-secret"
	var sawProvider string
	var sawLanguage string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/tts" {
			t.Fatalf("expected /v1/tts, got %s", r.URL.Path)
		}
		body := readAllForTest(t, r)
		ts := r.Header.Get("X-Say-Timestamp")
		if ts == "" {
			t.Fatal("missing X-Say-Timestamp")
		}
		if _, err := strconv.ParseInt(ts, 10, 64); err != nil {
			t.Fatalf("timestamp is not an int: %v", err)
		}
		expected := hmacHexForTest(secret, ts+"."+string(body))
		if got := r.Header.Get("X-Say-Signature"); got != expected {
			t.Fatalf("bad signature: got %s want %s", got, expected)
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("bad json payload: %v", err)
		}
		sawProvider, _ = payload["tier"].(string)
		sawLanguage, _ = payload["languageCode"].(string)
		if _, ok := payload["google"]; ok {
			t.Fatal("google config should not be sent to relay by default")
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("X-Say-Voice", "en-US-Chirp3-HD-Charon")
		_, _ = w.Write([]byte("mp3-bytes"))
	}))
	defer server.Close()

	app := &App{cfg: Config{TTS: TTSConfig{GoogleRelay: GoogleRelayTTS{
		Endpoint:    server.URL + "/v1/tts",
		RelaySecret: secret,
		Timeout:     5,
	}}}}
	audio, contentType, voice, err := app.callGoogleRelayTTS(ttsRequest{
		Text:     "hello",
		Language: "en-US",
		Speed:    0.9,
	}, "google_chirp")
	if err != nil {
		t.Fatalf("callGoogleRelayTTS returned error: %v", err)
	}
	if string(audio) != "mp3-bytes" {
		t.Fatalf("unexpected audio bytes: %q", string(audio))
	}
	if contentType != "audio/mpeg" {
		t.Fatalf("unexpected content type: %s", contentType)
	}
	if voice != "en-US-Chirp3-HD-Charon" {
		t.Fatalf("unexpected voice: %s", voice)
	}
	if sawProvider != "chirp3-hd" {
		t.Fatalf("expected chirp3-hd tier, got %s", sawProvider)
	}
	if sawLanguage != "en-US" {
		t.Fatalf("expected en-US language, got %s", sawLanguage)
	}
}

func TestCallGoogleRelayTTSPassesGoogleConfigWhenEnabled(t *testing.T) {
	const secret = "relay-secret"
	var sawGoogle map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := readAllForTest(t, r)
		ts := r.Header.Get("X-Say-Timestamp")
		expected := hmacHexForTest(secret, ts+"."+string(body))
		if got := r.Header.Get("X-Say-Signature"); got != expected {
			t.Fatalf("bad signature: got %s want %s", got, expected)
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("bad json payload: %v", err)
		}
		var ok bool
		sawGoogle, ok = payload["google"].(map[string]any)
		if !ok {
			t.Fatal("google config was not sent to relay")
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("mp3-bytes"))
	}))
	defer server.Close()

	app := &App{cfg: Config{TTS: TTSConfig{
		Google: GoogleTTS{
			ProjectID:    "project-demo",
			PrivateKeyID: "key-demo",
			ClientEmail:  "tts@example.iam.gserviceaccount.com",
			PrivateKey:   "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
			TokenURL:     "https://oauth2.example/token",
			TTSURL:       "https://tts.example/v1/text:synthesize",
		},
		GoogleRelay: GoogleRelayTTS{
			Endpoint:         server.URL + "/v1/tts",
			RelaySecret:      secret,
			PassGoogleConfig: true,
			Timeout:          5,
		},
	}}}
	if _, _, _, err := app.callGoogleRelayTTS(ttsRequest{Text: "hello", Language: "en-US"}, "google_chirp"); err != nil {
		t.Fatalf("callGoogleRelayTTS returned error: %v", err)
	}
	if sawGoogle["project_id"] != "project-demo" ||
		sawGoogle["private_key_id"] != "key-demo" ||
		sawGoogle["client_email"] != "tts@example.iam.gserviceaccount.com" ||
		sawGoogle["private_key"] == "" ||
		sawGoogle["token_url"] != "https://oauth2.example/token" ||
		sawGoogle["tts_url"] != "https://tts.example/v1/text:synthesize" {
		t.Fatalf("unexpected google payload: %+v", sawGoogle)
	}
}

func TestStatusShowsCurrentTTSOnlyAndOmitsBrowserAndTencent(t *testing.T) {
	app := &App{
		cfg: Config{TTS: TTSConfig{
			AutoOrder: []string{"google_chirp", "google_wavenet", "custom"},
			MonthlyLimits: map[string]int{
				"google_chirp": 800000,
			},
			Labels: map[string]string{
				"google_chirp": "Google Chirp 3 HD",
			},
			GoogleRelay: GoogleRelayTTS{
				Endpoint:    "https://relay.example/v1/tts",
				RelaySecret: "secret",
			},
		}},
		usage: &UsageStore{Data: map[string]map[string]int{}},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	rec := httptest.NewRecorder()

	app.handleStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code = %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "browser") || strings.Contains(body, "tencent") {
		t.Fatalf("status leaked removed providers: %s", body)
	}
	if strings.Contains(body, "siliconflow") {
		t.Fatalf("status leaked legacy provider name: %s", body)
	}
	var parsed struct {
		CurrentProvider struct {
			Name  string `json:"name"`
			Label string `json:"label"`
			Limit int    `json:"limit"`
		} `json:"current_provider"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("bad status json: %v", err)
	}
	if parsed.CurrentProvider.Name != "google_chirp" {
		t.Fatalf("current provider = %q", parsed.CurrentProvider.Name)
	}
	if parsed.CurrentProvider.Label != "Google Chirp 3 HD" {
		t.Fatalf("current provider label = %q", parsed.CurrentProvider.Label)
	}
	if parsed.CurrentProvider.Limit != 800000 {
		t.Fatalf("current provider limit = %d", parsed.CurrentProvider.Limit)
	}
}

func TestGuessTTSLanguageUsesHighConfidenceScriptDetection(t *testing.T) {
	tests := []struct {
		name string
		text string
		want string
	}{
		{name: "english fallback", text: "skill versus scale", want: "en-US"},
		{name: "mandarin", text: "你好，今天练习发音。", want: "cmn-CN"},
		{name: "japanese kana", text: "こんにちは、発音を練習します。", want: "ja-JP"},
		{name: "korean hangul", text: "안녕하세요 발음을 연습합니다", want: "ko-KR"},
		{name: "russian cyrillic", text: "Привет, я тренирую произношение.", want: "ru-RU"},
		{name: "arabic script", text: "مرحبا كيف حالك", want: "ar-XA"},
		{name: "hindi devanagari", text: "नमस्ते, मैं उच्चारण का अभ्यास कर रहा हूँ।", want: "hi-IN"},
		{name: "bengali script", text: "আমি উচ্চারণ অনুশীলন করছি।", want: "bn-IN"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := guessTTSLanguage(tt.text); got != tt.want {
				t.Fatalf("guessTTSLanguage(%q) = %s, want %s", tt.text, got, tt.want)
			}
		})
	}
}

func TestCallGoogleRelayTTSAutoLanguageSendsMandarinCode(t *testing.T) {
	const secret = "relay-secret"
	var sawLanguage string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := readAllForTest(t, r)
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("bad json payload: %v", err)
		}
		sawLanguage, _ = payload["languageCode"].(string)
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("mp3-bytes"))
	}))
	defer server.Close()

	app := &App{cfg: Config{TTS: TTSConfig{GoogleRelay: GoogleRelayTTS{
		Endpoint:    server.URL + "/v1/tts",
		RelaySecret: secret,
		Timeout:     5,
	}}}}
	if _, _, _, err := app.callGoogleRelayTTS(ttsRequest{Text: "你好，世界"}, "google_chirp"); err != nil {
		t.Fatalf("callGoogleRelayTTS returned error: %v", err)
	}
	if sawLanguage != "cmn-CN" {
		t.Fatalf("expected cmn-CN for auto Mandarin, got %s", sawLanguage)
	}
}

func TestCallGoogleDirectTTSUsesServiceAccountFields(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	privateKey := pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})

	var sawTokenRequest bool
	var sawGoogleAuth string
	var sawVoice string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			sawTokenRequest = true
			if err := r.ParseForm(); err != nil {
				t.Fatalf("parse form: %v", err)
			}
			if r.Form.Get("grant_type") == "" || r.Form.Get("assertion") == "" {
				t.Fatalf("missing token form fields: %s", r.Form.Encode())
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"google-token","expires_in":3600}`))
		case "/v1/text:synthesize":
			sawGoogleAuth = r.Header.Get("Authorization")
			body := readAllForTest(t, r)
			var payload struct {
				Voice struct {
					Name string `json:"name"`
				} `json:"voice"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("bad google payload: %v", err)
			}
			sawVoice = payload.Voice.Name
			w.Header().Set("Content-Type", "application/json")
			audio := base64.StdEncoding.EncodeToString([]byte("mp3-bytes"))
			_, _ = w.Write([]byte(`{"audioContent":"` + audio + `"}`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	app := &App{cfg: Config{TTS: TTSConfig{Google: GoogleTTS{
		ClientEmail: "tts@example.iam.gserviceaccount.com",
		PrivateKey:  string(privateKey),
		TokenURL:    server.URL + "/token",
		TTSURL:      server.URL + "/v1/text:synthesize",
		Timeout:     5,
	}}}}
	audio, contentType, voice, err := app.callGoogleRelayTTS(ttsRequest{
		Text:     "hello",
		Language: "en-US",
		Speed:    0.9,
	}, "google_chirp")
	if err != nil {
		t.Fatalf("callGoogleRelayTTS returned error: %v", err)
	}
	if !sawTokenRequest {
		t.Fatal("token endpoint was not called")
	}
	if sawGoogleAuth != "Bearer google-token" {
		t.Fatalf("bad google auth header: %s", sawGoogleAuth)
	}
	if sawVoice != "en-US-Chirp3-HD-Charon" || voice != sawVoice {
		t.Fatalf("unexpected voice: payload=%s returned=%s", sawVoice, voice)
	}
	if string(audio) != "mp3-bytes" || contentType != "audio/mpeg" {
		t.Fatalf("unexpected audio response: %q %s", string(audio), contentType)
	}
}

func TestAnalyzeIncludesTranslationLanguageInLLMPrompt(t *testing.T) {
	var sawUserPrompt string
	var sawSystemPrompt string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := readAllForTest(t, r)
		var payload struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("bad llm payload: %v", err)
		}
		for _, message := range payload.Messages {
			switch message.Role {
			case "system":
				sawSystemPrompt = message.Content
			case "user":
				sawUserPrompt = message.Content
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"summary\":\"ok\",\"explanation_markdown\":\"ok\",\"tts_script\":\"Hello.\",\"tts_script_translation\":\"Hello.\"}"}}]}`))
	}))
	defer server.Close()

	app := &App{
		cfg: Config{LLM: LLMConfig{
			BaseURL: server.URL,
			APIKey:  "test-key",
			Model:   "test-model",
			Timeout: 5,
		}},
	}
	reqBody := bytes.NewBufferString(`{"query":"skill vs scale","translation_language":"English"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/analyze", reqBody)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	app.handleAnalyze(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code = %d body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(sawSystemPrompt, "tts_script is the text that will be spoken by TTS") {
		t.Fatalf("system prompt does not define tts_script responsibility: %s", sawSystemPrompt)
	}
	if !strings.Contains(sawSystemPrompt, "tts_script_translation is the side-by-side reference") {
		t.Fatalf("system prompt does not define translation responsibility: %s", sawSystemPrompt)
	}
	if !strings.Contains(sawSystemPrompt, "selected reference language: English") {
		t.Fatalf("system prompt did not include selected reference language: %s", sawSystemPrompt)
	}
	if !strings.Contains(sawSystemPrompt, "must not change the language of tts_script") {
		t.Fatalf("system prompt does not keep script language separate from reference language: %s", sawSystemPrompt)
	}
	if strings.Contains(sawSystemPrompt, "skill") || strings.Contains(sawSystemPrompt, "Cloud Code") {
		t.Fatalf("system prompt should not contain example-specific rules: %s", sawSystemPrompt)
	}
	if !strings.Contains(sawUserPrompt, "我要学习下面内容的发音：\nskill vs scale") {
		t.Fatalf("user prompt did not include learning phrase before query: %s", sawUserPrompt)
	}
	if !strings.Contains(sawUserPrompt, "目标发音语言或口音偏好：") {
		t.Fatalf("user prompt did not include target pronunciation preference: %s", sawUserPrompt)
	}
	if !strings.Contains(sawUserPrompt, "右侧对照语言：English") {
		t.Fatalf("user prompt did not include side-by-side reference language: %s", sawUserPrompt)
	}
	if strings.Contains(sawUserPrompt, "如果这里是 English") || strings.Contains(sawUserPrompt, "跟读稿翻译语言") {
		t.Fatalf("user prompt still contains patch-style language: %s", sawUserPrompt)
	}
}

func TestHandleConfigMasksSecretsAndPreservesThemOnSave(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env")
	app := &App{
		cfg: Config{
			LLM: LLMConfig{
				BaseURL: "https://api.example.com/v1",
				APIKey:  "llm-secret",
				Model:   "test-model",
				Timeout: 30,
			},
			TTS: TTSConfig{
				DefaultProvider: "auto",
				AutoOrder:       []string{"google_chirp", "custom"},
				MonthlyLimits: map[string]int{
					"google_chirp": 800000,
					"custom":       800000,
				},
				Google: GoogleTTS{
					ClientEmail: "service@example.com",
					PrivateKey:  "google-private-key",
					Timeout:     60,
				},
				GoogleRelay: GoogleRelayTTS{
					Endpoint:    "https://relay.example/v1/tts",
					RelaySecret: "relay-secret",
					Timeout:     60,
				},
				Custom: CustomTTS{
					BaseURL:        "https://tts.example.com/v1",
					APIKey:         "custom-secret",
					Model:          "tts-model",
					Voice:          "tts-voice",
					ResponseFormat: "mp3",
					Speed:          1,
					Timeout:        60,
				},
			},
		},
		envPath:        envPath,
		configSource:   "shared_env",
		configWritable: true,
		configToken:    "config-token",
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	getReq.Header.Set("X-Say-Config-Token", "config-token")
	getRec := httptest.NewRecorder()
	app.handleConfig(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("GET /api/config code = %d body = %s", getRec.Code, getRec.Body.String())
	}
	var getResp configResponse
	if err := json.Unmarshal(getRec.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("bad config response: %v", err)
	}
	if getResp.Config.LLM.APIKey != "" || getResp.Config.TTS.Google.PrivateKey != "" || getResp.Config.TTS.GoogleRelay.RelaySecret != "" || getResp.Config.TTS.Custom.APIKey != "" {
		t.Fatalf("config response leaked secrets: %+v", getResp.Config)
	}
	if !getResp.Secrets.LLMAPIKey || !getResp.Secrets.GooglePrivateKey || !getResp.Secrets.GoogleRelaySecret || !getResp.Secrets.CustomAPIKey {
		t.Fatalf("secret status did not report configured secrets: %+v", getResp.Secrets)
	}

	next := getResp.Config
	next.LLM.Model = "updated-model"
	body, _ := json.Marshal(updateConfigRequest{Config: next})
	putReq := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	putReq.Header.Set("X-Say-Config-Token", "config-token")
	putRec := httptest.NewRecorder()
	app.handleConfig(putRec, putReq)

	if putRec.Code != http.StatusOK {
		t.Fatalf("PUT /api/config code = %d body = %s", putRec.Code, putRec.Body.String())
	}
	if app.cfg.LLM.Model != "updated-model" {
		t.Fatalf("model was not updated: %s", app.cfg.LLM.Model)
	}
	if app.cfg.LLM.APIKey != "llm-secret" || app.cfg.TTS.Google.PrivateKey != "google-private-key" || app.cfg.TTS.GoogleRelay.RelaySecret != "relay-secret" || app.cfg.TTS.Custom.APIKey != "custom-secret" {
		t.Fatalf("existing secrets were not preserved: %+v", app.cfg)
	}
	envBody, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("env file was not written: %v", err)
	}
	if !strings.Contains(string(envBody), "SAY_LLM_MODEL=updated-model") {
		t.Fatalf("env file did not receive updated model: %s", string(envBody))
	}
}

func TestHandleConfigTokenIsOptionalButEnforcedWhenConfigured(t *testing.T) {
	app := &App{
		cfg: Config{
			LLM: LLMConfig{Model: "test-model"},
			TTS: TTSConfig{MonthlyLimits: map[string]int{}},
		},
		envPath:        filepath.Join(t.TempDir(), ".env"),
		configSource:   "shared_env",
		configWritable: true,
		configToken:    "config-token",
	}

	disabled := *app
	disabled.configToken = ""
	openReq := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	openRec := httptest.NewRecorder()
	disabled.handleConfig(openRec, openReq)
	if openRec.Code != http.StatusOK {
		t.Fatalf("GET with no configured token code = %d body = %s", openRec.Code, openRec.Body.String())
	}

	noTokenReq := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	noTokenRec := httptest.NewRecorder()
	app.handleConfig(noTokenRec, noTokenReq)
	if noTokenRec.Code != http.StatusUnauthorized {
		t.Fatalf("GET without token code = %d body = %s", noTokenRec.Code, noTokenRec.Body.String())
	}
}

func TestLoadConfigReadsRepositoryRootEnv(t *testing.T) {
	root := t.TempDir()
	sayDir := filepath.Join(root, "say-lab")
	if err := os.MkdirAll(sayDir, 0755); err != nil {
		t.Fatalf("mkdir say-lab: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "app.py"), []byte("# marker"), 0644); err != nil {
		t.Fatalf("write app marker: %v", err)
	}
	envBody := strings.Join([]string{
		"SAY_LLM_MODEL=root-env-model",
		"SAY_LAB_URL=https://say.example.com/",
		"SAY_TTS_GOOGLE_RELAY_PASS_CONFIG=true",
		"SAY_TTS_CUSTOM_BASE_URL=https://tts.example.com/v1",
		"SAY_TTS_CUSTOM_API_KEY=custom-key",
		"SAY_TTS_CUSTOM_MODEL=tts-model",
		"SAY_TTS_CUSTOM_VOICE=tts-voice",
	}, "\n")
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte(envBody), 0600); err != nil {
		t.Fatalf("write root env: %v", err)
	}

	oldCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get cwd: %v", err)
	}
	defer func() {
		_ = os.Chdir(oldCwd)
	}()
	t.Setenv("SAY_ENV_FILE", "")
	t.Setenv("NAV_ENV_FILE", "")
	for _, key := range []string{
		"SAY_LLM_MODEL",
		"SAY_TTS_GOOGLE_RELAY_PASS_CONFIG",
		"SAY_TTS_CUSTOM_BASE_URL",
		"SAY_TTS_CUSTOM_API_KEY",
		"SAY_TTS_CUSTOM_MODEL",
		"SAY_TTS_CUSTOM_VOICE",
	} {
		unsetEnvForTest(t, key)
	}
	if err := os.Chdir(sayDir); err != nil {
		t.Fatalf("chdir say-lab: %v", err)
	}

	loaded, err := loadConfig("")
	if err != nil {
		t.Fatalf("loadConfig returned error: %v", err)
	}
	if loaded.EnvPath != filepath.Join("..", ".env") {
		t.Fatalf("EnvPath = %q, want ../.env", loaded.EnvPath)
	}
	if loaded.Config.LLM.Model != "root-env-model" {
		t.Fatalf("LLM model = %q", loaded.Config.LLM.Model)
	}
	if !loaded.Config.TTS.GoogleRelay.PassGoogleConfig {
		t.Fatal("relay pass config was not loaded from root env")
	}
	if loaded.Config.TTS.Custom.APIKey != "custom-key" {
		t.Fatalf("custom API key was not loaded from root env")
	}
}

func unsetEnvForTest(t *testing.T, key string) {
	t.Helper()
	oldValue, existed := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("unset %s: %v", key, err)
	}
	t.Cleanup(func() {
		if existed {
			_ = os.Setenv(key, oldValue)
		} else {
			_ = os.Unsetenv(key)
		}
	})
}

func TestLegacySiliconFlowConfigMigratesToCustom(t *testing.T) {
	cfg := Config{TTS: TTSConfig{
		AutoOrder: []string{"google_chirp", "siliconflow"},
		MonthlyLimits: map[string]int{
			"siliconflow": 123,
		},
		Labels: map[string]string{
			"siliconflow": "SiliconFlow TTS",
		},
		LegacySilicon: &CustomTTS{
			BaseURL: "https://legacy.example/v1",
			APIKey:  "legacy-key",
			Model:   "legacy-model",
			Voice:   "legacy-voice",
		},
	}}
	normalizeConfig(&cfg)
	if strings.Join(cfg.TTS.AutoOrder, ",") != "google_chirp,custom" {
		t.Fatalf("legacy provider was not migrated in order: %v", cfg.TTS.AutoOrder)
	}
	if cfg.TTS.MonthlyLimits["custom"] != 123 {
		t.Fatalf("legacy limit was not migrated: %+v", cfg.TTS.MonthlyLimits)
	}
	if cfg.TTS.Custom.APIKey != "legacy-key" || cfg.TTS.Custom.Model != "legacy-model" {
		t.Fatalf("legacy custom config was not migrated: %+v", cfg.TTS.Custom)
	}
	if cfg.TTS.LegacySilicon != nil {
		t.Fatalf("legacy field should be cleared before client exposure")
	}
}

func readAllForTest(t *testing.T, r *http.Request) []byte {
	t.Helper()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return body
}

func hmacHexForTest(secret, value string) string {
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write([]byte(value))
	return hex.EncodeToString(h.Sum(nil))
}
