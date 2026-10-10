import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

const index = read("index.html");
const privacy = read("privacy.html");
const landing = read("landing/index.html");
const analytics = read("analytics.js");
const analyticsConfig = read("analytics-config.js");
const sw = read("firebase-messaging-sw.js");
const manifest = JSON.parse(read("manifest.json"));

function checkJavaScriptSyntax(source, label) {
  try {
    new Function(source);
  } catch (error) {
    fail(`${label}: sintassi JavaScript non valida: ${error.message}`);
  }
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean);
}

inlineScripts(index).forEach((source, i) => checkJavaScriptSyntax(source, `index.html script #${i + 1}`));
inlineScripts(privacy).forEach((source, i) => checkJavaScriptSyntax(source, `privacy.html script #${i + 1}`));
checkJavaScriptSyntax(analytics, "analytics.js");
checkJavaScriptSyntax(analyticsConfig, "analytics-config.js");
checkJavaScriptSyntax(sw, "firebase-messaging-sw.js");

const requiredIds = [
  "app", "heroCarousel", "platformShelves", "weeklyTrending",
  "popularResults", "searchResults", "favGrid",
  "detailOverlay", "moodOverlay", "recOverlay", "upcomingOverlay",
  "calendarOverlay", "universesOverlay", "newsOverlay", "platformsOverlay",
  "statsOverlay", "notificationPrefsOverlay", "continueSection", "continueShelf",
  "openNews", "menuPlatformsBtn", "menuStatsBtn", "switchProfileBtn"
];
for (const id of requiredIds) {
  assert(index.includes(`id="${id}"`), `Elemento UI mancante: #${id}`);
}

const requiredFunctions = [
  "buildHome", "runPopular", "runSearch", "renderFavorites", "openDetail",
  "runMoodSearch", "buildRecommendations", "buildUpcoming", "buildCalendar",
  "openUniverseDetail", "openPersonWorks", "loadEpisodes", "persistAll",
  "buildContinueWatching", "renderPlatformPicker", "buildStats", "buildNews",
  "runSmartNotificationCheck"
];
for (const fn of requiredFunctions) {
  assert(
    new RegExp(`(?:async\\s+)?function\\s+${fn}\\s*\\(`).test(index),
    `Funzione core mancante: ${fn}()`
  );
}

const itBlock = index.match(/const I18N = \{\s*it:\s*\{([\s\S]*?)\n\s*\},\s*en:\s*\{/m)?.[1] || "";
const enBlock = index.match(/\n\s*en:\s*\{([\s\S]*?)\n\s*\}\s*\n\};/m)?.[1] || "";
const collectKeys = block => new Set([...block.matchAll(/["']([^"']+)["']\s*:/g)].map(m => m[1]));
const itKeys = collectKeys(itBlock);
const enKeys = collectKeys(enBlock);
const usedKeys = [
  ...index.matchAll(/\bt\(\s*["']([^"']+)["']\s*\)/g),
  ...index.matchAll(/data-i18n=["']([^"']+)["']/g)
].map(m => m[1]);
for (const key of new Set(usedKeys)) {
  assert(itKeys.has(key), `Traduzione italiana mancante: ${key}`);
  assert(enKeys.has(key), `Traduzione inglese mancante: ${key}`);
}

assert(!index.includes("if(doc.exists || true)"), "Rilevato vecchio bypass pericoloso della sincronizzazione Firestore");
assert(index.includes("mergeFields:PROFILE_DATA_FIELDS"), "Persistenza profilo non protetta con mergeFields");
assert(index.includes("escHtml(r.author ||"), "Nome autore recensione non sanificato");
assert(index.includes("escHtml(r.text)"), "Testo recensione non sanificato");
assert(!/\bmood\.genre\b|\bmood2\.genre\b/.test(index), "Mood usa ancora un unico genere per film e TV");
assert(index.includes("movieGenre:") && index.includes("tvGenre:"), "Tassonomie Mood film/TV mancanti");
assert(index.includes('id="enableNotificationsBtn"'), "Controllo esplicito per notifiche mancante");
assert(index.includes("registerForPushNotifications(true)"), "Opt-in notifiche non collegato al gesto utente");
assert(index.includes("function closeOverlayViaHistory"), "Gestione cronologia overlay mancante");
assert(index.includes("openDetail(id, mediaType, false)"), "Re-render dettaglio genera ancora voci cronologia duplicate");
assert(index.includes('c=>c.job==="Director"'), "Scheda regista non limitata al ruolo Director");
assert(index.includes("const cinemaPageCount = Math.min("), "Paginazione uscite cinema mancante");
assert(index.includes("CURATED_STREAMING_MONTH"), "Mese streaming curato mancante");
assert(index.includes("MY_PLATFORMS"), "Preferenze piattaforme mancanti");
assert(index.includes("NOTIFICATION_PREFS"), "Preferenze notifiche mancanti");
assert(index.includes("selectedProviderQuery()"), "Priorità piattaforme non collegata ai filtri");
assert(index.includes("buildContinueWatching();"), "Continua a guardare non collegato alla Home");
assert(index.includes("async function tvmaze("), "Fallback TVmaze per calendario mancante");
assert(index.includes("getNextEpisodeFromTmdbSeasons"), "Fallback stagioni TMDB per calendario mancante");
assert(index.includes("getNextEpisodeFromTvmaze"), "Fallback episodio TVmaze non collegato");
assert(index.includes('id="openNews"'), "Ingresso News mancante");
assert(index.includes("TMDB ·"), "Fonte TMDB non mostrata nelle News");
assert(index.includes("HERO_ROTATION_DAYS"), "Rotazione dinamica carosello mancante");

assert(
  landing.includes("https://play.google.com/store/apps/details?id=io.github.ricvali89_cpu.twa"),
  "CTA Google Play della landing non punta allo store"
);
assert(!landing.includes('href="#" id="playStoreLink"'), "CTA Google Play ancora vuota");

assert(privacy.includes("Google Firebase"), "Privacy: Firebase non documentato");
assert(privacy.includes("Google Analytics 4"), "Privacy: Analytics non documentato");
assert(privacy.includes("notifiche push"), "Privacy: notifiche push non documentate");

assert(manifest.name === "CineMood", "Manifest: nome app inatteso");
assert(manifest.display === "standalone", "Manifest: display standalone mancante");
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "Manifest: icone PWA mancanti");

assert(sw.includes("notificationclick"), "Service worker: gestione tap notifica mancante");
assert(sw.includes("onBackgroundMessage"), "Service worker: gestione FCM background mancante");

console.log("✓ CineMood smoke check superato");
console.log("  Home, continua a guardare, News, statistiche, piattaforme, ricerca, dettaglio, Mood, uscite, calendario e universi: struttura presente");
console.log("  JavaScript, i18n, privacy, manifest, FCM e regressioni note: OK");
