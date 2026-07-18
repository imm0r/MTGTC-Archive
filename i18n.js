/* ============================ Mehrsprachigkeit ==========================
   Übersetzt die OBERFLÄCHE (Navigation, Knöpfe, Labels, Hinweise, Toasts,
   Fehlermeldungen, Dialoge …). KARTENDATEN bleiben unberührt: Kartennamen,
   Regeltext, Set-Namen, Typzeilen und Mana-Symbole kommen von Scryfall und
   werden nie übersetzt.

   Statischer Text in index.html trägt data-i18n (textContent), data-i18n-ph
   (placeholder), data-i18n-title (title) oder data-i18n-html (innerHTML, für
   Texte mit <b>/<code>). applyI18n() setzt ihn. Dynamischer Text in app.js
   entsteht über t(key, params) — {name}-Platzhalter werden ersetzt.

   Eine weitere Sprache ist nur ein zusätzlicher Schlüssel je Eintrag. Fehlt ein
   Schlüssel in einer Sprache, greift Deutsch als Rückfall, sonst der Schlüssel
   selbst — die App bricht nie an einer fehlenden Übersetzung. */

const UI_LANGS = { de: "Deutsch", en: "English", fr: "Français", es: "Español", it: "Italiano" };

let LANG = "de";

/* Startsprache: gespeicherte Wahl, sonst die Browsersprache (falls geführt),
   sonst Deutsch. Läuft vor dem ersten Rendern, damit schon der Login stimmt. */
function initLang() {
  try {
    const saved = localStorage.getItem("mtg-lang");
    if (saved && I18N[saved]) { LANG = saved; return; }
  } catch { /* localStorage gesperrt — dann eben Browsersprache/Deutsch */ }
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  LANG = I18N[nav] ? nav : "de";
}

function t(key, params) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? (I18N.de && I18N.de[key]) ?? key;
  if (params) for (const k in params) s = s.split("{" + k + "}").join(params[k]);
  return s;
}

/* Statischen Text im Baum übersetzen. Nach jedem Sprachwechsel und beim Start. */
function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.documentElement.lang = LANG;
}

/* Sprache umstellen: merken, statischen Text neu setzen, und app.js die
   dynamischen Ansichten neu bauen lassen (onLangChange dort definiert). */
function setLang(lang) {
  if (!I18N[lang]) return;
  LANG = lang;
  try { localStorage.setItem("mtg-lang", lang); } catch { /* egal */ }
  applyI18n();
  if (typeof onLangChange === "function") onLangChange();
}

const I18N = {
  // =========================== Deutsch (Vorgabe) ===========================
  de: {
    "setup.hint1": "Einmalig: Verbindung zu deiner Datenbank herstellen. Die Werte findest du in Supabase unter <b>Project Settings → API</b>.",
    "setup.connect": "Verbinden",
    "setup.hint2": "Diese beiden Werte sind für den Browser gedacht und dürfen öffentlich sein. Das Datenbank-Passwort und den <code>service_role</code>-Key trägst du hier <b>nicht</b> ein.",
    "auth.hint": "Melde dich an, um deine Sammlung auf allen Geräten zu sehen.",
    "auth.signin": "Anmelden",
    "auth.signup": "Konto anlegen",
    "field.email": "E-Mail",
    "field.password": "Passwort",

    "nav.collection": "Sammlung",
    "nav.decks": "Decks",
    "nav.cardmgmt": "Card Management",
    "nav.profile": "Profil",
    "nav.friends": "Freunde",
    "nav.settings": "Einstellungen",
    "nav.logout": "Abmelden",
    "who.menu": "Menü",

    "coll.search": "Suche",
    "coll.searchPh": "Name oder Set…",
    "coll.set": "Set",
    "coll.all": "Alle",
    "coll.finish": "Ausführung",
    "coll.onlyFoil": "Nur Foil",
    "coll.onlyNormal": "Nur Normal",
    "coll.updatePrices": "Preise aktualisieren",
    "coll.empty": "Noch keine Karten. Fotografiere deine erste Karte unter „Card Management“.",
    "coll.emptyFilter": "Keine Karte passt zu diesem Filter.",

    "decks.new": "Neues Deck",
    "decks.newPh": "z. B. Mono Red Aggro",
    "decks.format": "Format",
    "decks.archetype": "Archetyp",
    "decks.create": "Deck anlegen",
    "decks.filterBy": "Filtern nach",

    "cm.scan": "Karten scannen",
    "cm.language": "Sprache",
    "cm.condition": "Zustand",
    "cm.finish": "Ausführung",
    "cm.normal": "Normal",
    "cm.dropTitle": "Karte fotografieren",
    "cm.dropSub": "Tippen zum Aufnehmen · oder Bilder hierher ziehen · mehrere gleichzeitig möglich",
    "cm.multiBtn": "Ein Foto, mehrere Karten",
    "cm.scanHint": "Die Einstellungen oben gelten für alle neu gescannten Karten und lassen sich pro Karte nachträglich ändern. „Ein Foto, mehrere Karten“ liest ein Bild mit mehreren <b>nebeneinander liegenden</b> Karten und legt jede einzeln in die Warteschlange.",
    "cm.exportImport": "Export & Import",
    "cm.exportHint": "Deine Sammlung liegt in deiner Supabase-Datenbank und ist auf allen Geräten dieselbe. Ein Export ist trotzdem nützlich — als Sicherung oder zum Weiterverarbeiten in Excel.",
    "cm.backupJson": "Sicherung (JSON)",
    "cm.exportCsv": "Export (CSV)",
    "cm.importBackup": "Sicherung einspielen",
    "cm.mythicCsv": "Mythic Tools (CSV)",
    "cm.manual": "Manuell (Set + Nummer)",
    "cm.resetConn": "Verbindung zurücksetzen",
    "cm.mythicHint": "„Mythic Tools (CSV)“ liest eine Export-Datei aus der Mythic-Tools-App ein: Karten kommen in die Sammlung, ein enthaltenes Deck wird angelegt, bereits vorhandene Karten werden übersprungen.",
    "cm.condAllRows": "Zustand für alle Zeilen",
    "th.set": "Set",
    "th.number": "Nummer",
    "th.mark": "Zeichen",
    "th.finish": "Ausführung",
    "th.language": "Sprache",
    "th.card": "Karte", "th.mana": "Mana", "th.langShort": "Spr.", "th.condShort": "Zust.",
    "th.released": "Erschienen", "th.added": "Hinzugefügt", "th.qty": "Anz.",
    "th.stock": "Bestand", "th.price": "Preis",
    "cm.addRow": "+ Zeile",
    "cm.import": "Importieren",
    "cm.manualHint": "Set und Nummer stehen unten links auf der Karte („MKM • DE“ und „0008/013 T“). Das Zeichen ist der Buchstabe bei der Nummer — wichtig ist <code>T</code> für Token; C, U, R oder M kannst du weglassen. Promo-Karten findest du mit <code>P</code> vor dem Setcode (<code>PEMN</code>, Nummer <code>1Z</code>); die Nummer darf Buchstaben enthalten. Neue Zeilen übernehmen Ausführung und Sprache der vorigen. Dieselbe Karte mehrfach eingetragen erhöht ihre Anzahl.",
    "cm.howTitle": "So funktioniert die Erkennung",
    "cm.howHint": "Aus dem Foto wird per Texterkennung der Kartenname gelesen und gegen die Scryfall-Datenbank abgeglichen — von dort kommen Set, Sammlernummer, Bild und Marktpreis. Wird der Name nicht sicher erkannt, kannst du ihn direkt in der Trefferzeile korrigieren; das Eingabefeld schlägt passende Kartennamen vor. Für gute Trefferquoten: Karte formatfüllend, gerade von oben und ohne starke Reflexionen fotografieren.",

    "dlg.cancel": "Abbrechen",
    "dlg.ok": "OK",
    "dlg.close": "Schließen",

    "settings.title": "Einstellungen",
    "settings.language": "Sprache der Oberfläche",
    "settings.langHint": "Ändert die Sprache der App. Kartennamen, Regeltext und Set-Namen bleiben unverändert.",
    "settings.pageSize": "Karten pro Seite in der Sammlung",
    "settings.pageDefault": "50 (Voreinstellung)",
    "settings.pageAll": "Alle — eine lange Liste",
    "settings.pageHint": "Gilt für die Tabelle der Sammlung. Die Auswertung darüber zählt immer alle gefilterten Karten, egal welche Seite gerade offen ist.",

    "langname.de": "Deutsch", "langname.en": "Englisch", "langname.fr": "Französisch",
    "langname.it": "Italienisch", "langname.es": "Spanisch", "langname.ja": "Japanisch",
  },

  // =============================== English ===============================
  en: {
    "setup.hint1": "One-time: connect to your database. You'll find the values in Supabase under <b>Project Settings → API</b>.",
    "setup.connect": "Connect",
    "setup.hint2": "These two values are meant for the browser and may be public. Do <b>not</b> enter the database password or the <code>service_role</code> key here.",
    "auth.hint": "Sign in to see your collection on all your devices.",
    "auth.signin": "Sign in",
    "auth.signup": "Create account",
    "field.email": "Email",
    "field.password": "Password",

    "nav.collection": "Collection",
    "nav.decks": "Decks",
    "nav.cardmgmt": "Card Management",
    "nav.profile": "Profile",
    "nav.friends": "Friends",
    "nav.settings": "Settings",
    "nav.logout": "Sign out",
    "who.menu": "Menu",

    "coll.search": "Search",
    "coll.searchPh": "Name or set…",
    "coll.set": "Set",
    "coll.all": "All",
    "coll.finish": "Finish",
    "coll.onlyFoil": "Foil only",
    "coll.onlyNormal": "Normal only",
    "coll.updatePrices": "Update prices",
    "coll.empty": "No cards yet. Photograph your first card under “Card Management”.",
    "coll.emptyFilter": "No card matches this filter.",

    "decks.new": "New deck",
    "decks.newPh": "e.g. Mono Red Aggro",
    "decks.format": "Format",
    "decks.archetype": "Archetype",
    "decks.create": "Create deck",
    "decks.filterBy": "Filter by",

    "cm.scan": "Scan cards",
    "cm.language": "Language",
    "cm.condition": "Condition",
    "cm.finish": "Finish",
    "cm.normal": "Normal",
    "cm.dropTitle": "Photograph a card",
    "cm.dropSub": "Tap to capture · or drag images here · several at once",
    "cm.multiBtn": "One photo, several cards",
    "cm.scanHint": "The settings above apply to all newly scanned cards and can be changed per card afterwards. “One photo, several cards” reads an image with several <b>side-by-side</b> cards and queues each one separately.",
    "cm.exportImport": "Export & Import",
    "cm.exportHint": "Your collection lives in your Supabase database and is the same on every device. An export is still useful — as a backup or for further work in Excel.",
    "cm.backupJson": "Backup (JSON)",
    "cm.exportCsv": "Export (CSV)",
    "cm.importBackup": "Restore backup",
    "cm.mythicCsv": "Mythic Tools (CSV)",
    "cm.manual": "Manual (set + number)",
    "cm.resetConn": "Reset connection",
    "cm.mythicHint": "“Mythic Tools (CSV)” imports an export file from the Mythic Tools app: cards are added to the collection, an included deck is created, and already-present cards are skipped.",
    "cm.condAllRows": "Condition for all rows",
    "th.set": "Set",
    "th.number": "Number",
    "th.mark": "Mark",
    "th.finish": "Finish",
    "th.language": "Language",
    "th.card": "Card", "th.mana": "Mana", "th.langShort": "Lang.", "th.condShort": "Cond.",
    "th.released": "Released", "th.added": "Added", "th.qty": "Qty",
    "th.stock": "Stock", "th.price": "Price",
    "cm.addRow": "+ Row",
    "cm.import": "Import",
    "cm.manualHint": "Set and number are at the bottom left of the card (“MKM • DE” and “0008/013 T”). The mark is the letter next to the number — <code>T</code> for token matters; C, U, R or M can be omitted. Find promo cards with <code>P</code> before the set code (<code>PEMN</code>, number <code>1Z</code>); the number may contain letters. New rows inherit the previous finish and language. Entering the same card several times increases its count.",
    "cm.howTitle": "How recognition works",
    "cm.howHint": "The card name is read from the photo via text recognition and matched against the Scryfall database — set, collector number, image and market price come from there. If the name isn't recognized reliably, you can correct it right in the result row; the input suggests matching card names. For good hit rates: photograph the card filling the frame, straight from above and without strong reflections.",

    "dlg.cancel": "Cancel",
    "dlg.ok": "OK",
    "dlg.close": "Close",

    "settings.title": "Settings",
    "settings.language": "Interface language",
    "settings.langHint": "Changes the app's language. Card names, rules text and set names stay unchanged.",
    "settings.pageSize": "Cards per page in the collection",
    "settings.pageDefault": "50 (default)",
    "settings.pageAll": "All — one long list",
    "settings.pageHint": "Applies to the collection table. The analytics above always count all filtered cards, no matter which page is open.",

    "langname.de": "German", "langname.en": "English", "langname.fr": "French",
    "langname.it": "Italian", "langname.es": "Spanish", "langname.ja": "Japanese",
  },

  // =============================== Français ===============================
  fr: {
    "setup.hint1": "Une seule fois : connecte-toi à ta base de données. Tu trouveras les valeurs dans Supabase sous <b>Project Settings → API</b>.",
    "setup.connect": "Se connecter",
    "setup.hint2": "Ces deux valeurs sont destinées au navigateur et peuvent être publiques. N'entre <b>pas</b> ici le mot de passe de la base ni la clé <code>service_role</code>.",
    "auth.hint": "Connecte-toi pour voir ta collection sur tous tes appareils.",
    "auth.signin": "Se connecter",
    "auth.signup": "Créer un compte",
    "field.email": "E-mail",
    "field.password": "Mot de passe",

    "nav.collection": "Collection",
    "nav.decks": "Decks",
    "nav.cardmgmt": "Gestion des cartes",
    "nav.profile": "Profil",
    "nav.friends": "Amis",
    "nav.settings": "Paramètres",
    "nav.logout": "Se déconnecter",
    "who.menu": "Menu",

    "coll.search": "Recherche",
    "coll.searchPh": "Nom ou set…",
    "coll.set": "Set",
    "coll.all": "Tous",
    "coll.finish": "Finition",
    "coll.onlyFoil": "Foil seulement",
    "coll.onlyNormal": "Normal seulement",
    "coll.updatePrices": "Mettre à jour les prix",
    "coll.empty": "Pas encore de cartes. Photographie ta première carte sous « Gestion des cartes ».",
    "coll.emptyFilter": "Aucune carte ne correspond à ce filtre.",

    "decks.new": "Nouveau deck",
    "decks.newPh": "p. ex. Mono Red Aggro",
    "decks.format": "Format",
    "decks.archetype": "Archétype",
    "decks.create": "Créer le deck",
    "decks.filterBy": "Filtrer par",

    "cm.scan": "Scanner des cartes",
    "cm.language": "Langue",
    "cm.condition": "État",
    "cm.finish": "Finition",
    "cm.normal": "Normal",
    "cm.dropTitle": "Photographier une carte",
    "cm.dropSub": "Touche pour prendre la photo · ou glisse des images ici · plusieurs à la fois",
    "cm.multiBtn": "Une photo, plusieurs cartes",
    "cm.scanHint": "Les réglages ci-dessus s'appliquent à toutes les cartes scannées et se modifient ensuite carte par carte. « Une photo, plusieurs cartes » lit une image de plusieurs cartes <b>côte à côte</b> et met chacune dans la file.",
    "cm.exportImport": "Export & Import",
    "cm.exportHint": "Ta collection réside dans ta base Supabase et est la même sur tous les appareils. Un export reste utile — comme sauvegarde ou pour traiter dans Excel.",
    "cm.backupJson": "Sauvegarde (JSON)",
    "cm.exportCsv": "Export (CSV)",
    "cm.importBackup": "Restaurer une sauvegarde",
    "cm.mythicCsv": "Mythic Tools (CSV)",
    "cm.manual": "Manuel (set + numéro)",
    "cm.resetConn": "Réinitialiser la connexion",
    "cm.mythicHint": "« Mythic Tools (CSV) » importe un fichier d'export de l'appli Mythic Tools : les cartes vont dans la collection, un deck inclus est créé, et les cartes déjà présentes sont ignorées.",
    "cm.condAllRows": "État pour toutes les lignes",
    "th.set": "Set",
    "th.number": "Numéro",
    "th.mark": "Signe",
    "th.finish": "Finition",
    "th.language": "Langue",
    "th.card": "Carte", "th.mana": "Mana", "th.langShort": "Lng.", "th.condShort": "État",
    "th.released": "Sortie", "th.added": "Ajout", "th.qty": "Qté",
    "th.stock": "Stock", "th.price": "Prix",
    "cm.addRow": "+ Ligne",
    "cm.import": "Importer",
    "cm.manualHint": "Le set et le numéro sont en bas à gauche de la carte (« MKM • DE » et « 0008/013 T »). Le signe est la lettre près du numéro — <code>T</code> pour jeton compte ; C, U, R ou M peuvent être omis. Trouve les cartes promo avec <code>P</code> devant le code du set (<code>PEMN</code>, numéro <code>1Z</code>) ; le numéro peut contenir des lettres. Les nouvelles lignes reprennent la finition et la langue de la précédente. Saisir la même carte plusieurs fois augmente sa quantité.",
    "cm.howTitle": "Comment fonctionne la reconnaissance",
    "cm.howHint": "Le nom de la carte est lu sur la photo par reconnaissance de texte et comparé à la base Scryfall — set, numéro de collection, image et prix du marché en proviennent. Si le nom n'est pas reconnu de façon sûre, tu peux le corriger directement dans la ligne de résultat ; le champ propose des noms de cartes. Pour de bons résultats : photographie la carte plein cadre, bien de face et sans reflets marqués.",

    "dlg.cancel": "Annuler",
    "dlg.ok": "OK",
    "dlg.close": "Fermer",

    "settings.title": "Paramètres",
    "settings.language": "Langue de l'interface",
    "settings.langHint": "Change la langue de l'appli. Les noms de cartes, le texte de règles et les noms de sets restent inchangés.",
    "settings.pageSize": "Cartes par page dans la collection",
    "settings.pageDefault": "50 (par défaut)",
    "settings.pageAll": "Toutes — une longue liste",
    "settings.pageHint": "S'applique au tableau de la collection. Les statistiques au-dessus comptent toujours toutes les cartes filtrées, quelle que soit la page ouverte.",

    "langname.de": "Allemand", "langname.en": "Anglais", "langname.fr": "Français",
    "langname.it": "Italien", "langname.es": "Espagnol", "langname.ja": "Japonais",
  },

  // =============================== Español ===============================
  es: {
    "setup.hint1": "Una sola vez: conecta con tu base de datos. Encontrarás los valores en Supabase en <b>Project Settings → API</b>.",
    "setup.connect": "Conectar",
    "setup.hint2": "Estos dos valores son para el navegador y pueden ser públicos. <b>No</b> introduzcas aquí la contraseña de la base ni la clave <code>service_role</code>.",
    "auth.hint": "Inicia sesión para ver tu colección en todos tus dispositivos.",
    "auth.signin": "Iniciar sesión",
    "auth.signup": "Crear cuenta",
    "field.email": "Correo",
    "field.password": "Contraseña",

    "nav.collection": "Colección",
    "nav.decks": "Mazos",
    "nav.cardmgmt": "Gestión de cartas",
    "nav.profile": "Perfil",
    "nav.friends": "Amigos",
    "nav.settings": "Ajustes",
    "nav.logout": "Cerrar sesión",
    "who.menu": "Menú",

    "coll.search": "Buscar",
    "coll.searchPh": "Nombre o set…",
    "coll.set": "Set",
    "coll.all": "Todos",
    "coll.finish": "Acabado",
    "coll.onlyFoil": "Solo Foil",
    "coll.onlyNormal": "Solo Normal",
    "coll.updatePrices": "Actualizar precios",
    "coll.empty": "Aún no hay cartas. Fotografía tu primera carta en «Gestión de cartas».",
    "coll.emptyFilter": "Ninguna carta coincide con este filtro.",

    "decks.new": "Nuevo mazo",
    "decks.newPh": "p. ej. Mono Red Aggro",
    "decks.format": "Formato",
    "decks.archetype": "Arquetipo",
    "decks.create": "Crear mazo",
    "decks.filterBy": "Filtrar por",

    "cm.scan": "Escanear cartas",
    "cm.language": "Idioma",
    "cm.condition": "Estado",
    "cm.finish": "Acabado",
    "cm.normal": "Normal",
    "cm.dropTitle": "Fotografiar una carta",
    "cm.dropSub": "Toca para capturar · o arrastra imágenes aquí · varias a la vez",
    "cm.multiBtn": "Una foto, varias cartas",
    "cm.scanHint": "Los ajustes de arriba se aplican a todas las cartas escaneadas y pueden cambiarse por carta después. «Una foto, varias cartas» lee una imagen con varias cartas <b>una al lado de otra</b> y pone cada una en la cola.",
    "cm.exportImport": "Exportar e importar",
    "cm.exportHint": "Tu colección está en tu base de datos Supabase y es la misma en todos los dispositivos. Aun así, una exportación es útil — como copia de seguridad o para trabajar en Excel.",
    "cm.backupJson": "Copia (JSON)",
    "cm.exportCsv": "Exportar (CSV)",
    "cm.importBackup": "Restaurar copia",
    "cm.mythicCsv": "Mythic Tools (CSV)",
    "cm.manual": "Manual (set + número)",
    "cm.resetConn": "Restablecer conexión",
    "cm.mythicHint": "«Mythic Tools (CSV)» importa un archivo de exportación de la app Mythic Tools: las cartas van a la colección, se crea un mazo incluido y las cartas ya presentes se omiten.",
    "cm.condAllRows": "Estado para todas las filas",
    "th.set": "Set",
    "th.number": "Número",
    "th.mark": "Signo",
    "th.finish": "Acabado",
    "th.language": "Idioma",
    "th.card": "Carta", "th.mana": "Maná", "th.langShort": "Idi.", "th.condShort": "Est.",
    "th.released": "Publicada", "th.added": "Añadida", "th.qty": "Cant.",
    "th.stock": "Stock", "th.price": "Precio",
    "cm.addRow": "+ Fila",
    "cm.import": "Importar",
    "cm.manualHint": "El set y el número están abajo a la izquierda de la carta («MKM • DE» y «0008/013 T»). El signo es la letra junto al número — <code>T</code> para ficha importa; C, U, R o M pueden omitirse. Encuentra cartas promo con <code>P</code> antes del código de set (<code>PEMN</code>, número <code>1Z</code>); el número puede contener letras. Las nuevas filas heredan el acabado y el idioma de la anterior. Introducir la misma carta varias veces aumenta su cantidad.",
    "cm.howTitle": "Cómo funciona el reconocimiento",
    "cm.howHint": "El nombre de la carta se lee de la foto por reconocimiento de texto y se coteja con la base de Scryfall — de ahí vienen set, número de coleccionista, imagen y precio de mercado. Si el nombre no se reconoce con seguridad, puedes corregirlo en la fila de resultado; el campo sugiere nombres de cartas. Para buenos resultados: fotografía la carta llenando el encuadre, recta desde arriba y sin reflejos fuertes.",

    "dlg.cancel": "Cancelar",
    "dlg.ok": "OK",
    "dlg.close": "Cerrar",

    "settings.title": "Ajustes",
    "settings.language": "Idioma de la interfaz",
    "settings.langHint": "Cambia el idioma de la app. Los nombres de cartas, el texto de reglas y los nombres de sets no cambian.",
    "settings.pageSize": "Cartas por página en la colección",
    "settings.pageDefault": "50 (predeterminado)",
    "settings.pageAll": "Todas — una lista larga",
    "settings.pageHint": "Se aplica a la tabla de la colección. Las estadísticas de arriba siempre cuentan todas las cartas filtradas, sin importar la página abierta.",

    "langname.de": "Alemán", "langname.en": "Inglés", "langname.fr": "Francés",
    "langname.it": "Italiano", "langname.es": "Español", "langname.ja": "Japonés",
  },

  // =============================== Italiano ===============================
  it: {
    "setup.hint1": "Una tantum: connettiti al tuo database. Trovi i valori in Supabase sotto <b>Project Settings → API</b>.",
    "setup.connect": "Connetti",
    "setup.hint2": "Questi due valori sono pensati per il browser e possono essere pubblici. <b>Non</b> inserire qui la password del database né la chiave <code>service_role</code>.",
    "auth.hint": "Accedi per vedere la tua collezione su tutti i dispositivi.",
    "auth.signin": "Accedi",
    "auth.signup": "Crea account",
    "field.email": "E-mail",
    "field.password": "Password",

    "nav.collection": "Collezione",
    "nav.decks": "Mazzi",
    "nav.cardmgmt": "Gestione carte",
    "nav.profile": "Profilo",
    "nav.friends": "Amici",
    "nav.settings": "Impostazioni",
    "nav.logout": "Esci",
    "who.menu": "Menu",

    "coll.search": "Cerca",
    "coll.searchPh": "Nome o set…",
    "coll.set": "Set",
    "coll.all": "Tutti",
    "coll.finish": "Finitura",
    "coll.onlyFoil": "Solo Foil",
    "coll.onlyNormal": "Solo Normale",
    "coll.updatePrices": "Aggiorna prezzi",
    "coll.empty": "Ancora nessuna carta. Fotografa la tua prima carta in «Gestione carte».",
    "coll.emptyFilter": "Nessuna carta corrisponde a questo filtro.",

    "decks.new": "Nuovo mazzo",
    "decks.newPh": "es. Mono Red Aggro",
    "decks.format": "Formato",
    "decks.archetype": "Archetipo",
    "decks.create": "Crea mazzo",
    "decks.filterBy": "Filtra per",

    "cm.scan": "Scansiona carte",
    "cm.language": "Lingua",
    "cm.condition": "Condizione",
    "cm.finish": "Finitura",
    "cm.normal": "Normale",
    "cm.dropTitle": "Fotografa una carta",
    "cm.dropSub": "Tocca per scattare · o trascina qui le immagini · più insieme",
    "cm.multiBtn": "Una foto, più carte",
    "cm.scanHint": "Le impostazioni sopra valgono per tutte le carte scansionate e si possono cambiare per carta in seguito. «Una foto, più carte» legge un'immagine con più carte <b>affiancate</b> e mette ognuna in coda.",
    "cm.exportImport": "Esporta e importa",
    "cm.exportHint": "La tua collezione è nel tuo database Supabase ed è la stessa su ogni dispositivo. Un export è comunque utile — come backup o per lavorarci in Excel.",
    "cm.backupJson": "Backup (JSON)",
    "cm.exportCsv": "Esporta (CSV)",
    "cm.importBackup": "Ripristina backup",
    "cm.mythicCsv": "Mythic Tools (CSV)",
    "cm.manual": "Manuale (set + numero)",
    "cm.resetConn": "Reimposta connessione",
    "cm.mythicHint": "«Mythic Tools (CSV)» importa un file di export dall'app Mythic Tools: le carte vanno nella collezione, un mazzo incluso viene creato e le carte già presenti vengono saltate.",
    "cm.condAllRows": "Condizione per tutte le righe",
    "th.set": "Set",
    "th.number": "Numero",
    "th.mark": "Segno",
    "th.finish": "Finitura",
    "th.language": "Lingua",
    "th.card": "Carta", "th.mana": "Mana", "th.langShort": "Ling.", "th.condShort": "Cond.",
    "th.released": "Uscita", "th.added": "Aggiunta", "th.qty": "Qtà",
    "th.stock": "Scorta", "th.price": "Prezzo",
    "cm.addRow": "+ Riga",
    "cm.import": "Importa",
    "cm.manualHint": "Set e numero sono in basso a sinistra sulla carta («MKM • DE» e «0008/013 T»). Il segno è la lettera vicino al numero — <code>T</code> per token conta; C, U, R o M si possono omettere. Trovi le carte promo con <code>P</code> prima del codice set (<code>PEMN</code>, numero <code>1Z</code>); il numero può contenere lettere. Le nuove righe ereditano finitura e lingua della precedente. Inserire la stessa carta più volte ne aumenta la quantità.",
    "cm.howTitle": "Come funziona il riconoscimento",
    "cm.howHint": "Il nome della carta viene letto dalla foto tramite riconoscimento testo e confrontato con il database Scryfall — da lì arrivano set, numero da collezione, immagine e prezzo di mercato. Se il nome non è riconosciuto con certezza, puoi correggerlo nella riga del risultato; il campo suggerisce nomi di carte. Per buoni risultati: fotografa la carta a pieno formato, dritta dall'alto e senza forti riflessi.",

    "dlg.cancel": "Annulla",
    "dlg.ok": "OK",
    "dlg.close": "Chiudi",

    "settings.title": "Impostazioni",
    "settings.language": "Lingua dell'interfaccia",
    "settings.langHint": "Cambia la lingua dell'app. Nomi delle carte, testo delle regole e nomi dei set restano invariati.",
    "settings.pageSize": "Carte per pagina nella collezione",
    "settings.pageDefault": "50 (predefinito)",
    "settings.pageAll": "Tutte — un unico elenco",
    "settings.pageHint": "Si applica alla tabella della collezione. Le statistiche sopra contano sempre tutte le carte filtrate, indipendentemente dalla pagina aperta.",

    "langname.de": "Tedesco", "langname.en": "Inglese", "langname.fr": "Francese",
    "langname.it": "Italiano", "langname.es": "Spagnolo", "langname.ja": "Giapponese",
  },
};

initLang();
