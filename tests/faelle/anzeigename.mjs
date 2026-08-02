/* Der Anzeigename ist Pflicht — auf beiden Wegen hinein.

   Seit die Mitgliederliste jeden beim Namen nennt, ist „kein Name" keine
   Einstellung mehr, sondern eine Lücke: In den Kacheln stünde weiter „Ein
   Mitglied", in der Personensuche fände einen niemand.

   Es gibt DREI Stellen, an denen ein Name entsteht oder verschwindet, und
   eine davon zu vergessen genügt, damit die Pflicht nichts wert ist:

   * BEIM ANLEGEN eines Kontos. Der Name muss in den Nutzer-Metadaten
     mitreisen — bei bestätigungspflichtiger Anmeldung gibt es noch keine
     Sitzung, in der sich etwas in `profiles` schreiben ließe. Wer das
     übersieht, baut ein Feld, dessen Inhalt niemand je wiedersieht.
   * BEIM ANMELDEN eines alten Kontos. Ohne Namen darf die App gar nicht erst
     erscheinen.
   * IM PROFIL. Dort ließ sich der Name bisher LEEREN — man nähme also gleich
     zurück, was die Anmeldung eben verlangt hat.

   Dazu die Zusage aus dem vorigen Umbau: Sie riet, den Anzeigenamen leer zu
   lassen, wer ungenannt bleiben will. Diesen Weg gibt es nicht mehr, und ein
   Satz, der ihn weiter empfiehlt, schickt Leute gegen eine Wand. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "anzeigename";

/* Eine Attrappe für Supabase: Sie merkt sich, WAS bei der Registrierung
   mitgeschickt und WAS ins Profil geschrieben würde. Läuft im Browser. */
const ATTRAPPE = (profil) => {
  window.ANGELEGT = null; window.GESCHRIEBEN = null; window.ABGEMELDET = false;
  window.PROFILZEILE = profil;          // was `profiles` für diesen Nutzer hält
  USER = { id: "u0", email: "wer@example.invalid", user_metadata: {} };
  const tisch = (name) => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: window.PROFILZEILE, error: null }) }),
    }),
    insert: (zeile) => ({ select: () => ({ single: async () => {
      window.ANGELEGT = zeile; window.PROFILZEILE = { id: "u0", ...zeile };
      return { data: window.PROFILZEILE, error: null };
    } }) }),
    update: (felder) => ({ eq: async () => {
      window.GESCHRIEBEN = felder;
      Object.assign(window.PROFILZEILE || (window.PROFILZEILE = { id: "u0" }), felder);
      return { error: null };
    } }),
  });
  window.sb = {
    from: tisch,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      signUp: async (o) => { window.ANGEMELDET = o; return { data: { session: null, user: null }, error: null }; },
      signInWithPassword: async (o) => { window.ANGEMELDET = o; return { data: { session: null, user: null }, error: null }; },
      signOut: async () => { window.ABGEMELDET = true; },
    },
  };
  sb = window.sb;
};

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);

  /* --- Die Regel selbst ----------------------------------------------- */
  const regel = await seite.evaluate(() => [
    "", "  ", "A", "Jo", "  Jo  ", "Mira  Sonnenschein", "x".repeat(40), "x".repeat(41),
  ].map(v => nameGeprueft(v)));
  stand.gleich("die Namensregel urteilt Fall für Fall", regel, [
    null,                    // leer
    null,                    // nur Leerzeichen
    null,                    // ein Zeichen ist zu wenig
    "Jo",                    // zwei genügen — kürzeste echte Namen sollen durch
    "Jo",                    // getrimmt
    "Mira Sonnenschein",     // doppelte Leerzeichen zusammengezogen
    "x".repeat(40),          // vierzig sind erlaubt …
    null,                    // … einundvierzig nicht
  ]);

  /* --- Weg 1: Konto anlegen ------------------------------------------- */
  await seite.evaluate(ATTRAPPE, null);
  await seite.evaluate(() => { wireAuth(); showGate("auth"); });
  await seite.waitForTimeout(200);

  stand.ist("beim Anmelden steht kein Namensfeld",
    await seite.evaluate(() => document.querySelector("#auth-name-feld").hidden));
  await seite.click('#auth-tabs button[data-mode="up"]');
  await seite.waitForTimeout(150);
  const beimAnlegen = await seite.evaluate(() => ({
    sichtbar: !document.querySelector("#auth-name-feld").hidden,
    pflicht: document.querySelector("#auth-name").required,
  }));
  stand.ist("beim Anlegen steht es da …", beimAnlegen.sichtbar);
  stand.ist("… und ist ein Pflichtfeld", beimAnlegen.pflicht);

  /* Ohne Namen darf nichts an den Server gehen. */
  await seite.fill("#auth-email", "wer@example.invalid");
  await seite.fill("#auth-pw", "geheim12345");
  await seite.fill("#auth-name", " A ");            // ein Zeichen: zu kurz
  await seite.evaluate(() => document.querySelector("#auth-form").requestSubmit());
  await seite.waitForTimeout(250);
  stand.ist("ein zu kurzer Name wird abgewiesen …",
    await seite.evaluate(() => window.ANGEMELDET == null));
  stand.ist("… mit einem Satz, der die Schranken nennt",
    await seite.evaluate(() => {
      const m = document.querySelector("#auth-msg");
      return m.className.includes("err") && /2/.test(m.textContent) && /40/.test(m.textContent);
    }),
    await seite.evaluate(() => document.querySelector("#auth-msg").textContent));

  /* Mit Namen: Er muss in den Metadaten mitreisen — sonst sieht ihn nach der
     Bestätigungsmail niemand wieder. */
  await seite.fill("#auth-name", "  Mira   Sonnenschein  ");
  await seite.evaluate(() => document.querySelector("#auth-form").requestSubmit());
  await seite.waitForTimeout(250);
  stand.gleich("der Name reist in den Nutzer-Metadaten mit",
    await seite.evaluate(() => window.ANGEMELDET?.options?.data?.display_name),
    "Mira Sonnenschein");

  /* Und beim Anlegen des Profils wird er von dort übernommen. */
  const uebernommen = await seite.evaluate(async () => {
    window.PROFILZEILE = null;
    USER = { id: "u0", email: "wer@example.invalid",
             user_metadata: { display_name: "Mira Sonnenschein" } };
    await ladeProfile();
    return { angelegt: window.ANGELEGT, profil: PROFILE?.display_name };
  });
  stand.gleich("und beim Anlegen des Profils von dort übernommen",
    [uebernommen.angelegt?.display_name, uebernommen.profil],
    ["Mira Sonnenschein", "Mira Sonnenschein"]);

  /* Ohne Metadaten bleibt es beim blanken Profil — kein erfundener Name. */
  const ohne = await seite.evaluate(async () => {
    window.PROFILZEILE = null; window.ANGELEGT = null;
    USER = { id: "u0", email: "wer@example.invalid", user_metadata: {} };
    await ladeProfile();
    return window.ANGELEGT;
  });
  stand.gleich("ohne mitgereisten Namen wird keiner erfunden", ohne, { id: "u0" });

  /* --- Weg 2: altes Konto ohne Namen ---------------------------------- */
  const gefragt = await seite.evaluate(async () => {
    PROFILE = { id: "u0", display_name: null };
    const p = nameNachtragen();                 // absichtlich NICHT abwarten
    await new Promise(r => setTimeout(r, 60));
    const sichtbar = document.querySelector('#gate .pane[data-pane="name"]').style.display;
    return { pane: sichtbar, gate: document.querySelector("#gate").style.display,
             app: document.querySelector("#app").style.display, offen: !!p };
  });
  stand.gleich("ohne Namen erscheint die Maske statt der App",
    [gefragt.pane, gefragt.gate, gefragt.app], ["block", "block", "none"]);

  /* Ein untauglicher Name kommt auch hier nicht durch. */
  await seite.fill("#name-input", " A ");
  await seite.evaluate(() => document.querySelector("#name-form").requestSubmit());
  await seite.waitForTimeout(200);
  stand.ist("auch hier wird ein zu kurzer Name abgewiesen",
    await seite.evaluate(() => window.GESCHRIEBEN == null
      && document.querySelector("#name-msg").className.includes("err")));

  await seite.fill("#name-input", "Jonas");
  await seite.evaluate(() => document.querySelector("#name-form").requestSubmit());
  await seite.waitForTimeout(250);
  stand.gleich("ein tauglicher Name wird geschrieben",
    await seite.evaluate(() => window.GESCHRIEBEN), { display_name: "Jonas" });
  stand.gleich("und steht danach im Profil",
    await seite.evaluate(() => PROFILE.display_name), "Jonas");

  /* Wer es sich anders überlegt, kommt hier wieder heraus. */
  stand.ist("die Maske trägt einen Weg hinaus (Abmelden)",
    await seite.evaluate(() => !!document.querySelector("#name-logout")));

  /* Und die Frage stellt sich nur, wenn sie sich stellt. */
  stand.gleich("brauchtNamen() urteilt wie erwartet",
    await seite.evaluate(() => [null, "", "  ", "A", "Jonas"].map(n => {
      PROFILE = { display_name: n }; return brauchtNamen();
    })), [true, true, true, true, false]);

  /* --- Weg 3: das Profil darf ihn nicht wieder leeren ----------------- */
  const imProfil = await seite.evaluate(async () => {
    PROFILE = { id: "u0", display_name: "Jonas" };
    window.GESCHRIEBEN = null;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-profile"));
    renderProfile();
    document.querySelector("#pf-name").value = "   ";
    await nameSpeichern();
    return { geschrieben: window.GESCHRIEBEN, profil: PROFILE.display_name };
  });
  stand.gleich("ein geleertes Namensfeld im Profil schreibt nichts",
    imProfil.geschrieben, null);
  stand.gleich("und der alte Name bleibt stehen", imProfil.profil, "Jonas");

  /* --- Die Zusage aus dem vorigen Umbau ------------------------------- */
  const rat = await seite.evaluate(() => {
    const vorher = LANG, raus = {};
    for (const l of ["de", "en", "fr", "es", "it"]) { setLang(l); raus[l] = t("community.vis.memberNote"); }
    setLang(vorher);
    return raus;
  });
  stand.gleich("keine Sprache rät mehr, den Anzeigenamen leer zu lassen",
    Object.entries(rat).filter(([, x]) =>
      /leer lassen|leer\.|empty|vide|vacío|vuoto/i.test(x)).map(([l]) => l), []);
  stand.gleich("jede sagt stattdessen, dass er Pflicht ist",
    Object.entries(rat).filter(([, x]) =>
      /Pflicht|required|obligatoire|obligatorio|obbligatorio/i.test(x)).map(([l]) => l),
    ["de", "en", "fr", "es", "it"]);
}
