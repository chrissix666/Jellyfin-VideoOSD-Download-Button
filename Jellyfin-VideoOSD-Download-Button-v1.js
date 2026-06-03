(function () {
    'use strict';

    const ADDON_ID = 'downloadButton';
    const ADDON_NAME = 'Download Button';

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



    const getCurrentVideoId = () => {
        const ratingBtn = document.querySelector('#videoOsdPage:not(.hide) .btnUserRating');

        if (ratingBtn && ratingBtn.dataset && ratingBtn.dataset.id) {
            return ratingBtn.dataset.id;
        }

        console.warn('Could not find current video ID');
        return null;
    };



    const downloadCurrentVideo = () => {
        const id = getCurrentVideoId();
        if (!id || !window.ApiClient) return;

        const downloadUrl =
            `${ApiClient.serverAddress()}/Items/${id}/Download?api_key=${ApiClient.accessToken()}`;

        console.log('Downloading video from', downloadUrl);

        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = '';
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };



    const ensureBtn = () => {
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btnDownload autoSize paper-icon-button-light';
            btn.title = 'Download Video';

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
            container.insertBefore(ensureBtn(), favBtn);
        }

        return true;
    };

    const enable = () => {
        if (enabled) return;

        enabled = true;

        observer = new MutationObserver(() => {
            injectButton();
            checkVideoChange();
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

        console.log('[Jellyfin Download Button] Registered with Customs.');

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

        console.log('[Jellyfin Download Button] Script loaded.');
    };

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, {
            once: true
        });
    }

})();
