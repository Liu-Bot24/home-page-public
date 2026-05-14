(() => {
    const DEFAULT_CITY = { id: "101010100", name: "北京市" };
    const DEFAULT_SEARCH_ENGINE = "google";
    const SEARCH_ENDPOINTS = {
        google: "https://www.google.com/search?q=",
        baidu: "https://www.baidu.com/s?wd=",
        bing: "https://www.bing.com/search?q=",
    };
    const DEFAULT_TRANSLATOR_TARGET = "简体中文";
    const TRANSLATOR_TARGET_STORAGE_KEY = "translatorTargetLanguage";

    document.addEventListener("DOMContentLoaded", init);

    function init() {
        const dom = cacheDom();
        const defaultCity = getDefaultCity(dom);
        const defaultSearchEngine = getDefaultSearchEngine(dom);
        const state = {
            currentEditCard: null,
            currentCategory: null,
            currentCityId: localStorage.getItem("weatherCityId") || defaultCity.id,
            currentCityName: localStorage.getItem("weatherCityName") || defaultCity.name,
            defaultSearchEngine,
            citySearchTimer: null,
            citySearchController: null,
            dragCard: null,
            dragTarget: null,
            isSavingNote: false,
            isTranslating: false,
            lastTranslation: "",
            sourceUtterance: null,
            translatorTarget: localStorage.getItem(TRANSLATOR_TARGET_STORAGE_KEY) || DEFAULT_TRANSLATOR_TARGET,
            themeOrder: (dom.body.dataset.themeOrder || "").split(",").filter(Boolean),
        };
        state.validThemes = new Set(state.themeOrder);

        ensureDragIndicators();
        initTheme(dom, state);
        initBackground();
        initClock(dom);
        initWeather(dom, state);
        loadNote(dom);
        initTranslatorTarget(dom, state);
        bindEvents(dom, state);
    }

    function cacheDom() {
        return {
            body: document.body,
            searchForm: document.getElementById("search-form"),
            searchInput: document.getElementById("search-input"),
            siteGrids: Array.from(document.querySelectorAll(".sites-grid")),
            noteTextarea: document.querySelector(".note-widget textarea"),
            noteSaveButton: document.querySelector(".note-save-btn"),
            weatherTemp: document.querySelector(".weather-temp"),
            weatherDesc: document.querySelector(".weather-desc"),
            weatherIcon: document.querySelector(".weather-icon"),
            weatherLocation: document.querySelector(".weather-location"),
            datetimeTime: document.querySelector(".datetime-time"),
            datetimeDate: document.querySelector(".datetime-date"),
            editModal: document.querySelector(".edit-modal"),
            editModalTitle: document.getElementById("edit-modal-title"),
            editNameInput: document.getElementById("edit-name"),
            editUrlInput: document.getElementById("edit-url"),
            cityModal: document.querySelector(".city-modal"),
            citySearchInput: document.getElementById("city-search-input"),
            cityList: document.querySelector(".city-list"),
            translator: document.querySelector("[data-translator]"),
            translatorToggle: document.querySelector('[data-action="toggle-translator"]'),
            translatorSource: document.querySelector("[data-translator-source]"),
            translatorContext: document.querySelector("[data-translator-context]"),
            translatorOutput: document.querySelector("[data-translator-output]"),
            translatorStatus: document.querySelector("[data-translator-status]"),
            translatorSubmit: document.querySelector('[data-action="translate-text"]'),
            translatorSpeak: document.querySelector('[data-action="speak-source"]'),
            translatorCopy: document.querySelector('[data-action="copy-translation"]'),
            languageMenu: document.querySelector("[data-translator-language-menu]"),
            languageTrigger: document.querySelector('[data-action="toggle-language-menu"]'),
            languagePopover: document.querySelector("[data-language-popover]"),
            languageOptions: Array.from(document.querySelectorAll("[data-language-option]")),
            languageCurrent: document.querySelector("[data-language-current]"),
            customLanguageInput: document.querySelector("[data-language-custom-input]"),
            customLanguageButton: document.querySelector('[data-action="select-custom-language"]'),
        };
    }

    function getDefaultCity(dom) {
        return {
            id: dom.body.dataset.defaultCityId || DEFAULT_CITY.id,
            name: dom.body.dataset.defaultCityName || DEFAULT_CITY.name,
        };
    }

    function getDefaultSearchEngine(dom) {
        const candidate = dom.body.dataset.defaultSearchEngine || DEFAULT_SEARCH_ENGINE;
        return SEARCH_ENDPOINTS[candidate] ? candidate : DEFAULT_SEARCH_ENGINE;
    }

    function bindEvents(dom, state) {
        document.addEventListener("click", (event) => {
            if (dom.languageMenu && !dom.languageMenu.contains(event.target)) {
                closeLanguageMenu(dom);
            }

            const themeButton = event.target.closest("[data-theme-step]");
            if (themeButton) {
                cycleTheme(Number(themeButton.dataset.themeStep || "1"), dom, state);
                return;
            }

            const cityOpenButton = event.target.closest("[data-open-city-modal]");
            if (cityOpenButton) {
                openCityModal(dom);
                return;
            }

            const cityItem = event.target.closest("[data-city-id]");
            if (cityItem) {
                selectCity(cityItem.dataset.cityName, cityItem.dataset.cityId, dom, state);
                return;
            }

            const visibilityButton = event.target.closest('[data-action="toggle-visibility"]');
            if (visibilityButton) {
                const category = visibilityButton.closest(".category");
                category.classList.toggle("is-collapsed");
                return;
            }

            const editModeButton = event.target.closest('[data-action="toggle-edit"]');
            if (editModeButton) {
                const category = editModeButton.closest(".category");
                void toggleEditMode(category);
                return;
            }

            const editButton = event.target.closest('[data-action="edit-site"]');
            if (editButton) {
                const card = editButton.closest(".site-card");
                openEditModal({ card, category: null }, dom, state);
                return;
            }

            const addButton = event.target.closest('[data-action="add-site"]');
            if (addButton) {
                openEditModal({ card: null, category: addButton.closest(".category") }, dom, state);
                return;
            }

            const deleteButton = event.target.closest('[data-action="delete-site"]');
            if (deleteButton) {
                const card = deleteButton.closest(".site-card");
                if (card && window.confirm("确定要删除这个网站吗？")) {
                    card.remove();
                }
                return;
            }

            const saveNoteButton = event.target.closest('[data-action="save-note"]');
            if (saveNoteButton) {
                void saveNote(dom, state);
                return;
            }

            const translatorToggleButton = event.target.closest('[data-action="toggle-translator"]');
            if (translatorToggleButton) {
                toggleTranslator(dom);
                return;
            }

            const translatorHeader = event.target.closest(".translator-header");
            if (translatorHeader) {
                toggleTranslator(dom);
                return;
            }

            const languageToggleButton = event.target.closest('[data-action="toggle-language-menu"]');
            if (languageToggleButton) {
                toggleLanguageMenu(dom);
                return;
            }

            const languageOption = event.target.closest("[data-language-option]");
            if (languageOption) {
                setTranslatorTarget(languageOption.dataset.languageOption, dom, state);
                closeLanguageMenu(dom);
                return;
            }

            const customLanguageButton = event.target.closest('[data-action="select-custom-language"]');
            if (customLanguageButton) {
                selectCustomLanguage(dom, state);
                return;
            }

            const speakSourceButton = event.target.closest('[data-action="speak-source"]');
            if (speakSourceButton) {
                void speakTranslatorSource(dom, state);
                return;
            }

            const translateButton = event.target.closest('[data-action="translate-text"]');
            if (translateButton) {
                void translateText(dom, state);
                return;
            }

            const copyTranslationButton = event.target.closest('[data-action="copy-translation"]');
            if (copyTranslationButton) {
                void copyTranslation(dom, state);
                return;
            }

            const cancelEditButton = event.target.closest('[data-action="cancel-site"]');
            if (cancelEditButton) {
                closeEditModal(dom, state);
                return;
            }

            const saveSiteButton = event.target.closest('[data-action="save-site"]');
            if (saveSiteButton) {
                saveSiteEdit(dom, state);
                return;
            }

            const closeModalButton = event.target.closest("[data-close-modal]");
            if (closeModalButton) {
                closeModal(closeModalButton.dataset.closeModal, dom, state);
            }
        });

        document.addEventListener("keydown", (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && dom.translator?.contains(event.target)) {
                event.preventDefault();
                void translateText(dom, state);
                return;
            }

            if (event.key === "Enter" && event.target === dom.customLanguageInput) {
                event.preventDefault();
                selectCustomLanguage(dom, state);
                return;
            }

            if (event.key !== "Escape") {
                return;
            }
            closeLanguageMenu(dom);
            if (!dom.editModal.hidden) {
                closeEditModal(dom, state);
            }
            if (!dom.cityModal.hidden) {
                closeCityModal(dom, state);
            }
        });

        document.addEventListener("dragstart", (event) => {
            const card = event.target.closest(".site-card");
            if (!card) {
                return;
            }
            const category = card.closest(".category");
            if (!category || !category.classList.contains("edit-mode")) {
                event.preventDefault();
                return;
            }

            state.dragCard = card;
            card.classList.add("dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", card.querySelector("a")?.textContent || "");
        });

        document.addEventListener("dragend", () => {
            clearDragState(state);
        });

        dom.siteGrids.forEach((grid) => {
            grid.addEventListener("dragover", (event) => handleGridDragOver(event, state));
            grid.addEventListener("drop", (event) => {
                event.preventDefault();
                commitDragTarget(event.currentTarget, state);
                hideGridIndicator(event.currentTarget);
            });
        });

        dom.searchForm.addEventListener("submit", (event) => {
            event.preventDefault();
            openSearch(dom.searchInput.value, state.defaultSearchEngine);
        });

        dom.searchForm.addEventListener("click", (event) => {
            const button = event.target.closest("[data-engine]");
            if (!button) {
                return;
            }
            openSearch(dom.searchInput.value, button.dataset.engine);
        });

        dom.citySearchInput.addEventListener("input", (event) => {
            scheduleCitySearch(event.target.value, dom, state);
        });

        dom.editModal.addEventListener("click", (event) => {
            if (event.target === dom.editModal) {
                closeEditModal(dom, state);
            }
        });

        dom.cityModal.addEventListener("click", (event) => {
            if (event.target === dom.cityModal) {
                closeCityModal(dom, state);
            }
        });

        window.addEventListener("resize", () => {
            dom.siteGrids.forEach(hideGridIndicator);
        });
    }

    function initTheme(dom, state) {
        const urlTheme = new URL(window.location.href).searchParams.get("theme");
        const storedTheme = localStorage.getItem("navTheme");
        const fallbackTheme = dom.body.dataset.defaultTheme || "default";
        const initialTheme = [urlTheme, storedTheme, fallbackTheme].find((theme) => state.validThemes.has(theme)) || fallbackTheme;
        applyTheme(initialTheme, dom, state);
    }

    function applyTheme(themeId, dom, state) {
        if (!state.validThemes.has(themeId)) {
            return;
        }

        state.currentTheme = themeId;
        dom.body.dataset.theme = themeId;
        document.documentElement.style.colorScheme = themeId === "midnight" ? "dark" : "light";
        localStorage.setItem("navTheme", themeId);
    }

    function cycleTheme(direction, dom, state) {
        if (!state.themeOrder.length) {
            return;
        }
        const currentIndex = Math.max(0, state.themeOrder.indexOf(state.currentTheme || dom.body.dataset.defaultTheme || state.themeOrder[0]));
        const nextIndex = (currentIndex + direction + state.themeOrder.length) % state.themeOrder.length;
        applyTheme(state.themeOrder[nextIndex], dom, state);
    }

    function initBackground() {
        const loadBackground = () => {
            const image = new Image();
            image.src = "/static/images/background.jpg";
            image.onload = () => document.body.classList.add("bg-loaded");
        };

        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(loadBackground, { timeout: 1200 });
        } else {
            window.setTimeout(loadBackground, 180);
        }
    }

    function initClock(dom) {
        const render = () => {
            const now = new Date();
            const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
            dom.datetimeTime.textContent = now.toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            });
            dom.datetimeDate.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekDays[now.getDay()]}`;
        };

        render();
        window.setInterval(render, 1000);
    }

    function initWeather(dom, state) {
        updateWeatherLocationLabel(dom, state.currentCityName);
        void getWeather(dom, state);
        window.setInterval(() => {
            void getWeather(dom, state);
        }, 30 * 60 * 1000);
    }

    async function getWeather(dom, state) {
        try {
            const response = await fetch(`/api/weather?location=${encodeURIComponent(state.currentCityId)}`);
            const payload = await response.json();

            if (payload.code !== "200" || !payload.now) {
                throw new Error("获取天气信息失败");
            }

            dom.weatherTemp.textContent = `${payload.now.temp}°`;
            dom.weatherDesc.textContent = payload.now.text;
            dom.weatherIcon.textContent = resolveWeatherEmoji(payload.now.text);
            dom.weatherIcon.hidden = false;
        } catch (error) {
            console.error("获取天气信息失败:", error);
            dom.weatherTemp.textContent = "获取失败";
            dom.weatherDesc.textContent = "请稍后重试";
            dom.weatherIcon.hidden = true;
        }
    }

    function resolveWeatherEmoji(text) {
        if (text.includes("晴")) {
            return "☀️";
        }
        if (text.includes("多云")) {
            return "⛅️";
        }
        if (text.includes("阴")) {
            return "☁️";
        }
        if (text.includes("雨")) {
            return "🌧️";
        }
        if (text.includes("雪")) {
            return "🌨️";
        }
        if (text.includes("雾")) {
            return "🌫️";
        }
        if (text.includes("霾")) {
            return "😷";
        }
        return "🌤️";
    }

    function openCityModal(dom) {
        dom.cityModal.hidden = false;
        dom.citySearchInput.focus();
    }

    function closeCityModal(dom, state) {
        dom.cityModal.hidden = true;
        dom.citySearchInput.value = "";
        dom.cityList.innerHTML = "";
        if (state.citySearchController) {
            state.citySearchController.abort();
            state.citySearchController = null;
        }
        if (state.citySearchTimer) {
            window.clearTimeout(state.citySearchTimer);
            state.citySearchTimer = null;
        }
    }

    function scheduleCitySearch(keyword, dom, state) {
        if (state.citySearchTimer) {
            window.clearTimeout(state.citySearchTimer);
        }

        state.citySearchTimer = window.setTimeout(() => {
            void searchCities(keyword, dom, state);
        }, 220);
    }

    async function searchCities(keyword, dom, state) {
        const trimmed = keyword.trim();
        if (!trimmed) {
            dom.cityList.innerHTML = "";
            return;
        }

        if (state.citySearchController) {
            state.citySearchController.abort();
        }

        state.citySearchController = new AbortController();
        dom.cityList.innerHTML = '<div class="city-empty">搜索中...</div>';

        try {
            const response = await fetch(`/api/city-search?keyword=${encodeURIComponent(trimmed)}`, {
                signal: state.citySearchController.signal,
            });
            const payload = await response.json();

            if (payload.code !== "200" || !Array.isArray(payload.location) || payload.location.length === 0) {
                dom.cityList.innerHTML = '<div class="city-empty">没有找到匹配城市</div>';
                return;
            }

            const fragment = document.createDocumentFragment();
            payload.location.forEach((city) => {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "city-item";
                item.dataset.cityId = city.id;
                item.dataset.cityName = city.name;
                item.innerHTML = `<span>${city.name}</span><small>${city.adm2 || city.adm1 || ""}</small>`;
                fragment.appendChild(item);
            });

            dom.cityList.innerHTML = "";
            dom.cityList.appendChild(fragment);
        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }
            console.error("搜索城市失败:", error);
            dom.cityList.innerHTML = '<div class="city-empty">搜索失败，请稍后重试</div>';
        }
    }

    function selectCity(cityName, cityId, dom, state) {
        state.currentCityId = cityId;
        state.currentCityName = cityName;
        localStorage.setItem("weatherCityId", cityId);
        localStorage.setItem("weatherCityName", cityName);
        updateWeatherLocationLabel(dom, cityName);
        closeCityModal(dom, state);
        void getWeather(dom, state);
    }

    function updateWeatherLocationLabel(dom, cityName) {
        dom.weatherLocation.textContent = cityName;
    }

    function openSearch(keyword, engine) {
        const trimmed = keyword.trim();
        if (!trimmed || !SEARCH_ENDPOINTS[engine]) {
            return;
        }
        window.open(`${SEARCH_ENDPOINTS[engine]}${encodeURIComponent(trimmed)}`, "_blank", "noopener");
    }

    function toggleTranslator(dom) {
        if (!dom.translator || !dom.translatorToggle) {
            return;
        }

        const isCollapsed = dom.translator.classList.toggle("is-collapsed");
        dom.translatorToggle.setAttribute("aria-expanded", String(!isCollapsed));
        if (!isCollapsed) {
            window.setTimeout(() => dom.translatorSource?.focus(), 0);
        }
    }

    function initTranslatorTarget(dom, state) {
        setTranslatorTarget(state.translatorTarget, dom, state, { persist: false, close: false });
    }

    function toggleLanguageMenu(dom) {
        if (!dom.languagePopover || !dom.languageMenu || !dom.languageTrigger) {
            return;
        }

        const shouldOpen = dom.languagePopover.hidden;
        dom.languagePopover.hidden = !shouldOpen;
        dom.languageMenu.classList.toggle("is-open", shouldOpen);
        dom.languageTrigger.setAttribute("aria-expanded", String(shouldOpen));
        if (shouldOpen) {
            window.setTimeout(() => dom.customLanguageInput?.focus(), 0);
        }
    }

    function closeLanguageMenu(dom) {
        if (!dom.languagePopover || !dom.languageMenu || !dom.languageTrigger) {
            return;
        }

        dom.languagePopover.hidden = true;
        dom.languageMenu.classList.remove("is-open");
        dom.languageTrigger.setAttribute("aria-expanded", "false");
    }

    function setTranslatorTarget(target, dom, state, options = {}) {
        const normalized = String(target || "").trim() || DEFAULT_TRANSLATOR_TARGET;
        const persist = options.persist !== false;
        state.translatorTarget = normalized;
        if (persist) {
            localStorage.setItem(TRANSLATOR_TARGET_STORAGE_KEY, normalized);
        }
        if (dom.languageCurrent) {
            dom.languageCurrent.textContent = normalized;
        }
        if (dom.languageTrigger) {
            dom.languageTrigger.title = `译文目标：${normalized}`;
        }

        const presetValues = new Set(dom.languageOptions.map((button) => button.dataset.languageOption));
        dom.languageOptions.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.languageOption === normalized);
        });
        if (dom.customLanguageInput && !presetValues.has(normalized)) {
            dom.customLanguageInput.value = normalized;
        }
        if (dom.customLanguageButton) {
            dom.customLanguageButton.classList.toggle("is-active", !presetValues.has(normalized));
        }
    }

    function selectCustomLanguage(dom, state) {
        const customTarget = dom.customLanguageInput?.value.trim() || "";
        if (!customTarget) {
            dom.customLanguageInput?.focus();
            return;
        }

        setTranslatorTarget(customTarget, dom, state);
        closeLanguageMenu(dom);
    }

    async function speakTranslatorSource(dom, state) {
        if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
            setTranslatorStatus(dom, "当前浏览器不支持朗读", "error");
            return;
        }

        if (state.sourceUtterance) {
            window.speechSynthesis.cancel();
            clearSourceSpeechState(dom, state);
            return;
        }

        const source = dom.translatorSource?.value.trim() || "";
        if (!source) {
            setTranslatorStatus(dom, "请输入要朗读的原文", "error");
            dom.translatorSource?.focus();
            return;
        }

        window.speechSynthesis.cancel();

        const language = guessSpeechLanguage(source);
        const utterance = new SpeechSynthesisUtterance(source);
        const voice = chooseSpeechVoice(await loadSpeechVoices(), language);
        utterance.lang = voice?.lang || language;
        utterance.voice = voice || null;
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onend = () => {
            if (state.sourceUtterance === utterance) {
                clearSourceSpeechState(dom, state);
            }
        };
        utterance.onerror = (event) => {
            if (event.error === "interrupted" || event.error === "canceled") {
                return;
            }
            if (state.sourceUtterance !== utterance) {
                return;
            }
            clearSourceSpeechState(dom, state);
            setTranslatorStatus(dom, "朗读失败，请换一个浏览器语音试试", "error");
        };

        state.sourceUtterance = utterance;
        setSourceSpeakButtonState(dom, true);
        window.speechSynthesis.speak(utterance);
    }

    function loadSpeechVoices() {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length) {
            return Promise.resolve(voices);
        }

        return new Promise((resolve) => {
            const done = () => {
                window.speechSynthesis.removeEventListener("voiceschanged", done);
                resolve(window.speechSynthesis.getVoices());
            };
            window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
            window.setTimeout(done, 220);
        });
    }

    function clearSourceSpeechState(dom, state) {
        state.sourceUtterance = null;
        setSourceSpeakButtonState(dom, false);
    }

    function setSourceSpeakButtonState(dom, isSpeaking) {
        if (!dom.translatorSpeak) {
            return;
        }

        dom.translatorSpeak.dataset.speaking = String(isSpeaking);
        dom.translatorSpeak.title = isSpeaking ? "停止朗读" : "朗读原文";
        dom.translatorSpeak.setAttribute("aria-label", isSpeaking ? "停止朗读原文" : "朗读原文");
    }

    function guessSpeechLanguage(text) {
        if (/[\u3040-\u30ff]/.test(text)) {
            return "ja-JP";
        }
        if (/[\uac00-\ud7af]/.test(text)) {
            return "ko-KR";
        }
        if (/[\u4e00-\u9fff]/.test(text)) {
            return "zh-CN";
        }
        if (/[\u0400-\u04ff]/.test(text)) {
            return "ru-RU";
        }
        if (/[\u0600-\u06ff]/.test(text)) {
            return "ar-XA";
        }
        if (/[\u0900-\u097f]/.test(text)) {
            return "hi-IN";
        }
        return "en-US";
    }

    function chooseSpeechVoice(voices, language) {
        if (!voices.length) {
            return null;
        }

        const baseLanguage = language.split("-")[0].toLowerCase();
        const preferredNames = [
            "samantha",
            "alex",
            "ava",
            "allison",
            "susan",
            "daniel",
            "serena",
            "karen",
            "moira",
            "ting-ting",
            "mei-jia",
            "kyoko",
            "otoya",
            "yuna",
            "microsoft aria",
            "microsoft xiaoxiao",
            "google us english",
            "google uk english",
            "google 普通话",
        ];
        const oddVoicePattern = /(compact|novelty|robot|zarvox|trinoids|boing|bubbles|bells|cellos|whisper|bad news|good news|pipe organ)/i;

        return voices
            .map((voice) => {
                const voiceLanguage = String(voice.lang || "").toLowerCase();
                const voiceName = String(voice.name || "").toLowerCase();
                const exactLanguage = voiceLanguage === language.toLowerCase();
                const sameBaseLanguage = voiceLanguage.split("-")[0] === baseLanguage;
                let score = 0;
                if (exactLanguage) score += 80;
                if (sameBaseLanguage) score += 55;
                if (voice.localService) score += 12;
                preferredNames.forEach((name, index) => {
                    if (voiceName.includes(name)) {
                        score += 35 - Math.min(index, 20);
                    }
                });
                if (oddVoicePattern.test(voice.name || "")) score -= 120;
                return { voice, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.voice || null;
    }

    async function translateText(dom, state) {
        if (state.isTranslating || !dom.translatorSource || !dom.translatorOutput) {
            return;
        }

        const source = dom.translatorSource.value.trim();
        const context = dom.translatorContext?.value.trim() || "";
        if (!source) {
            setTranslatorStatus(dom, "请输入要翻译的原文", "error");
            dom.translatorSource.focus();
            return;
        }

        state.isTranslating = true;
        dom.translatorSubmit.disabled = true;
        dom.translatorCopy.disabled = true;
        setTranslatorStatus(dom, "翻译中...");

        try {
            const response = await fetch("/api/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source, context, targetLanguage: state.translatorTarget || DEFAULT_TRANSLATOR_TARGET }),
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || payload.success === false) {
                throw new Error(payload.message || "翻译失败，请稍后重试");
            }

            state.lastTranslation = payload.translation || "";
            dom.translatorOutput.classList.remove("is-placeholder");
            dom.translatorOutput.innerHTML = renderMarkdown(state.lastTranslation);
            dom.translatorCopy.disabled = !state.lastTranslation;
            setTranslatorStatus(dom, "已完成", "success");
        } catch (error) {
            console.error("翻译失败:", error);
            setTranslatorStatus(dom, error.message || "翻译失败，请稍后重试", "error");
            dom.translatorCopy.disabled = !state.lastTranslation;
        } finally {
            state.isTranslating = false;
            dom.translatorSubmit.disabled = false;
        }
    }

    async function copyTranslation(dom, state) {
        if (!state.lastTranslation) {
            return;
        }

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(state.lastTranslation);
            } else {
                fallbackCopy(state.lastTranslation);
            }
            setTranslatorStatus(dom, "已复制", "success");
        } catch (error) {
            console.error("复制失败:", error);
            setTranslatorStatus(dom, "复制失败，请手动选择译文", "error");
        }
    }

    function fallbackCopy(text) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
    }

    function setTranslatorStatus(dom, message, type = "") {
        if (!dom.translatorStatus) {
            return;
        }

        dom.translatorStatus.textContent = message;
        dom.translatorStatus.classList.toggle("is-error", type === "error");
        dom.translatorStatus.classList.toggle("is-success", type === "success");
    }

    function renderMarkdown(markdown) {
        const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
        const html = [];
        let paragraph = [];
        let listType = "";
        let listItems = [];
        let inCodeBlock = false;
        let codeLines = [];

        const flushParagraph = () => {
            if (!paragraph.length) {
                return;
            }
            html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
            paragraph = [];
        };

        const flushList = () => {
            if (!listItems.length) {
                return;
            }
            html.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
            listType = "";
            listItems = [];
        };

        lines.forEach((line) => {
            const trimmed = line.trim();

            if (trimmed.startsWith("```")) {
                flushParagraph();
                flushList();
                if (inCodeBlock) {
                    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
                    codeLines = [];
                    inCodeBlock = false;
                } else {
                    inCodeBlock = true;
                }
                return;
            }

            if (inCodeBlock) {
                codeLines.push(line);
                return;
            }

            if (!trimmed) {
                flushParagraph();
                flushList();
                return;
            }

            const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
            if (headingMatch) {
                flushParagraph();
                flushList();
                const level = headingMatch[1].length;
                html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
                return;
            }

            const quoteMatch = trimmed.match(/^>\s?(.+)$/);
            if (quoteMatch) {
                flushParagraph();
                flushList();
                html.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1])}</blockquote>`);
                return;
            }

            const listMatch = trimmed.match(/^([-*+]|\d+\.)\s+(.+)$/);
            if (listMatch) {
                flushParagraph();
                const nextType = /^\d+\.$/.test(listMatch[1]) ? "ol" : "ul";
                if (listType && listType !== nextType) {
                    flushList();
                }
                listType = nextType;
                listItems.push(listMatch[2]);
                return;
            }

            flushList();
            paragraph.push(line);
        });

        if (inCodeBlock) {
            html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        }
        flushParagraph();
        flushList();

        return html.join("") || '<p class="is-placeholder">没有收到译文。</p>';
    }

    function renderInlineMarkdown(text) {
        return escapeHtml(text)
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, url) => {
                return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${label}</a>`;
            })
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function escapeAttribute(value) {
        return String(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    async function loadNote(dom) {
        try {
            const response = await fetch("/api/note");
            const payload = await response.json();
            dom.noteTextarea.value = payload.content || "";
        } catch (error) {
            console.error("加载便签失败:", error);
        }
    }

    async function saveNote(dom, state) {
        if (state.isSavingNote) {
            return;
        }

        state.isSavingNote = true;
        dom.noteSaveButton.classList.remove("is-saved", "is-error");

        try {
            const response = await fetch("/api/note", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: dom.noteTextarea.value }),
            });

            if (!response.ok) {
                throw new Error("保存失败");
            }

            dom.noteSaveButton.classList.add("is-saved");
        } catch (error) {
            console.error("保存便签失败:", error);
            dom.noteSaveButton.classList.add("is-error");
        } finally {
            window.setTimeout(() => {
                dom.noteSaveButton.classList.remove("is-saved", "is-error");
                state.isSavingNote = false;
            }, 600);
        }
    }

    async function toggleEditMode(category) {
        if (!category) {
            return;
        }

        const isEditing = category.classList.contains("edit-mode");
        if (!isEditing) {
            category.classList.add("edit-mode");
            category.querySelectorAll(".site-card").forEach((card) => {
                card.draggable = true;
            });
            return;
        }

        if (!window.confirm("是否保存更改？")) {
            window.location.reload();
            return;
        }

        const websites = collectWebsitesData();

        try {
            const response = await fetch("/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(websites),
            });
            const payload = await response.json();
            if (payload.status !== "success") {
                throw new Error(payload.message || "保存失败");
            }
            window.location.reload();
        } catch (error) {
            console.error("保存失败:", error);
            window.alert(`保存失败: ${error.message}`);
        }
    }

    function openEditModal({ card, category }, dom, state) {
        state.currentEditCard = card;
        state.currentCategory = category;
        dom.editModalTitle.textContent = card ? "编辑网站" : "添加网站";

        if (card) {
            const link = card.querySelector("a");
            dom.editNameInput.value = link?.textContent?.trim() || "";
            dom.editUrlInput.value = link?.getAttribute("href") || "";
        } else {
            dom.editNameInput.value = "";
            dom.editUrlInput.value = "";
        }

        dom.editModal.hidden = false;
        dom.editNameInput.focus();
    }

    function closeEditModal(dom, state) {
        dom.editModal.hidden = true;
        state.currentEditCard = null;
        state.currentCategory = null;
    }

    function closeModal(modalName, dom, state) {
        if (modalName === "edit") {
            closeEditModal(dom, state);
        }
        if (modalName === "city") {
            closeCityModal(dom, state);
        }
    }

    function saveSiteEdit(dom, state) {
        const name = dom.editNameInput.value.trim();
        const url = dom.editUrlInput.value.trim();

        if (!name || !url) {
            window.alert("请填写完整的网站名称和地址");
            return;
        }

        if (state.currentEditCard) {
            const link = state.currentEditCard.querySelector("a");
            link.textContent = name;
            link.setAttribute("href", url);
        } else if (state.currentCategory) {
            const grid = state.currentCategory.querySelector(".sites-grid");
            const newCard = createSiteCard(name, url, state.currentCategory.classList.contains("edit-mode"));
            grid.appendChild(newCard);
        }

        closeEditModal(dom, state);
    }

    function createSiteCard(name, url, isDraggable) {
        const card = document.createElement("div");
        card.className = "site-card";
        card.draggable = isDraggable;

        const link = document.createElement("a");
        link.target = "_blank";
        link.rel = "noreferrer";
        link.href = url;
        link.textContent = name;

        const actions = document.createElement("div");
        actions.className = "card-actions";
        actions.innerHTML = [
            '<button type="button" class="card-action edit-btn" data-action="edit-site" title="编辑" aria-label="编辑">',
            '<svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20">',
            '<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>',
            "</svg>",
            "</button>",
            '<button type="button" class="card-action delete-btn" data-action="delete-site" title="删除" aria-label="删除">',
            '<svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20">',
            '<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>',
            "</svg>",
            "</button>",
        ].join("");

        card.append(link, actions);
        return card;
    }

    function ensureDragIndicators() {
        document.querySelectorAll(".sites-grid").forEach((grid) => {
            if (grid.querySelector(".drag-indicator")) {
                return;
            }
            const indicator = document.createElement("div");
            indicator.className = "drag-indicator";
            grid.appendChild(indicator);
        });
    }

    function handleGridDragOver(event, state) {
        const grid = event.currentTarget;
        const category = grid.closest(".category");
        if (!state.dragCard || !category || !category.classList.contains("edit-mode")) {
            return;
        }

        event.preventDefault();
        const indicator = grid.querySelector(".drag-indicator");
        const insertionTarget = getInsertionTarget(grid, event.clientX, event.clientY);
        state.dragTarget = insertionTarget ? { ...insertionTarget, grid } : { grid, element: null, placeAfter: true };

        if (!insertionTarget) {
            indicator.style.display = "none";
            return;
        }

        const { element: closestCard, placeAfter } = insertionTarget;
        const cardRect = closestCard.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();

        indicator.style.display = "block";
        indicator.style.height = `${cardRect.height}px`;
        indicator.style.left = `${(placeAfter ? cardRect.right : cardRect.left) - gridRect.left}px`;
        indicator.style.top = `${cardRect.top - gridRect.top}px`;
    }

    function getInsertionTarget(container, x, y) {
        const cards = Array.from(container.querySelectorAll(".site-card:not(.dragging)"));
        const rows = getCardRows(cards);
        if (!rows.length) {
            return null;
        }

        const targetRow = rows.reduce((closest, row) => {
            const distance = Math.abs(y - row.centerY);
            return distance < closest.distance ? { distance, row } : closest;
        }, { distance: Number.POSITIVE_INFINITY, row: null }).row;
        const rowCards = targetRow.cards;
        const beforeCard = rowCards.find(({ centerX }) => x < centerX);

        if (beforeCard) {
            return { element: beforeCard.element, placeAfter: false };
        }

        return { element: rowCards[rowCards.length - 1].element, placeAfter: true };
    }

    function getCardRows(cards) {
        return cards
            .map((element) => {
                const box = element.getBoundingClientRect();
                return {
                    element,
                    box,
                    centerX: box.left + box.width / 2,
                    centerY: box.top + box.height / 2,
                };
            })
            .sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX)
            .reduce((rows, card) => {
                const row = rows[rows.length - 1];
                const rowThreshold = Math.max(6, card.box.height / 2);
                if (!row || Math.abs(card.centerY - row.centerY) > rowThreshold) {
                    rows.push({ centerY: card.centerY, cards: [card] });
                    return rows;
                }

                row.cards.push(card);
                row.centerY = row.cards.reduce((sum, item) => sum + item.centerY, 0) / row.cards.length;
                row.cards.sort((a, b) => a.centerX - b.centerX);
                return rows;
            }, []);
    }

    function commitDragTarget(grid, state) {
        if (!state.dragCard) {
            return;
        }

        const target = state.dragTarget?.grid === grid ? state.dragTarget : null;
        if (!target?.element || target.element.parentNode !== grid) {
            grid.appendChild(state.dragCard);
            return;
        }

        if (target.placeAfter) {
            if (state.dragCard.previousElementSibling !== target.element) {
                grid.insertBefore(state.dragCard, target.element.nextSibling);
            }
            return;
        }

        if (state.dragCard.nextElementSibling !== target.element) {
            grid.insertBefore(state.dragCard, target.element);
        }
    }

    function hideGridIndicator(grid) {
        const indicator = grid.querySelector(".drag-indicator");
        if (indicator) {
            indicator.style.display = "none";
        }
    }

    function clearDragState(state) {
        if (state.dragCard) {
            state.dragCard.classList.remove("dragging");
        }
        document.querySelectorAll(".drag-indicator").forEach((indicator) => {
            indicator.style.display = "none";
        });
        state.dragCard = null;
        state.dragTarget = null;
    }

    function collectWebsitesData() {
        const websites = {};

        document.querySelectorAll(".category").forEach((category) => {
            const categoryName = category.querySelector(".category-title")?.textContent?.trim();
            const grid = category.querySelector(".sites-grid");
            if (!categoryName || !grid) {
                return;
            }

            if (category.classList.contains("no-subcategory")) {
                websites[categoryName] = Array.from(grid.querySelectorAll(".site-card")).map((card) => {
                    const link = card.querySelector("a");
                    return {
                        name: link?.textContent?.trim() || "",
                        url: link?.getAttribute("href") || "",
                    };
                });
                return;
            }

            const grouped = {};
            let currentSubcategory = "";
            Array.from(grid.children).forEach((element) => {
                if (element.classList.contains("subcategory-card")) {
                    currentSubcategory = element.textContent.trim();
                    grouped[currentSubcategory] = [];
                    return;
                }
                if (element.classList.contains("site-card") && currentSubcategory) {
                    const link = element.querySelector("a");
                    grouped[currentSubcategory].push({
                        name: link?.textContent?.trim() || "",
                        url: link?.getAttribute("href") || "",
                    });
                }
            });

            websites[categoryName] = grouped;
        });

        return websites;
    }

})();
