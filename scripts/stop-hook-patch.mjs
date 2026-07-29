#!/usr/bin/env node
/* Flickt den Stop-Hook der Arbeitsumgebung, der nach jedem Squash-Merge
   fälschlich Alarm schlägt.

   DAS PROBLEM. Der Hook (~/.claude/stop-hook-git-check.sh) prüft den Bereich
   „origin/<zweig>..HEAD" auf Commits, die GitHub als Unverified zeigt, und auf
   ungepushte Commits. Nach einem Squash-Merge stimmt dieser Bereich nicht mehr:

     * der Fernzweig zeigt weiter auf den Stand VOR dem Merge,
     * der lokale Zweig wird auf main zurückgesetzt (so verlangt es die
       Anleitung für Folgearbeit an einem zusammengeführten Pull Request),
     * GitHubs Merge-Commit liegt damit im geprüften Bereich.

   Dort sieht er aus wie ein lokaler Commit, der weder signiert noch gepusht
   ist. Er ist beides nicht: Gepusht ist er längst, und signiert hat ihn GitHub
   (noreply@github.com), nicht dieser Rechner. Ein „git commit --amend", wie der
   Hook vorschlägt, schriebe veröffentlichte Geschichte um — auf einem Zweig, von
   dem GitHub Pages und Vercel ausliefern.

   Das trifft genau die Arbeitsweise, die in CLAUDE.md steht: Squash mergen,
   Zweig zurücksetzen. Also bei JEDEM Pull Request.

   DIE BEHEBUNG. Beide Prüfungen klammern aus, was schon auf dem voreingestellten
   Fernzweig liegt — veröffentlichte Geschichte statt lokaler Arbeit. Aus
   „origin/<zweig>..HEAD" wird „HEAD --not origin/<zweig> origin/main".

   Was wirklich lokal entstanden ist, liegt nicht auf main und wird unverändert
   geprüft. Nachgemessen: ein eigener Commit mit falscher Identität und ein
   unsignierter werden weiter gemeldet, GitHubs Merge-Commit nicht mehr.

   WARUM DAS SKRIPT ÜBERHAUPT IM REPOSITORY LIEGT. Der Hook wird bei jeder
   Bereitstellung eines Containers neu geschrieben (~/.claude/ und /root/.ccr/
   tragen denselben Zeitstempel). Eine Änderung daran überlebt die Sitzung nicht,
   das Repository schon. Ein .claude/settings.json im Projekt hülfe übrigens
   nicht: Hooks aus verschiedenen Quellen werden zusammengeführt, nicht ersetzt —
   man kann einen zweiten hinzufügen, den des Launchers aber nicht abschalten.

   Das hier ist ein Notnagel, keine Lösung. Die gehört dorthin, wo der Hook
   herkommt (in Claude Code über /bug melden).

   Aufruf:
     node scripts/stop-hook-patch.mjs            # anwenden (mehrfach gefahrlos)
     node scripts/stop-hook-patch.mjs --pruefen  # nur melden, Exit 1 wenn offen
*/

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOOK = process.env.STOP_HOOK_PFAD || join(homedir(), ".claude", "stop-hook-git-check.sh");
const nurPruefen = process.argv.includes("--pruefen");

/* Die Einfügung. Anker ist der Kommentar, der die erste Prüfung einleitet —
   er steht direkt hinter der Bestimmung von $upstream. */
const ANKER = '  # Check for local commits that GitHub will show as "Unverified": either no';
const EINSCHUB = `  # Anything already on the remote DEFAULT branch is published history, not
  # local work — even when this branch's own remote ref still points elsewhere.
  #
  # That is exactly the state after every squash merge: the remote branch still
  # points at the pre-merge head, the local branch gets reset onto the target
  # branch, and GitHub's merge commit therefore falls inside "upstream..HEAD".
  # There it looks like a local commit that is neither signed nor pushed. It is
  # neither — pushed it has long been, and signed it was by GitHub rather than
  # by this machine. Amending it would mean rewriting published history.
  #
  # Both checks below exclude it. Whatever was genuinely created locally is not
  # on the default branch and is still checked.
  except=("$upstream")
  for ref in origin/HEAD origin/main origin/master; do
    if git rev-parse --verify -q "$ref" >/dev/null; then except+=("$ref"); break; fi
  done

`;

/* Die beiden Bereiche. Beide MÜSSEN ersetzt werden: Bliebe der zweite stehen,
   wäre nur die Signaturmeldung gegen „1 unpushed commit" über denselben Commit
   getauscht. */
const ERSETZUNGEN = [
  {
    alt: `    unverifiable=$(git log --format='%h %G? %ce' "$upstream..HEAD" 2>/dev/null | awk '$2 == "N" || $3 != "noreply@anthropic.com"')`,
    neu: `    # Zwei Änderungen. Erstens der Bereich (siehe oben). Zweitens die Frage,
    # ob eine Signatur DA ist — dafür taugt %G? hier nicht.
    #
    # %G? verifiziert. Bei SSH-Signaturen braucht das gpg.ssh.allowedSignersFile;
    # ist die nicht eingerichtet (hier der Fall, die Schlüsseldatei ist sogar
    # leer), meldet git "N" — dasselbe wie für einen gar nicht signierten
    # Commit. Die ursprüngliche Annahme, unverifizierbare Signaturen kämen als
    # B/U/E zurück, gilt für SSH also nicht: JEDER frisch erzeugte Commit sähe
    # unsigniert aus, sobald er am Zugende noch nicht gepusht ist.
    #
    # Gefragt wird deshalb das Commit-Objekt selbst: Trägt sein KOPF (alles bis
    # zur ersten Leerzeile) eine gpgsig-Zeile, ist es signiert. Das ist keine
    # Verifikation, aber genau das, was hier gebraucht wird — und ein wirklich
    # unsignierter Commit wird weiterhin gemeldet.
    unverifiable=$(git log --format='%h %ce' HEAD --not "\${except[@]}" 2>/dev/null |
      while read -r sha email; do
        if [[ "$email" != "noreply@anthropic.com" ]] ||
           ! git cat-file commit "$sha" 2>/dev/null | sed -n '/^$/q;p' | grep -q '^gpgsig'; then
          echo "$sha $email"
        fi
      done)`,
  },
  {
    alt: `  unpushed=$(git rev-list "$upstream..HEAD" --count 2>/dev/null) || unpushed=0`,
    neu: `  # Same exclusion here: without it the signature warning would merely be
  # traded for an "unpushed commit" warning about the very same merge commit.
  unpushed=$(git rev-list --count HEAD --not "\${except[@]}" 2>/dev/null) || unpushed=0`,
  },
];

const raus = (text, code = 0) => { console.log(text); process.exit(code); };

if (!existsSync(HOOK)) {
  // Kein Hook, kein Problem — etwa auf einem Rechner ohne diese Arbeitsumgebung.
  raus(`Kein Stop-Hook unter ${HOOK} — nichts zu tun.`);
}

let quelle = readFileSync(HOOK, "utf8");

if (quelle.includes('except=("$upstream")')) {
  raus("Der Stop-Hook ist bereits geflickt — nichts zu tun.");
}

if (nurPruefen) {
  raus(`Der Stop-Hook ist NICHT geflickt: ${HOOK}\n` +
       "Anwenden mit: node scripts/stop-hook-patch.mjs", 1);
}

/* Stur prüfen, bevor geschrieben wird: Passt eine der drei Stellen nicht mehr,
   hat sich der Hook geändert. Dann lieber gar nichts anfassen und es sagen, als
   halb geflickt zurückzulassen — ein Hook, der nur zur Hälfte greift, meldete
   irreführenden Unsinn. */
const fehlend = [];
if (!quelle.includes(ANKER)) fehlend.push("den Anker vor der ersten Prüfung");
for (const { alt } of ERSETZUNGEN) if (!quelle.includes(alt)) fehlend.push(`die Zeile: ${alt.trim().slice(0, 60)}…`);
if (fehlend.length) {
  console.error(`Der Stop-Hook sieht anders aus als erwartet (${HOOK}).`);
  console.error("Nicht gefunden:");
  fehlend.forEach(f => console.error("  * " + f));
  console.error("Nichts geändert. Wahrscheinlich ist der Hook inzwischen selbst behoben.");
  process.exit(1);
}

copyFileSync(HOOK, HOOK + ".orig");
quelle = quelle.replace(ANKER, EINSCHUB + ANKER);
for (const { alt, neu } of ERSETZUNGEN) quelle = quelle.replace(alt, neu);
writeFileSync(HOOK, quelle);

console.log(`Stop-Hook geflickt: ${HOOK}`);
console.log(`Original gesichert: ${HOOK}.orig`);
console.log("Zurücknehmen: cp " + HOOK + ".orig " + HOOK);
