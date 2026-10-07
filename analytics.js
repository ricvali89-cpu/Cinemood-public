(() => {
  "use strict";

  const cfg = window.CINEMOOD_ANALYTICS_CONFIG || {};
  const GA_ID = String(cfg.gaMeasurementId || "").trim();
  const GA_ENABLED = /^G-[A-Z0-9]+$/i.test(GA_ID);
  const CONSENT_KEY = "cm_analytics_consent_v1";
  const ATTRIBUTION_KEY = "cm_analytics_attribution_v1";
  let gaLoaded = false;
  let appOpenSent = false;

  const safeText = (value, max = 80) =>
    String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

  const url = new URL(location.href);
  const incomingAttribution = {
    source: safeText(url.searchParams.get("utm_source"), 40),
    medium: safeText(url.searchParams.get("utm_medium"), 40),
    campaign: safeText(url.searchParams.get("utm_campaign"), 80),
    content: safeText(url.searchParams.get("utm_content"), 80),
    term: safeText(url.searchParams.get("utm_term"), 80),
    referrer_host: (() => {
      try { return document.referrer ? new URL(document.referrer).hostname.slice(0, 100) : ""; }
      catch { return ""; }
    })()
  };

  const hasIncomingAttribution = Object.values(incomingAttribution).some(Boolean);

  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY) || "unknown"; }
    catch { return "unknown"; }
  }

  function saveAttribution() {
    if (getConsent() !== "granted") return;
    try {
      if (hasIncomingAttribution) {
        localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({
          ...incomingAttribution,
          saved_at: Date.now()
        }));
      }
    } catch {}
  }

  function getAttribution() {
    if (hasIncomingAttribution) return incomingAttribution;
    if (getConsent() !== "granted") return {};
    try {
      const stored = JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) || "{}");
      if (stored.saved_at && Date.now() - stored.saved_at < 30 * 24 * 60 * 60 * 1000) {
        return stored;
      }
    } catch {}
    return {};
  }

  function ensureGtag() {
    if (!GA_ENABLED || gaLoaded || getConsent() !== "granted") return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };

    window.gtag("js", new Date());
    window.gtag("config", GA_ID, {
      send_page_view: true,
      cookie_flags: "SameSite=None;Secure"
    });

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    script.referrerPolicy = "no-referrer-when-downgrade";
    document.head.appendChild(script);

    saveAttribution();
  }

  function track(name, params = {}) {
    if (getConsent() !== "granted" || !GA_ENABLED) return;
    ensureGtag();
    const attribution = getAttribution();
    window.gtag("event", safeText(name, 40), {
      app_name: "CineMood",
      page_path: location.pathname,
      utm_source: attribution.source || undefined,
      utm_medium: attribution.medium || undefined,
      utm_campaign: attribution.campaign || undefined,
      utm_content: attribution.content || undefined,
      referrer_host: attribution.referrer_host || undefined,
      ...params
    });
  }

  function sendAppOpen() {
    if (appOpenSent || getConsent() !== "granted" || !GA_ENABLED) return;
    appOpenSent = true;
    track("app_open", {
      entry_path: location.pathname,
      has_utm: hasIncomingAttribution ? "yes" : "no"
    });
  }

  function setConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch {}
    if (value === "granted") {
      ensureGtag();
      saveAttribution();
      track("analytics_consent_granted");
      sendAppOpen();
    }
    const banner = document.getElementById("cm-analytics-consent");
    if (banner) banner.remove();
  }

  function showConsentBanner() {
    if (!GA_ENABLED || getConsent() !== "unknown" || document.getElementById("cm-analytics-consent")) return;

    const style = document.createElement("style");
    style.textContent = `
      #cm-analytics-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:760px;margin:auto;background:rgba(15,19,25,.98);color:#f2efe9;border:1px solid #38414f;border-radius:14px;padding:14px 16px;box-shadow:0 18px 60px rgba(0,0,0,.45);font:13px/1.45 Inter,system-ui,sans-serif}
      #cm-analytics-consent .cm-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      #cm-analytics-consent .cm-copy{flex:1;min-width:220px}
      #cm-analytics-consent a{color:#e3a857;text-underline-offset:2px}
      #cm-analytics-consent button{border-radius:999px;padding:9px 13px;font-weight:700;border:1px solid #46505f;cursor:pointer}
      #cm-analytics-consent .cm-accept{background:#e3a857;color:#161005;border-color:#e3a857}
      #cm-analytics-consent .cm-reject{background:#1c232d;color:#f2efe9}
      .cm-privacy-footer{display:block;width:max-content;margin:28px auto 18px;color:#8a93a3;font:12px Inter,system-ui,sans-serif;text-decoration:none}
      .cm-privacy-footer:hover{color:#e3a857}
    `;
    document.head.appendChild(style);

    const banner = document.createElement("div");
    banner.id = "cm-analytics-consent";
    banner.innerHTML = `
      <div class="cm-row">
        <div class="cm-copy">
          Usiamo strumenti di analytics per capire come viene usato CineMood e migliorarlo.
          Si attivano solo con il tuo consenso. <a href="privacy.html">Privacy</a>
        </div>
        <button class="cm-reject" type="button">Continua senza</button>
        <button class="cm-accept" type="button">Accetta analytics</button>
      </div>
    `;
    banner.querySelector(".cm-accept").addEventListener("click", () => setConsent("granted"));
    banner.querySelector(".cm-reject").addEventListener("click", () => setConsent("denied"));
    document.body.appendChild(banner);
  }

  function addPrivacyFooter() {
    if (!GA_ENABLED || document.querySelector(".cm-privacy-footer")) return;
    const link = document.createElement("a");
    link.href = "privacy.html";
    link.className = "cm-privacy-footer";
    link.textContent = "Privacy & analytics";
    document.body.appendChild(link);
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("#openMood")) track("mood_opened");
    if (target.closest("#openRecommended")) track("recommended_opened");
    if (target.closest("#openUpcoming")) track("upcoming_opened");
    if (target.closest("#openNews")) track("news_opened");
    if (target.closest("#openCalendar")) track("calendar_opened");
    if (target.closest("#menuPlatformsBtn")) track("platforms_opened");
    if (target.closest("#menuStatsBtn")) track("stats_opened");
    if (target.closest("#enableNotificationsBtn")) track("notification_settings_opened");

    const moodTile = target.closest(".mood-tile");
    if (moodTile) track("mood_selected", { mood_label: safeText(moodTile.textContent, 50) });

    if (target.closest(".search-actions .primary")) track("search_used");

    const favorite = target.closest(".fav-toggle");
    if (favorite) {
      setTimeout(() => {
        track("favorite_toggled", {
          state: favorite.classList.contains("active") ? "added" : "removed"
        });
      }, 0);
      return;
    }

    const lang = target.closest(".lang-flag");
    if (lang) track("language_changed", { language: safeText(lang.textContent, 8) });

    const card = target.closest(".card");
    if (card && !target.closest("button")) {
      const title = card.querySelector(".title");
      track("title_opened", {
        surface: "card",
        title_label: safeText(title ? title.textContent : "", 80)
      });
    }

    const row = target.closest(".fav-row");
    if (row && !target.closest("button")) {
      const title = row.querySelector(".fav-row-title");
      track("title_opened", {
        surface: "list",
        title_label: safeText(title ? title.textContent : "", 80)
      });
    }
  }, { passive: true });

  document.addEventListener("DOMContentLoaded", () => {
    if (GA_ENABLED) {
      if (getConsent() === "granted") ensureGtag();
      showConsentBanner();
      addPrivacyFooter();
      sendAppOpen();
    }
  });

  window.CineMoodAnalytics = Object.freeze({
    track,
    isConfigured: () => GA_ENABLED,
    consent: () => getConsent(),
    resetConsent: () => {
      try {
        localStorage.removeItem(CONSENT_KEY);
        localStorage.removeItem(ATTRIBUTION_KEY);
      } catch {}
      location.reload();
    }
  });
})();
