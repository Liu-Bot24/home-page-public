const $ = (id) => document.getElementById(id);

const state = {
  status: null,
  scriptLines: [],
  translationLines: [],
  subtitleCueStops: [],
  activeLine: -1,
  audioUrl: "",
  audioAbortController: null,
  playbackState: "idle",
  playbackSource: "",
  ttsProvider: localStorage.getItem("say-lab-tts-provider") || "auto",
  translationLanguage: localStorage.getItem("say-lab-translation-language") || "",
  configPayload: null,
  configToken: "",
  configTokenRequired: false,
  themeOrder: (document.body.dataset.themeOrder || "").split(",").filter(Boolean),
  currentTheme: "",
};
state.validThemes = new Set(state.themeOrder);

const providerLabels = {
  google_chirp: "Google Chirp 3 HD",
  google_wavenet: "Google WaveNet",
  custom: "Custom TTS",
};

$("clear-btn").addEventListener("click", () => {
  $("query").value = "";
  $("query").focus();
});

document.addEventListener("click", (event) => {
  const themeButton = event.target.closest("[data-theme-step]");
  if (!themeButton) return;
  cycleTheme(Number(themeButton.dataset.themeStep || "1"));
});

$("rate").addEventListener("input", () => {
  $("rate-value").textContent = Number($("rate").value).toFixed(2);
});

$("play-input").addEventListener("click", () => {
  if (state.playbackSource === "input" && state.playbackState !== "idle") {
    stopAudio();
    return;
  }
  playInput();
});
$("analyze-btn").addEventListener("click", analyze);
$("play-script").addEventListener("click", toggleScriptPlayback);
$("pause-script").addEventListener("click", togglePause);
$("config-toggle").addEventListener("click", toggleConfigPanel);
$("config-reload").addEventListener("click", () => loadConfigForm(state.configTokenRequired));
$("config-token-submit").addEventListener("click", () => loadConfigForm(true));
$("config-form").addEventListener("submit", saveConfigForm);
$("cfg-config-token").addEventListener("input", () => {
  state.configToken = $("cfg-config-token").value.trim();
});
$("cfg-config-token").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loadConfigForm(true);
  }
});
$("translation-language").value = state.translationLanguage;
$("translation-language").addEventListener("change", () => {
  state.translationLanguage = $("translation-language").value;
  localStorage.setItem("say-lab-translation-language", state.translationLanguage);
});
$("copy-script").addEventListener("click", async () => {
  await navigator.clipboard.writeText(scriptClipboardText());
  notice("跟读稿已复制。");
});
$("audio").addEventListener("timeupdate", syncSubtitle);
$("audio").addEventListener("ended", handleAudioEnded);

async function init() {
  initTheme();
  await loadStatus();
  renderSubtitles();
  updateAudioControls();
}

function initTheme() {
  const urlTheme = new URL(window.location.href).searchParams.get("theme");
  const ownTheme = localStorage.getItem("say-lab-theme");
  const navTheme = localStorage.getItem("navTheme");
  const fallbackTheme = document.body.dataset.defaultTheme || state.themeOrder[0] || "default";
  const initialTheme = [urlTheme, ownTheme, navTheme, fallbackTheme].find((theme) => state.validThemes.has(theme)) || fallbackTheme;
  applyTheme(initialTheme);
}

function applyTheme(themeId) {
  if (!state.validThemes.has(themeId)) return;
  state.currentTheme = themeId;
  document.body.dataset.theme = themeId;
  document.documentElement.style.colorScheme = themeId === "midnight" ? "dark" : "light";
  localStorage.setItem("say-lab-theme", themeId);
}

function cycleTheme(direction) {
  if (!state.themeOrder.length) return;
  const currentIndex = Math.max(0, state.themeOrder.indexOf(state.currentTheme || document.body.dataset.defaultTheme || state.themeOrder[0]));
  const nextIndex = (currentIndex + direction + state.themeOrder.length) % state.themeOrder.length;
  applyTheme(state.themeOrder[nextIndex]);
}

async function toggleConfigPanel() {
  const panel = $("config-panel");
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  $("config-toggle").textContent = willOpen ? "收起配置" : "配置";
  if (willOpen && !state.configPayload) {
    await loadConfigForm(false);
  }
}

async function loadConfigForm(useToken = false) {
  state.configToken = useToken ? $("cfg-config-token").value.trim() : "";
  setConfigStatus("正在读取配置...");
  try {
    const res = await fetch("api/config", { headers: configAuthHeaders(useToken) });
    const data = await safeJSON(res);
    if (res.status === 401) {
      showConfigTokenPrompt(data.error || "请输入配置口令");
      return;
    }
    if (!res.ok) throw new Error(data.error || "配置读取失败");
    state.configPayload = data;
    fillConfigForm(data);
    setConfigStatus("");
  } catch (error) {
    setConfigStatus(error.message);
  }
}

async function saveConfigForm(event) {
  event.preventDefault();
  state.configToken = $("cfg-config-token").value.trim();
  if (!state.configPayload?.source?.writable) return;
  setConfigStatus("正在保存配置...");
  try {
    const res = await fetch("api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...configAuthHeaders() },
      body: JSON.stringify({ config: collectConfigForm() }),
    });
    const data = await safeJSON(res);
    if (res.status === 401) {
      showConfigTokenPrompt(data.error || "请输入正确的配置口令");
      return;
    }
    if (!res.ok) throw new Error(data.error || "配置保存失败");
    state.configPayload = data;
    fillConfigForm(data);
    await loadStatus();
    setConfigStatus("配置已保存。");
  } catch (error) {
    setConfigStatus(error.message);
  }
}

function fillConfigForm(payload) {
  const cfg = normalizeClientConfig(payload.config || {});
  const secrets = payload.secrets || {};
  const source = payload.source || {};
  setConfigTokenVisible(false, false);
  $("config-source").textContent = "";
  $("config-source").hidden = true;
  setConfigContentVisible(true);

  setField("cfg-llm-base-url", cfg.llm.base_url);
  setField("cfg-llm-endpoint", cfg.llm.endpoint);
  setField("cfg-llm-model", cfg.llm.model);
  setSecretField("cfg-llm-api-key", secrets.llm_api_key);
  setField("cfg-llm-timeout", cfg.llm.timeout);

  setField("cfg-tts-default-provider", cfg.tts.default_provider || "auto");
  setField("cfg-tts-auto-order", (cfg.tts.auto_order || []).join(", "));
  setField("cfg-limit-google-chirp", cfg.tts.monthly_limits.google_chirp);
  setField("cfg-limit-google-wavenet", cfg.tts.monthly_limits.google_wavenet);
  setField("cfg-limit-custom", cfg.tts.monthly_limits.custom);

  setField("cfg-google-project-id", cfg.tts.google.project_id);
  setField("cfg-google-client-email", cfg.tts.google.client_email);
  setSecretField("cfg-google-private-key", secrets.google_private_key || secrets.google_service_account_json);
  setField("cfg-google-private-key-id", cfg.tts.google.private_key_id);
  setField("cfg-google-token-url", cfg.tts.google.token_url);
  setField("cfg-google-tts-url", cfg.tts.google.tts_url);
  setField("cfg-google-timeout", cfg.tts.google.timeout);

  setField("cfg-custom-base-url", cfg.tts.custom.base_url);
  setSecretField("cfg-custom-api-key", secrets.custom_api_key);
  setField("cfg-custom-model", cfg.tts.custom.model);
  setField("cfg-custom-voice", cfg.tts.custom.voice);
  setField("cfg-custom-format", cfg.tts.custom.response_format);
  setField("cfg-custom-speed", cfg.tts.custom.speed);
  setField("cfg-custom-timeout", cfg.tts.custom.timeout);

  setConfigFieldsEnabled(Boolean(source.writable));
  $("config-save").disabled = !source.writable;
}

function configAuthHeaders() {
  return state.configToken ? { "X-Say-Config-Token": state.configToken } : {};
}

function setConfigFieldsEnabled(enabled) {
  document.querySelectorAll("#config-form input, #config-form select, #config-form textarea").forEach((element) => {
    element.disabled = !enabled;
  });
  $("cfg-config-token").disabled = false;
  $("config-save").disabled = !enabled;
}

function showConfigTokenPrompt(message) {
  state.configTokenRequired = true;
  state.configPayload = null;
  setConfigTokenVisible(true);
  $("cfg-config-token").value = "";
  state.configToken = "";
  setConfigContentVisible(false);
  setConfigFieldsEnabled(false);
  $("config-source").textContent = "";
  $("config-source").hidden = true;
  setConfigStatus("");
  $("cfg-config-token").focus();
}

function setConfigTokenVisible(visible, clearToken = true) {
  const unlock = document.querySelector(".config-unlock");
  if (!unlock) return;
  unlock.hidden = !visible;
  if (!visible && clearToken) {
    $("cfg-config-token").value = "";
    state.configToken = "";
  }
}

function setConfigContentVisible(visible) {
  document.querySelector(".config-grid").hidden = !visible;
  document.querySelector(".config-actions").hidden = !visible;
}

async function safeJSON(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function collectConfigForm() {
  const cfg = normalizeClientConfig(clone(state.configPayload?.config || {}));
  cfg.llm.base_url = fieldValue("cfg-llm-base-url");
  cfg.llm.endpoint = fieldValue("cfg-llm-endpoint");
  cfg.llm.model = fieldValue("cfg-llm-model");
  cfg.llm.api_key = fieldValue("cfg-llm-api-key");
  cfg.llm.timeout = numberFieldValue("cfg-llm-timeout", cfg.llm.timeout);

  cfg.tts.default_provider = fieldValue("cfg-tts-default-provider") || "auto";
  cfg.tts.auto_order = splitCSV($("cfg-tts-auto-order").value);
  cfg.tts.monthly_limits.google_chirp = numberFieldValue("cfg-limit-google-chirp", 0);
  cfg.tts.monthly_limits.google_wavenet = numberFieldValue("cfg-limit-google-wavenet", 0);
  cfg.tts.monthly_limits.custom = numberFieldValue("cfg-limit-custom", 0);

  cfg.tts.google.service_account_json = "";
  cfg.tts.google.project_id = fieldValue("cfg-google-project-id");
  cfg.tts.google.client_email = fieldValue("cfg-google-client-email");
  cfg.tts.google.private_key = fieldValue("cfg-google-private-key");
  cfg.tts.google.private_key_id = fieldValue("cfg-google-private-key-id");
  cfg.tts.google.token_url = fieldValue("cfg-google-token-url");
  cfg.tts.google.tts_url = fieldValue("cfg-google-tts-url");
  cfg.tts.google.timeout = numberFieldValue("cfg-google-timeout", cfg.tts.google.timeout);

  cfg.tts.custom.base_url = fieldValue("cfg-custom-base-url");
  cfg.tts.custom.api_key = fieldValue("cfg-custom-api-key");
  cfg.tts.custom.model = fieldValue("cfg-custom-model");
  cfg.tts.custom.voice = fieldValue("cfg-custom-voice");
  cfg.tts.custom.response_format = fieldValue("cfg-custom-format");
  cfg.tts.custom.speed = numberFieldValue("cfg-custom-speed", cfg.tts.custom.speed);
  cfg.tts.custom.timeout = numberFieldValue("cfg-custom-timeout", cfg.tts.custom.timeout);
  return cfg;
}

function normalizeClientConfig(cfg) {
  cfg.llm = cfg.llm || {};
  cfg.tts = cfg.tts || {};
  cfg.tts.auto_order = cfg.tts.auto_order || [];
  cfg.tts.monthly_limits = cfg.tts.monthly_limits || {};
  cfg.tts.google = cfg.tts.google || {};
  cfg.tts.google_relay = cfg.tts.google_relay || {};
  cfg.tts.custom = cfg.tts.custom || {};
  cfg.tts.labels = cfg.tts.labels || {};
  cfg.tts.voice_hints = cfg.tts.voice_hints || {};
  return cfg;
}

function setField(id, value) {
  $(id).value = value ?? "";
}

function setSecretField(id, isSet) {
  const input = $(id);
  input.value = "";
  input.placeholder = isSet ? "已设置，留空保留" : "未设置";
}

function fieldValue(id) {
  return $(id).value.trim();
}

function numberFieldValue(id, fallback) {
  const value = $(id).value.trim();
  if (value === "") return Number(fallback || 0);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function splitCSV(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function setConfigStatus(text) {
  $("config-status").textContent = text || "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadStatus() {
  try {
    const res = await fetch("api/status");
    state.status = await res.json();
    renderStatus();
  } catch (error) {
    $("status-card").innerHTML = `<div class="status-title">当前 TTS</div><div class="status-line">读取失败：${escapeHTML(error.message)}</div>`;
  }
}

function renderStatus() {
  const current = selectedProviderStatus();
  if (!current) {
    $("status-card").innerHTML = `
      <div class="status-title">当前 TTS</div>
      <div class="status-line">暂无可用云端 TTS</div>
      ${providerSelectHTML()}`;
    bindStatusControls();
    return;
  }
  const usageLine = current.name === "custom"
    ? ""
    : `<br>本月 ${formatNumber(current.used)}${current.limit ? ` / ${formatNumber(current.limit)}` : ""} 字符`;
  const selectedPrefix = state.ttsProvider === "auto" ? "自动选择 · " : "";
  $("status-card").innerHTML = `
    <div class="status-title">当前 TTS</div>
    <div class="status-line">
      <strong>${selectedPrefix}${escapeHTML(current.label || providerLabels[current.name] || current.name)}</strong>${usageLine}
    </div>
    ${providerSelectHTML()}`;
  bindStatusControls();
}

function firstConfiguredProvider() {
  return (state.status.providers || []).find((p) => p.configured && providerHasRemainingCapacity(p));
}

function selectedProviderStatus() {
  if (!state.status) return null;
  if (state.ttsProvider === "auto") {
    return state.status.current_provider || firstConfiguredProvider();
  }
  const selected = (state.status.providers || []).find((p) => p.name === state.ttsProvider);
  return selected?.configured ? selected : null;
}

function providerHasRemainingCapacity(provider) {
  return !provider.limit || provider.used < provider.limit;
}

function providerSelectHTML() {
  const providers = state.status?.providers || [];
  const options = [
    `<option value="auto">自动选择</option>`,
    ...providers.map((provider) => {
      const label = provider.label || providerLabels[provider.name] || provider.name;
      const disabled = provider.configured ? "" : " disabled";
      return `<option value="${escapeHTML(provider.name)}"${disabled}>${escapeHTML(label)}</option>`;
    }),
  ].join("");
  return `
    <label class="status-control">
      TTS 切换
      <select id="tts-provider">${options}</select>
    </label>`;
}

function bindStatusControls() {
  const providerSelect = $("tts-provider");
  if (!providerSelect) return;
  const selectedProvider = (state.status?.providers || []).find((p) => p.name === state.ttsProvider);
  if (state.ttsProvider !== "auto" && !selectedProvider?.configured) {
    state.ttsProvider = "auto";
    localStorage.setItem("say-lab-tts-provider", state.ttsProvider);
    renderStatus();
    return;
  }
  providerSelect.value = state.ttsProvider;
  if (providerSelect.value !== state.ttsProvider) {
    state.ttsProvider = "auto";
    providerSelect.value = "auto";
    localStorage.setItem("say-lab-tts-provider", state.ttsProvider);
    renderStatus();
    return;
  }
  providerSelect.addEventListener("change", () => {
    state.ttsProvider = providerSelect.value || "auto";
    localStorage.setItem("say-lab-tts-provider", state.ttsProvider);
    renderStatus();
  });
}

async function analyze() {
  const query = $("query").value.trim();
  if (!query) {
    notice("先输入要分析的内容。");
    return;
  }
  setBusy(true);
  notice("");
  try {
    const res = await fetch("api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        accent: $("accent").value,
        translation_language: state.translationLanguage,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "分析失败");
    $("summary").textContent = data.summary || "已生成发音分析。";
    $("explanation").innerHTML = renderMarkdown(data.explanation_markdown || "");
    state.scriptLines = splitLines(data.tts_script || "");
    state.translationLines = splitLines(data.tts_script_translation || "");
    state.subtitleCueStops = buildSubtitleCueStops(state.scriptLines);
    setActiveSubtitle(-1);
    renderSubtitles();
  } catch (error) {
    notice(error.message);
  } finally {
    setBusy(false);
  }
}

async function playInput() {
  const text = $("query").value.trim();
  if (!text) {
    notice("先输入要发音的内容。");
    return;
  }
  await playTTS(text, "正在朗读输入内容...");
}

async function playScript() {
  const text = state.scriptLines.join("\n").trim();
  if (!text) {
    notice("还没有跟读稿，先分析一下。");
    return;
  }
  state.subtitleCueStops = buildSubtitleCueStops(state.scriptLines);
  await playTTS(text, "正在读稿...", true);
}

async function toggleScriptPlayback() {
  if (state.playbackSource === "script" && state.playbackState !== "idle") {
    stopAudio();
    return;
  }
  await playScript();
}

async function playTTS(text, loadingText, trackSubtitles = false) {
  stopAudio(false);
  if (trackSubtitles) setActiveSubtitle(0);
  const controller = new AbortController();
  state.audioAbortController = controller;
  state.playbackState = "loading";
  state.playbackSource = trackSubtitles ? "script" : "input";
  updateAudioControls();
  notice(loadingText);
  try {
    const res = await fetch("api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        text,
        provider: state.ttsProvider,
        language: "",
        speed: Number($("rate").value || 0.86),
      }),
    });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      const data = contentType.includes("application/json") ? await res.json() : { error: await res.text() };
      throw new Error(data.error || "云端 TTS 不可用");
    }
    const blob = await res.blob();
    const audio = $("audio");
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(blob);
    audio.src = state.audioUrl;
    audio.hidden = true;
    state.playbackState = "playing";
    updateAudioControls();
    await audio.play();
    const provider = res.headers.get("x-say-provider") || "cloud";
    const voice = res.headers.get("x-say-voice") || "";
    notice(`正在朗读 ${providerLabels[provider] || provider}${voice ? ` · ${voice}` : ""}。`);
    await loadStatus();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    state.playbackState = "idle";
    state.playbackSource = "";
    updateAudioControls();
    notice(error.message);
    if (trackSubtitles) setActiveSubtitle(-1);
  } finally {
    if (state.audioAbortController === controller) {
      state.audioAbortController = null;
    }
    if (state.playbackState === "loading") {
      state.playbackState = "idle";
      state.playbackSource = "";
      updateAudioControls();
    }
  }
}

function stopAudio(resetNotice = true, resetSubtitles = state.playbackSource === "script") {
  if (state.audioAbortController) {
    state.audioAbortController.abort();
    state.audioAbortController = null;
  }
  const audio = $("audio");
  audio.pause();
  audio.currentTime = 0;
  state.playbackState = "idle";
  state.playbackSource = "";
  updateAudioControls();
  if (resetSubtitles) setActiveSubtitle(-1);
  if (resetNotice) notice("已停止。");
}

async function togglePause() {
  if (state.playbackSource !== "script" || !["playing", "paused"].includes(state.playbackState)) {
    return;
  }
  const audio = $("audio");
  if (state.playbackState === "playing") {
    audio.pause();
    state.playbackState = "paused";
    updateAudioControls();
    notice("已暂停。");
    return;
  }
  state.playbackState = "playing";
  updateAudioControls();
  await audio.play();
  notice("继续读稿。");
}

function updateAudioControls() {
  const playInputButton = $("play-input");
  const playScriptButton = $("play-script");
  const pauseScriptButton = $("pause-script");
  const inputActive = state.playbackSource === "input" && state.playbackState !== "idle";
  const scriptActive = state.playbackSource === "script" && state.playbackState !== "idle";
  const scriptPaused = state.playbackSource === "script" && state.playbackState === "paused";

  playInputButton.textContent = inputActive ? "停止" : "发音";
  playInputButton.classList.toggle("is-stop", inputActive);
  playInputButton.disabled = scriptActive;
  playInputButton.setAttribute("aria-pressed", inputActive ? "true" : "false");

  playScriptButton.textContent = scriptActive ? "停止" : "读稿";
  playScriptButton.classList.toggle("is-stop", scriptActive);
  playScriptButton.disabled = inputActive;
  playScriptButton.setAttribute("aria-pressed", scriptActive ? "true" : "false");

  pauseScriptButton.textContent = scriptPaused ? "恢复" : "暂停";
  pauseScriptButton.disabled = !(state.playbackSource === "script" && ["playing", "paused"].includes(state.playbackState));
  pauseScriptButton.setAttribute("aria-pressed", scriptPaused ? "true" : "false");
}

function syncSubtitle() {
  if (state.playbackSource !== "script") return;
  const audio = $("audio");
  if (!state.scriptLines.length || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const ratio = Math.min(0.999, Math.max(0, audio.currentTime / audio.duration));
  const cueStops = state.subtitleCueStops.length === state.scriptLines.length
    ? state.subtitleCueStops
    : buildSubtitleCueStops(state.scriptLines);
  setActiveSubtitle(subtitleIndexForRatio(ratio, cueStops));
}

function handleAudioEnded() {
  const endedSource = state.playbackSource;
  state.playbackState = "idle";
  state.playbackSource = "";
  updateAudioControls();
  if (endedSource === "script") {
    setActiveSubtitle(-1);
    notice("读稿结束。");
    return;
  }
  notice("");
}

function buildSubtitleCueStops(lines) {
  const weights = lines.map(estimateSubtitleLineWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || lines.length || 1;
  let elapsed = 0;
  return weights.map((weight, index) => {
    elapsed += weight;
    return index === weights.length - 1 ? 1 : Math.min(0.999, elapsed / total);
  });
}

function subtitleIndexForRatio(ratio, cueStops) {
  if (!cueStops.length) return -1;
  const safeRatio = Math.min(0.999, Math.max(0, ratio));
  for (let index = 0; index < cueStops.length; index += 1) {
    if (safeRatio < cueStops[index]) return index;
  }
  return cueStops.length - 1;
}

function estimateSubtitleLineWeight(line) {
  const text = String(line || "").trim();
  if (!text) return 0.1;
  const latinWords = (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
  const cjkChars = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const kanaChars = (text.match(/[\u3040-\u30ff\uff66-\uff9f]/g) || []).length;
  const hangulChars = (text.match(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g) || []).length;
  const digits = (text.match(/\d+/g) || []).length;
  const symbols = Math.max(0, text.replace(/[A-Za-z0-9\s\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uff66-\uff9f\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g, "").length);
  const pauses = (text.match(/[,.!?;:，。！？；：]/g) || []).length;
  return Math.max(
    0.8,
    latinWords + cjkChars * 0.56 + kanaChars * 0.58 + hangulChars * 0.58 + digits * 0.75 + symbols * 0.15 + pauses * 0.35 + 0.55,
  );
}

function setActiveSubtitle(index) {
  if (state.activeLine === index) return;
  state.activeLine = index;
  document.querySelectorAll(".subtitle-row").forEach((row) => {
    const active = Number(row.dataset.index) === index;
    row.classList.toggle("is-active", active);
    if (active) row.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function renderSubtitles() {
  const board = $("subtitle-board");
  if (!state.scriptLines.length) {
    board.innerHTML = `<div class="subtitle-empty">分析后会生成双语对照跟读稿。</div>`;
    return;
  }
  board.innerHTML = state.scriptLines.map((line, index) => {
    const translation = state.translationLines[index] || "";
    return `
      <div class="subtitle-row" data-index="${index}">
        <div class="subtitle-en">${escapeHTML(line)}</div>
        <div class="subtitle-zh">${escapeHTML(translation)}</div>
      </div>`;
  }).join("");
}

function scriptClipboardText() {
  if (!state.scriptLines.length) return "";
  return state.scriptLines.map((line, index) => {
    const zh = state.translationLines[index] || "";
    return zh ? `${line}\n${zh}` : line;
  }).join("\n\n");
}

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function setBusy(isBusy) {
  $("loader").hidden = !isBusy;
  $("analyze-btn").disabled = isBusy;
}

function notice(text) {
  $("notice").textContent = text || "";
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h3>${inlineMarkdown(heading[2])}</h3>`);
      continue;
    }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(item[1])}</li>`);
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

function inlineMarkdown(text) {
  return escapeHTML(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function escapeHTML(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}

init();
