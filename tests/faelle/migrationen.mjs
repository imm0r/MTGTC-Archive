/* Migrationen, die eine frühere Fassung fortschreiben.

   ANLASS. Die Migration für „Deck geteilt" schrieb die Liste der erlaubten
   Feed-Arten und den Schreibweg `record_community_activity` neu — und nahm
   dafür die Fassung aus der ÄLTESTEN Migration als Vorlage. Seither war beides
   gewachsen:

   * `combo_search` und `synergy_search` kamen dazu. Ohne sie scheitert der
     Constraint an bestehenden Zeilen: „is violated by some row". Das ist der
     GLIMPFLICHE Fall — er fällt sofort auf.
   * Der Schreibweg prüft seit einer anderen Migration die Sichtbarkeitsstufe:
     „privat" schreibt gar nicht, „anonym" ohne actor_id. Wer ihn aus der
     ersten Fassung neu schreibt, nimmt das ersatzlos wieder heraus — und
     NICHTS schlägt fehl. Der Feed nennt danach Leute, die das abgewählt
     haben.

   Diesen zweiten Fall fängt kein Datenbankfehler und keine Oberflächenprüfung.
   Er fällt nur auf, wenn jemand die Migrationen nebeneinanderlegt — also hier.

   Geprüft wird deshalb an den DATEIEN, nach Namen sortiert (das ist die
   Reihenfolge, in der Supabase sie ausführt): Wer eine Liste oder eine
   Funktion neu schreibt, darf nichts verlieren, was eine frühere Fassung
   schon konnte. */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const name = "migrationen";

/* Alles zwischen „kind in (" und der schließenden Klammer, als Menge. */
const artenAus = (text) => {
  const raus = [];
  for (const m of text.matchAll(/kind (?:not )?in \(([\s\S]*?)\)/g))
    raus.push(new Set((m[1].match(/'([a-z_]+)'/g) || []).map(x => x.slice(1, -1))));
  return raus;
};

export default async function ({ stand, wurzel }) {
  const ordner = join(wurzel, "supabase/migrations");
  const dateien = (await readdir(ordner)).filter(f => f.endsWith(".sql")).sort();
  stand.ist("es gibt Migrationen zu prüfen", dateien.length > 10, dateien.length + " Dateien");

  const inhalt = new Map();
  for (const f of dateien) inhalt.set(f, await readFile(join(ordner, f), "utf8"));

  /* --- Die Liste der Feed-Arten wächst, sie schrumpft nie ---------------
     Jede Fassung muss alles enthalten, was eine frühere schon erlaubte.
     Schrumpft sie, scheitert entweder der Constraint an alten Zeilen — oder,
     schlimmer, der Schreibweg weist eine Art stillschweigend ab. */
  let bisher = new Set();
  let letzteDatei = null;
  const verloren = [];
  for (const f of dateien) {
    for (const menge of artenAus(inhalt.get(f))) {
      // Listen, die gar nichts mit dem Feed zu tun haben (etwa die Zähler mit
      // 'combos'/'synergies'), erkennt man daran, dass sie die Grundart nicht
      // führen. Sie bleiben außen vor.
      if (!menge.has("card_added")) continue;
      for (const art of bisher)
        if (!menge.has(art)) verloren.push(`${f}: ${art} fehlt (zuletzt in ${letzteDatei})`);
      menge.forEach(a => bisher.add(a));
      letzteDatei = f;
    }
  }
  stand.gleich("keine Migration verliert eine Feed-Art", verloren, []);
  stand.ist("und die neueste kennt „deck_public“", bisher.has("deck_public"),
    [...bisher].sort().join(", "));

  /* --- Der Schreibweg verliert seine Sichtbarkeitsprüfung nicht ---------
     Ab der Fassung, die sie eingeführt hat, muss JEDE spätere sie ebenfalls
     tragen. Das ist der Fall, den kein Fehler meldet. */
  const fassungen = dateien.filter(f =>
    inhalt.get(f).includes("create or replace function public.record_community_activity"));
  stand.ist("record_community_activity wird mehrfach fortgeschrieben",
    fassungen.length >= 2, fassungen.length + " Fassungen");

  const koerper = (f) => {
    const t = inhalt.get(f);
    const von = t.indexOf("create or replace function public.record_community_activity");
    // Bis zum Ende des Funktionsrumpfs — das erste „$$;" danach.
    return t.slice(von, t.indexOf("$$;", von));
  };
  let abFassung = null;
  const ohneSicht = [];
  for (const f of fassungen) {
    const k = koerper(f);
    const hatSicht = /community_visibility/.test(k) && /'private'/.test(k) && /'anonymous'/.test(k);
    if (hatSicht && !abFassung) abFassung = f;
    else if (abFassung && !hatSicht) ohneSicht.push(`${f} (eingeführt in ${abFassung})`);
  }
  stand.ist("die Sichtbarkeitsprüfung wurde irgendwann eingeführt", !!abFassung, abFassung);
  stand.gleich("und keine spätere Fassung nimmt sie wieder heraus", ohneSicht, []);

  /* --- Die Erlaubnisliste steht an zwei Stellen und muss übereinstimmen -
     Constraint und Schreibweg derselben Datei: Gehen sie auseinander, lässt
     die Tabelle etwas zu, das die Funktion abweist (oder umgekehrt) — und
     man sucht den Fehler an der falschen Stelle. */
  const ungleich = [];
  for (const f of dateien) {
    const mengen = artenAus(inhalt.get(f)).filter(m => m.has("card_added"));
    if (mengen.length < 2) continue;
    const erste = [...mengen[0]].sort().join(",");
    mengen.slice(1).forEach((m, i) => {
      const jetzt = [...m].sort().join(",");
      if (jetzt !== erste) ungleich.push(`${f}: Liste ${i + 2} weicht ab`);
    });
  }
  stand.gleich("Tabelle und Schreibweg führen dieselbe Liste", ungleich, []);
}
