function dlIsSupportedPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = ['mobi', 'ipad', 'iphone', 'ipod', 'silk', 'opera mini'].some((term) => ua.includes(term));
    const isTv = ['tv', 'samsungbrowser', 'viera', 'web0s'].some((term) => ua.includes(term));
    const isTizen = ua.includes('tizen') || window.tizen != null;
    const isAndroid = ua.includes('android');
    const isIOS = ['ipad', 'iphone', 'ipod'].some((term) => ua.includes(term)) || (ua.includes('macintosh') && navigator.maxTouchPoints > 1);
    return !(isMobile || isTv || isTizen || isAndroid || isIOS);
}

(function () {
    'use strict';

    if (!dlIsSupportedPlatform()) return;

    // ---- PLUGIN ADAPTER: config source, retrofit for VideoOSD Tweaks and Candy ----
    const PLUGIN_GUID = '468b1980-7a6c-4e45-a129-24825085ece4';

    const CONFIG = {
        // ============================================================
        // == SHARED VALUES (both standalone and plugin usage) ==
        // None of these were configurable at all before this retrofit
        // (hide-on-narrow-window was a fixed CSS rule, and the
        // download was always the raw server filename with no
        // alternative). No dual-mode branch needed, same reasoning as
        // the other bottom-right mods. No Centered Gap field here:
        // corrected, General/Individual Centered Gap only ever
        // applies to the 3 bottom-left mods (A-B Loop, Speed,
        // FrameByFrame), never to Download/Screenshot in the
        // bottom-right zone.
        // ============================================================

        hideOnNarrowWindow: true,

        // 'original' | 'library'. Original script always behaved like
        // 'original' (a.download left empty, browser uses the
        // server's own Content-Disposition filename).
        filenameChoice: 'original',

        // Only relevant when filenameChoice is 'library'. Same
        // defaults and same colon-replacement/year logic as
        // Screenshot's identical setting, confirmed to be shared
        // 1:1 between the two mods.
        includeYearMovies: true,
        includeYearEpisodes: false,
        includeYearVideos: false
    };

    async function fetchPluginConfig() {
        const maxAttempts = 120;
        const delayMs = 250;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (window.ApiClient && typeof ApiClient.getPluginConfiguration === 'function') {
                try {
                    const config = await ApiClient.getPluginConfiguration(PLUGIN_GUID);
                    if (config) return config;
                } catch (err) {
                    // fall through, try again after the delay below
                }
            }
            await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
        }
        return null;
    }

    // FIX for a real, confirmed bug found via a faithful full-stack test
    // (all real scripts + real Jellyfin HTML together): this function was
    // CALLED at the bottom of this file (inside fetchPluginConfig()'s
    // .then), but never actually defined anywhere in it -- every other
    // addon in this project defines its own applyPluginConfig(), this
    // one simply lacked it. At runtime the call threw a ReferenceError
    // inside the promise chain (an unhandled rejection, easy to miss),
    // with the real consequence that ALL admin-configured Download
    // settings were silently ignored and the script permanently ran on
    // its standalone defaults, while the refreshResponsiveStyle() call
    // scheduled right after it never ran from that path either. Mapping
    // below mirrors the same pattern every other addon uses; guarded
    // per-field so a missing/partial config never wipes a default.
    function applyPluginConfig(pluginConfig) {
        if (!pluginConfig) {
            console.warn('[VideoOSD Download DEBUG] applyPluginConfig: pluginConfig is null/undefined');
            return;
        }

        console.warn('[VideoOSD Download DEBUG] applyPluginConfig called');
        console.warn('[VideoOSD Download DEBUG] filenameChoice:', pluginConfig.DownloadFilenameChoice, '| type:', typeof pluginConfig.DownloadFilenameChoice);
        console.warn('[VideoOSD Download DEBUG] includeYearMovies:', pluginConfig.DownloadIncludeYearMovies, '| type:', typeof pluginConfig.DownloadIncludeYearMovies);
        console.warn('[VideoOSD Download DEBUG] includeYearEpisodes:', pluginConfig.DownloadIncludeYearEpisodes, '| type:', typeof pluginConfig.DownloadIncludeYearEpisodes);
        console.warn('[VideoOSD Download DEBUG] includeYearVideos:', pluginConfig.DownloadIncludeYearVideos, '| type:', typeof pluginConfig.DownloadIncludeYearVideos);

        if (typeof pluginConfig.DownloadHideOnNarrowWindow === 'boolean') {
            CONFIG.hideOnNarrowWindow = pluginConfig.DownloadHideOnNarrowWindow;
        }
        if (typeof pluginConfig.DownloadFilenameChoice === 'string' && pluginConfig.DownloadFilenameChoice) {
            CONFIG.filenameChoice = pluginConfig.DownloadFilenameChoice;
        }
        if (typeof pluginConfig.DownloadIncludeYearMovies === 'boolean') {
            CONFIG.includeYearMovies = pluginConfig.DownloadIncludeYearMovies;
        }
        if (typeof pluginConfig.DownloadIncludeYearEpisodes === 'boolean') {
            CONFIG.includeYearEpisodes = pluginConfig.DownloadIncludeYearEpisodes;
        }
        if (typeof pluginConfig.DownloadIncludeYearVideos === 'boolean') {
            CONFIG.includeYearVideos = pluginConfig.DownloadIncludeYearVideos;
        }

        console.warn('[VideoOSD Download DEBUG] CONFIG after apply:', JSON.stringify({
            filenameChoice: CONFIG.filenameChoice,
            includeYearMovies: CONFIG.includeYearMovies,
            includeYearEpisodes: CONFIG.includeYearEpisodes,
            includeYearVideos: CONFIG.includeYearVideos
        }));
    }
    // ---- END PLUGIN ADAPTER ----

    const ADDON_ID = 'downloadButton';
    const ADDON_NAME = 'Download Button';
    const RESPONSIVE_STYLE_ID = 'downloadButtonResponsiveStyle';

    const CUSTOMS_API_NAME = 'JellyfinVideoOSDCustomsMenu';
    const CUSTOMS_WAIT_MS = 300;
    const CUSTOMS_WAIT_TRIES = 120;
    const CUSTOMS_STORAGE_KEY =
        CUSTOMS_API_NAME + '.addon.' + ADDON_ID;

    let btn = null;
    let lastVideoId = null;

    let observer = null;
    let pollInterval = null;
    let enabled = false;

    let registeredWithCustoms = false;
    let customsRegisterTimer = null;



    let ignoreStoredCustomsState = false;

    const isCustomsAvailable = () => {
        const api = window[CUSTOMS_API_NAME];
        return !!api && typeof api.registerAddon === 'function';
    };

    const isEnabledByCustomsState = () =>
        localStorage.getItem(CUSTOMS_STORAGE_KEY) !== 'false';

    // Renamed from ensureResponsiveStyle(): can now also remove the style,
    // not just add it, same pattern as the other retrofitted mods.
    const refreshResponsiveStyle = () => {
        const existing = document.getElementById(RESPONSIVE_STYLE_ID);
        if (!CONFIG.hideOnNarrowWindow) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const style = document.createElement('style');
        style.id = RESPONSIVE_STYLE_ID;
        style.textContent = `
        @media all and (max-width: 50em) {
            .videoOsdBottom .btnDownload { display: none !important; }
        }
        `;
        document.head.appendChild(style);
    };

    const getCurrentVideoId = () => {
        const ratingBtn = document.querySelector('#videoOsdPage:not(.hide) .btnUserRating');

        if (ratingBtn && ratingBtn.dataset && ratingBtn.dataset.id) {
            return ratingBtn.dataset.id;
        }

        // FIX for a real bug found live: this used to console.warn() here
        // unconditionally. checkVideoChange() below calls this on EVERY
        // single MutationObserver tick (any class/style change anywhere
        // on the page, which happens constantly during active playback,
        // e.g. the progress slider updates), so a legitimate, expected
        // "not available yet" moment (the OSD isn't showing, the rating
        // button hasn't received its data-id yet, etc.) was logging a
        // warning every single time, not just once. Confirmed live: over
        // 59,000 repetitions of this single warning during one browser
        // session, which is itself a serious performance problem (Chrome
        // buffers/processes that volume of console output even with
        // devtools closed), independent of and in addition to whatever
        // else it was cluttering. This return path is a normal, frequent,
        // expected outcome, not something worth logging at all.
        return null;
    };



    const sanitizeFilename = str =>
        str.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

    const getItemInfo = async (id) => {
        if (!window.ApiClient || !id) return null;
        try {
            const userId = ApiClient.getCurrentUserId();
            const item = await ApiClient.getItem(userId, id);
            if (!item) return null;

            let kind = 'video';
            if (item.Type === 'Movie') kind = 'movie';
            else if (item.Type === 'Episode') kind = 'episode';

            const includeYear = kind === 'movie' ? CONFIG.includeYearMovies
                : kind === 'episode' ? CONFIG.includeYearEpisodes
                : CONFIG.includeYearVideos;

            let label = item.Name || '';
            if (item.Type === 'Episode' && item.SeriesName) {
                const s = String(item.ParentIndexNumber || 1).padStart(2, '0');
                const e = String(item.IndexNumber || 1).padStart(2, '0');
                label = `${item.SeriesName} - S${s}E${e} - ${item.Name || ''}`;
            }
            if (includeYear && item.ProductionYear) {
                label += ` (${item.ProductionYear})`;
            }

            label = label.replace(/\s*:\s*/g, ' - ');
            label = sanitizeFilename(label);

            let extension = null;
            if (item.Path) {
                const m = item.Path.match(/\.([^./\\]+)$/);
                if (m) extension = m[1].toLowerCase();
            }

            return { label: label, extension: extension };
        } catch (err) {
            console.error('[VideoOSD Download Button] getItemInfo failed:', err);
            return null;
        }
    };

    // CHANGED: now async and reads CONFIG.filenameChoice. The 'original'
    // branch is completely untouched from the original script (same URL
    // construction, same a.download = '' relying on the server's
    // Content-Disposition header). The 'library' branch is entirely new,
    // using getItemInfo() above.
    const downloadCurrentVideo = async () => {
        const id = getCurrentVideoId();
        if (!id || !window.ApiClient) {
            console.warn('[VideoOSD Download DEBUG] downloadCurrentVideo: no id or no ApiClient', id);
            return;
        }

        console.warn('[VideoOSD Download DEBUG] downloadCurrentVideo: id =', id, '| filenameChoice =', CONFIG.filenameChoice);

        const downloadUrl =
            `${ApiClient.serverAddress()}/Items/${id}/Download?api_key=${ApiClient.accessToken()}`;

        const a = document.createElement('a');
        a.href = downloadUrl;

        if (CONFIG.filenameChoice === 'library') {
            const info = await getItemInfo(id);
            console.warn('[VideoOSD Download DEBUG] getItemInfo result:', JSON.stringify(info));
            a.download = (info && info.label)
                ? (info.extension ? `${info.label}.${info.extension}` : info.label)
                : '';
            console.warn('[VideoOSD Download DEBUG] a.download set to:', a.download);
        } else {
            a.download = '';
            console.warn('[VideoOSD Download DEBUG] original mode: a.download = empty');
        }

        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };



    const ensureBtn = () => {
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btnDownload autoSize paper-icon-button-light';
            btn.title = 'Download';

            const icon = document.createElement('span');
            icon.className = 'xlargePaperIconButton material-symbols-outlined';
            icon.textContent = 'download';
            btn.appendChild(icon);

            btn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                downloadCurrentVideo();
            });
        }

        return btn;
    };

    const removeButton = () => {
        if (btn) {
            btn.remove();
            btn = null;
        }
    };



    const checkVideoChange = () => {
        const id = getCurrentVideoId();

        if (id !== lastVideoId) {
            lastVideoId = id;
        }
    };



    const injectButton = () => {
        if (!enabled) return false;

        const favBtn = document.querySelector('.buttons.focuscontainer-x > .btnUserRating');
        if (!favBtn || !favBtn.parentNode) return false;

        const container = favBtn.parentNode;

        if (!container.querySelector('.btnDownload')) {
            refreshResponsiveStyle();
            const newBtn = ensureBtn();
            container.insertBefore(newBtn, favBtn);
        }

        return true;
    };

    const enable = () => {
        if (enabled) return;

        enabled = true;

        // FIX for a possible cause of a real, live-observed hang: this
        // observer watches the whole document.body subtree for any
        // style/class change, which fires constantly during active video
        // playback (Jellyfin's own progress bar updates style/class very
        // frequently), and it's one of 3 currently-enabled mods with an
        // essentially identical, independent observer, all reacting to
        // the same mutations simultaneously. Debounced to at most once
        // every 100ms: still responsive enough to catch newly inserted
        // elements quickly, but coalesces a rapid burst of many mutations
        // into a single actual check instead of running the callback
        // hundreds or thousands of times per second.
        let debounceTimer = null;
        observer = new MutationObserver(() => {
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                injectButton();
                checkVideoChange();
            }, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        pollInterval = setInterval(() => {
            if (injectButton()) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        }, 300);

        injectButton();
    };

    const disable = () => {
        if (!enabled) return;

        enabled = false;

        if (observer) {
            observer.disconnect();
            observer = null;
        }

        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        removeButton();
        lastVideoId = null;
    };

    const tryRegisterWithCustoms = () => {
        if (registeredWithCustoms) return false;

        const api = window[CUSTOMS_API_NAME];

        if (!api || typeof api.registerAddon !== 'function') {
            return false;
        }

        registeredWithCustoms = true;

        if (localStorage.getItem(CUSTOMS_STORAGE_KEY) === null) {
            localStorage.setItem(CUSTOMS_STORAGE_KEY, 'true');
        }

        api.registerAddon({
            id: ADDON_ID,
            name: ADDON_NAME,

            enable() {
                ignoreStoredCustomsState = false;
                enable();
            },

            disable() {
                ignoreStoredCustomsState = false;
                disable();
            }
        });

        if (!ignoreStoredCustomsState) {
            if (isEnabledByCustomsState()) {
                enable();
            } else {
                disable();
            }
        } else {
            enable();
        }


        return true;
    };

    const startCustomsRegistrationWatcher = () => {
        tryRegisterWithCustoms();

        if (registeredWithCustoms) return;

        let tries = 0;

        customsRegisterTimer = setInterval(() => {
            tries += 1;
            tryRegisterWithCustoms();

            if (registeredWithCustoms || tries >= CUSTOMS_WAIT_TRIES) {
                clearInterval(customsRegisterTimer);
                customsRegisterTimer = null;
            }
        }, CUSTOMS_WAIT_MS);
    };

    const start = () => {
        if (isCustomsAvailable()) {
            ignoreStoredCustomsState = false;
            tryRegisterWithCustoms();
        } else {
            ignoreStoredCustomsState = true;
            enable();
        }

        startCustomsRegistrationWatcher();

        console.log('[VideoOSD Download Button] Script loaded.');
    };

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, {
            once: true
        });
    }

    // ---- PLUGIN ADAPTER: apply fetched config once it arrives ----
    fetchPluginConfig().then(function (pluginConfig) {
        applyPluginConfig(pluginConfig);
        refreshResponsiveStyle();
    }).catch(function (err) {
        console.error('[VideoOSD Download Button] config apply failed:', err);
    });
    // ---- END PLUGIN ADAPTER ----

})();
