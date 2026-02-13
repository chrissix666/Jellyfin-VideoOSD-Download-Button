(function () {
    'use strict';

    let btn = null;
    let lastVideoId = null;

    /**********************
     * GET CURRENT VIDEO ID
     **********************/
    const getCurrentVideoId = () => {
        const btn = document.querySelector('#videoOsdPage:not(.hide) .btnUserRating');
        if (btn && btn.dataset && btn.dataset.id) {
            return btn.dataset.id;
        }
        console.warn('Could not find current video ID');
        return null;
    };

    /**********************
     * DOWNLOAD CURRENT VIDEO
     * (no playback interruption)
     **********************/
    const downloadCurrentVideo = () => {
        const id = getCurrentVideoId();
        if (!id || !window.ApiClient) return;

        const downloadUrl =
            `${ApiClient.serverAddress()}/Items/${id}/Download?api_key=${ApiClient.accessToken()}`;

        console.log('Downloading video from', downloadUrl);

        // Hintergrund-Download ohne Navigation
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = '';
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    /**********************
     * BUTTON
     **********************/
    const ensureBtn = () => {
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btnDownload autoSize paper-icon-button-light';
            btn.title = 'Download Video';

            const icon = document.createElement('span');
            icon.className = 'xlargePaperIconButton material-symbols-outlined';
            icon.textContent = 'download';
            btn.appendChild(icon);

            btn.addEventListener('click', downloadCurrentVideo);
        }
        return btn;
    };

    /**********************
     * VIDEO CHANGE DETECTION
     **********************/
    const checkVideoChange = () => {
        const id = getCurrentVideoId();
        if (id !== lastVideoId) {
            lastVideoId = id;
        }
    };

    /**********************
     * INJECT BUTTON
     **********************/
    const injectButton = () => {
        const favBtn = document.querySelector('.buttons.focuscontainer-x > .btnUserRating');
        if (!favBtn || !favBtn.parentNode) return false;
        const container = favBtn.parentNode;
        if (!container.querySelector('.btnDownload')) {
            container.insertBefore(ensureBtn(), favBtn);
        }
        return true;
    };

    const observer = new MutationObserver(() => {
        injectButton();
        checkVideoChange();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const pollInterval = setInterval(() => {
        if (injectButton()) clearInterval(pollInterval);
    }, 300);

    injectButton();
})();
