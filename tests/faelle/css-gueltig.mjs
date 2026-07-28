/* Findet CSS-Anweisungen, die der Browser stillschweigend wegwirft.

   Das ist der Fall, der in dieser Anwendung am teuersten war. Zweimal stand
   eine Anweisung im Stylesheet, die nie gewirkt hat:

     font: 600 13px/1.2 inherit        — im Kurzschreiber muss zuletzt ein
                                         Schriftname stehen, "inherit" ist keiner
     background: <farbe>, <farbe>      — nur die LETZTE Lage darf eine Farbe sein

   Beide Male fiel die ganze Anweisung weg, samt allem, was darin stand. Nichts
   wurde rot; es sah nur falsch aus, und aufgefallen ist es Monate später beim
   Hinsehen.

   Geprüft wird stur: Jede Deklaration aus dem Quelltext wird einem echten
   CSSStyleDeclaration angeboten. Was dort nicht ankommt, hat der Browser
   verworfen.

   GRENZE: Werte mit var() nimmt der Browser immer an — Custom Properties
   werden erst beim Rechnen aufgelöst, nicht beim Parsen. Solche Zeilen kann
   diese Prüfung nicht beurteilen; sie zählt sie mit und meldet die Zahl. */

export const name = "css-gueltig";

/* At-Regeln, deren Blöcke DESKRIPTOREN enthalten statt Eigenschaften:
   @property hat syntax/inherits/initial-value, @font-face hat src und
   unicode-range. Ein CSSStyleDeclaration kennt davon nichts, und das ist
   richtig so — geprüft werden können sie hier nicht. */
const DESKRIPTOR_REGELN = /@(?:property|font-face|counter-style|page|viewport)[^{]*\{[^{}]*\}/g;

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });

  const erg = await seite.evaluate(async (deskriptorQuelle) => {
    const quelle = await (await fetch("style.css")).text();
    // Kommentare weg, Deskriptor-Regeln weg, dann die INNERSTEN Blöcke — so
    // bleiben @media und @supports außen vor und ihr Inhalt wird geprüft.
    const ohneKommentar = quelle
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(new RegExp(deskriptorQuelle, "g"), "");
    const bloecke = [...ohneKommentar.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]);

    const probe = document.createElement("div");
    const ungueltig = [], mitVar = [];
    let geprueft = 0;
    const grundname = e => e.replace(/^-(?:webkit|moz|ms|o)-/, "");

    for (const block of bloecke) {
      const verdacht = [];           // in diesem Block abgelehnt
      const angenommen = new Set();  // in diesem Block angenommen

      for (const roh of block.split(";")) {
        const stueck = roh.trim();
        if (!stueck) continue;
        const trenner = stueck.indexOf(":");
        if (trenner < 1) continue;
        const eigenschaft = stueck.slice(0, trenner).trim();
        const wert = stueck.slice(trenner + 1).trim();
        if (!wert) continue;
        if (eigenschaft.startsWith("--")) continue;          // Custom Property
        if (/var\(/.test(wert)) { mitVar.push(eigenschaft); continue; }

        geprueft++;
        probe.style.cssText = "";
        probe.style.setProperty(eigenschaft, wert);
        if (probe.style.length === 0) verdacht.push({ eigenschaft, wert });
        else angenommen.add(grundname(eigenschaft));
      }

      /* Eine abgelehnte Eigenschaft ist GEDULDET, wenn ihre Schwester im
         selben Block angenommen wurde: "-moz-appearance:textfield" neben
         "appearance:textfield" ist kein Fehler, sondern eine bewusste
         Doppelung für einen anderen Browser. Steht das Präfix dagegen ALLEIN,
         wirkt hier nichts — und das ist ein Befund. */
      for (const v of verdacht) {
        if (!angenommen.has(grundname(v.eigenschaft))) {
          ungueltig.push(`${v.eigenschaft}: ${v.wert}`);
        }
      }
    }

    /* Selbstprobe: Wäre der Zerleger oder die Annahme kaputt, meldete die
       Prüfung fröhlich "alles gut". Diese beiden MÜSSEN als ungültig
       erkennbar sein — es sind genau die Fehler, die hier schon gemacht
       wurden. */
    const merktEsNoch = ["font: 600 13px/1.2 inherit", "background: rgba(1,2,3,.5), rgba(4,5,6,.5)"]
      .every(z => {
        const i = z.indexOf(":");
        probe.style.cssText = "";
        probe.style.setProperty(z.slice(0, i).trim(), z.slice(i + 1).trim());
        return probe.style.length === 0;
      });

    return { geprueft, ungueltig, mitVar: mitVar.length, merktEsNoch };
  }, DESKRIPTOR_REGELN.source);

  stand.ist("die Prüfung erkennt bekannte Fehler noch", erg.merktEsNoch,
    "Selbstprobe mit zwei nachweislich ungültigen Anweisungen");
  stand.ist("genug Anweisungen geprüft", erg.geprueft > 300, `${erg.geprueft} geprüft`);
  stand.ist("keine verworfene Anweisung in style.css", erg.ungueltig.length === 0,
    erg.ungueltig.length ? erg.ungueltig.join(" | ") : `0 von ${erg.geprueft}, ${erg.mitVar} mit var() nicht beurteilbar`);
}
