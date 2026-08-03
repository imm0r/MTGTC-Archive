/* Die Karte unter dem Zeiger: Neigung, Glanz, Foil-Schimmer.

   Das ist ein Effekt, der ausschließlich still scheitert. Eine vergessene
   Variable, ein Blendmodus, den ein Stapelkontext abfängt, eine Schicht ohne
   pointer-events:none — nichts davon wird rot, es sieht nur falsch aus oder
   das Umdrehen der Karte hört auf zu funktionieren. Geprüft wird deshalb, was
   man sonst nur SIEHT:

   * Der Aufbau steht: Bild in der Bühne, Lichtschichten deckungsgleich darauf.
   * Die Neigung folgt dem Zeiger, mit dem richtigen VORZEICHEN. Ein
     vertauschtes Vorzeichen ist der Fehler, der am ehesten unbemerkt bliebe:
     Die Karte bewegt sich ja, nur eben vom Zeiger weg statt zu ihm hin.
   * Beim Verlassen wird alles zurückgenommen, sonst bliebe die Karte schief
     stehen.
   * Der Foil-Schimmer gehört zum EXEMPLAR: nur eine Foil-Karte bekommt ihn.
   * Das Umdrehen zweiseitiger Karten überlebt die Bühne — sie legt zwei
     3D-Räume ineinander, und das ist genau die Stelle, an der so etwas bricht.
   * Die Neigung erzeugt keinen Überlauf im Dialog. Deshalb ist das Leuchten
     ein box-shadow und kein Element mit negativem inset (siehe karte3dHtml);
     ginge das verloren, bekäme der Dialog Rollbalken für ein Leuchten.
   * Ohne schwebefähiges Zeigegerät wird gar nicht erst verdrahtet.
   * Wer weniger Bewegung möchte, bekommt Licht ohne Kippen. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "kartenglanz";

/* Eine Attrappe reicht als Bild — geprüft wird die Fassung, nicht das Motiv. */
const BILD = "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680">
     <rect width="488" height="680" rx="20" fill="#1d2a1d"/></svg>`).toString("base64");

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3 });
  await seite.waitForTimeout(250);

  /* --- Aufbau -------------------------------------------------------------- */
  const aufbau = await seite.evaluate((bild) => {
    CARDS[0].img = bild; CARDS[0].foil = false;
    CARDS[1].img = bild; CARDS[1].foil = true;
    CARDS[2].img = null;                       // kein Bild hinterlegt
    showCardDetail("d0c0");
    const b = document.querySelector("#dt-karte3d");
    return {
      buehne: !!b,
      bildDrin: !!b?.querySelector(".karte3d-blatt > .detail-img"),
      schichten: [...b.querySelectorAll(".karte3d-glanz,.karte3d-holo")].map(s => s.className),
      // Beide Lichtschichten müssen den Klick durchlassen: Über ihnen liegt
      // sonst nichts mehr anklickbar — bei zweiseitigen Karten das Umdrehen.
      durchlaessig: [...b.querySelectorAll(".karte3d-glanz,.karte3d-holo")]
        .every(s => getComputedStyle(s).pointerEvents === "none"),
    };
  }, BILD);
  stand.ist("das Bild liegt in der Bühne", aufbau.buehne && aufbau.bildDrin);
  stand.gleich("Glanz und Schimmer liegen darüber", aufbau.schichten,
    ["karte3d-glanz", "karte3d-holo"]);
  stand.ist("die Lichtschichten fangen keine Klicks", aufbau.durchlaessig);

  /* --- Die Hover-Vorschau bleibt außen vor -------------------------------- */
  stand.ist("die Hover-Vorschau bekommt keine Bühne",
    await seite.evaluate(() => !/karte3d/.test(detailHtml(CARDS[0], true))),
    await seite.evaluate(() => detailHtml(CARDS[0], true).slice(0, 60)));

  /* --- Die Neigung folgt dem Zeiger --------------------------------------- */
  const kasten = await seite.locator("#dt-karte3d").boundingBox();
  // Geschrieben wird beim Bewegen erst im nächsten Bild (requestAnimationFrame,
  // siehe wireKarte3d) — gewartet wird deshalb auf den erwarteten Stand des
  // Zeigers, nicht auf eine Anzahl Millisekunden. Kommt er nicht, meldet die
  // Behauptung darunter, was stattdessen dastand.
  const lies = (erwartet) => seite.evaluate(async (soll) => {
    const el = document.getElementById("dt-karte3d");
    for (let i = 0; i < 80 && el.style.getPropertyValue("--kmx") !== soll; i++)
      await new Promise(r => setTimeout(r, 25));
    return { zeigt: el.classList.contains("zeigt"),
             kx: parseFloat(el.style.getPropertyValue("--kx")),
             ky: parseFloat(el.style.getPropertyValue("--ky")),
             kmx: el.style.getPropertyValue("--kmx"),
             kmy: el.style.getPropertyValue("--kmy"),
             // Das Lichtband läuft GEGEN den Zeiger — sonst führte die Karte
             // ihre Lampe mit sich, statt sich unter einer festen zu drehen.
             kbx: el.style.getPropertyValue("--kbx") };
  }, erwartet);

  // Links oben: obere Kante nach hinten (rotateX positiv), linke Kante nach
  // vorn (rotateY negativ).
  await seite.mouse.move(kasten.x + kasten.width * 0.2, kasten.y + kasten.height * 0.2);
  const lo = await lies("20.0%");
  stand.ist("der Zeiger auf der Karte schaltet den Effekt ein", lo.zeigt);
  stand.ist("links oben: obere Kante nach hinten, linke nach vorn",
    lo.kx > 0 && lo.ky < 0, `rotateX ${lo.kx}°, rotateY ${lo.ky}°`);
  stand.gleich("der Glanzpunkt sitzt unter dem Zeiger", [lo.kmx, lo.kmy], ["20.0%", "20.0%"]);
  stand.gleich("das Lichtband läuft dem Zeiger entgegen", lo.kbx, "80.0%");

  // Rechts unten: die Vorzeichen kippen beide.
  await seite.mouse.move(kasten.x + kasten.width * 0.8, kasten.y + kasten.height * 0.8);
  const ru = await lies("80.0%");
  stand.ist("rechts unten: beide Vorzeichen kippen",
    ru.kx < 0 && ru.ky > 0, `rotateX ${ru.kx}°, rotateY ${ru.ky}°`);
  stand.ist("der Ausschlag bleibt im Rahmen (höchstens 10°)",
    Math.abs(ru.kx) <= 10 && Math.abs(ru.ky) <= 10, `${ru.kx}° / ${ru.ky}°`);

  /* --- Kein Überlauf: das Leuchten ist ein Schatten, kein Element ---------- */
  stand.gleich("die geneigte Karte erzeugt keine Rollbalken",
    await seite.evaluate(() => {
      const d = document.getElementById("detail-dlg");
      return [d.scrollWidth - d.clientWidth, document.body.scrollWidth - document.body.clientWidth];
    }), [0, 0]);

  /* --- Zeiger weg: alles zurück ------------------------------------------- */
  await seite.mouse.move(kasten.x + kasten.width / 2, kasten.y - 90);
  // ABGEWARTET, NICHT ABGEZÄHLT. Das Zurücksinken dauert 500 ms — auf diesem
  // Rechner. Der Prüfläufer fährt vier Browser gleichzeitig auf zwei Kernen,
  // und dort ist jede feste Wartezeit eine Wette. Gewartet wird deshalb auf
  // den ZUSTAND, mit einer großzügigen Schranke dahinter.
  const weg = await seite.evaluate(async () => {
    const el = document.getElementById("dt-karte3d");
    const buehne = el.querySelector(".karte3d-buehne");
    const gerade = t => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
    for (let i = 0; i < 80 && !gerade(getComputedStyle(buehne).transform); i++)
      await new Promise(r => setTimeout(r, 25));
    return { zeigt: el.classList.contains("zeigt"), stil: el.getAttribute("style") || "",
             // matrix3d(1,0,0,0, 0,1,0,0, …) ist die Einheitsmatrix: keine Neigung.
             transform: getComputedStyle(buehne).transform };
  });
  stand.ist("Zeiger weg: der Effekt geht aus", !weg.zeigt);
  stand.ist("Zeiger weg: keine Stilwerte bleiben stehen", !/--k/.test(weg.stil), weg.stil);
  stand.ist("Zeiger weg: die Karte steht wieder gerade",
    weg.transform === "none" || weg.transform === "matrix(1, 0, 0, 1, 0, 0)",
    weg.transform);

  /* --- Foil ---------------------------------------------------------------- */
  stand.gleich("nur die Foil-Karte trägt den Schimmer",
    await seite.evaluate(() => {
      const kl = [];
      for (const id of ["d0c0", "d0c1"]) {
        showCardDetail(id);
        kl.push(document.getElementById("dt-karte3d").classList.contains("karte3d-foil"));
      }
      return kl;
    }), [false, true]);

  /* --- Ohne Bild keine Bühne ---------------------------------------------- */
  stand.ist("der leere Rahmen bekommt keine Bühne",
    await seite.evaluate(() => {
      showCardDetail("d0c2");
      return !document.querySelector("#dt-karte3d") &&
             !!document.querySelector(".detail-bildspalte .detail-img-leer");
    }));

  /* --- Zweiseitige Karte: Umdrehen überlebt die Bühne ---------------------- */
  stand.gleich("die zweiseitige Karte liegt in der Bühne und dreht sich weiter",
    await seite.evaluate((bild) => {
      CARDS[0].faces = [
        { name: "Vorn", img: bild, type_line: "Creature", oracle_text: "" },
        { name: "Hinten", img: bild, type_line: "Land", oracle_text: "" },
      ];
      showCardDetail("d0c0");
      const flip = document.getElementById("dt-flip");
      const drin = !!document.querySelector("#dt-karte3d .karte3d-blatt > .detail-flip");
      flip.click();
      const gedreht = flip.classList.contains("flipped");
      const name = document.querySelector("#dt-face-top b").textContent;
      delete CARDS[0].faces;
      return [drin, gedreht, name];
    }, BILD), [true, true, "Hinten"]);

  /* --- Ohne schwebefähiges Zeigegerät wird nichts verdrahtet -------------- */
  stand.ist("ohne Schweben (Finger, Stift) bleibt der Effekt ungebunden",
    await seite.evaluate(() => {
      const echt = window.matchMedia;
      window.matchMedia = q => ({ matches: false, media: q });
      showCardDetail("d0c0");
      const el = document.getElementById("dt-karte3d");
      const gebunden = !!(el.onpointermove || el.onpointerenter || el.onpointerleave);
      window.matchMedia = echt;
      return !gebunden;
    }));

  /* --- Weniger Bewegung: Licht ja, Kippen nein ---------------------------- */
  await seite.emulateMedia({ reducedMotion: "reduce" });
  await seite.evaluate(() => showCardDetail("d0c0"));
  const k2 = await seite.locator("#dt-karte3d").boundingBox();
  await seite.mouse.move(k2.x + k2.width * 0.2, k2.y + k2.height * 0.2);
  // Auch hier auf den Zustand warten statt auf die Uhr: Der Glanz blendet in
  // 350 ms ein, und wer nach 120 ms misst, misst auf einem ausgelasteten
  // Läufer die Null von vorher. Genau daran ist diese Zeile im ersten Anlauf
  // gescheitert — hier grün, auf dem Läufer rot.
  const ruhig = await seite.evaluate(async () => {
    const el = document.getElementById("dt-karte3d");
    const glanz = el.querySelector(".karte3d-glanz");
    for (let i = 0; i < 80 && Number(getComputedStyle(glanz).opacity) === 0; i++)
      await new Promise(r => setTimeout(r, 25));
    return { transform: getComputedStyle(el.querySelector(".karte3d-buehne")).transform,
             glanz: getComputedStyle(glanz).opacity };
  });
  stand.ist("weniger Bewegung: die Karte kippt nicht", ruhig.transform === "none", ruhig.transform);
  stand.ist("weniger Bewegung: der Glanz bleibt", Number(ruhig.glanz) > 0, ruhig.glanz);
  await seite.emulateMedia({ reducedMotion: null });
}
