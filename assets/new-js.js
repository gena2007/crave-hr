// Keep the desktop landing-page zoom synced after page load with debouncing.
(function () {
  if (window.__mainContentZoomInit) return;
  window.__mainContentZoomInit = true;

  var zoomConfig = window.__mainContentZoomConfig || {};
  var DESIGN_WIDTH = zoomConfig.designWidth || 1920;
  var MOBILE_MAX = zoomConfig.mobileMax || 767;
  var DEBOUNCE_MS = zoomConfig.debounceMs || 120;
  var rafId = null;
  var debounceTimer = null;

  function getViewportWidth() {
    return document.documentElement.clientWidth || window.innerWidth || 0;
  }

  function clearMainContentZoom() {
    document.documentElement.style.removeProperty('--main-content-zoom');
    document.documentElement.classList.remove('has-main-content-zoom');
  }

  function applyMainContentZoom() {
    var vw = getViewportWidth();
    if (vw <= 0) return;

    if (vw <= MOBILE_MAX) {
      clearMainContentZoom();
      return;
    }

    var z = vw / DESIGN_WIDTH;
    document.documentElement.style.setProperty('--main-content-zoom', z);
    document.documentElement.classList.add('has-main-content-zoom');
  }

  function scheduleApply(delay) {
    var wait = typeof delay === 'number' ? delay : DEBOUNCE_MS;
    if (debounceTimer != null) {
      window.clearTimeout(debounceTimer);
    }

    debounceTimer = window.setTimeout(function () {
      debounceTimer = null;

      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }

      rafId = window.requestAnimationFrame(function () {
        rafId = null;
        applyMainContentZoom();
      });
    }, wait);
  }

  window.__applyMainContentZoom = applyMainContentZoom;
  window.__scheduleMainContentZoom = scheduleApply;

  window.addEventListener('load', function () {
    scheduleApply(0);
  }, { once: true });
  window.addEventListener('pageshow', function () {
    scheduleApply(0);
  });
  window.addEventListener('resize', function () {
    scheduleApply();
  }, { passive: true });

  if (document.readyState === 'complete') {
    scheduleApply(0);
  } else if (document.readyState === 'interactive') {
    scheduleApply(0);
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      function () {
        scheduleApply(0);
      },
      { once: true }
    );
  }
})();
