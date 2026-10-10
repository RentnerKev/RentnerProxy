# Welche Workflows wofür zuständig sind

Für normale Änderungen sind **CI**, **Workflow Lint**, **Gitleaks**, **CodeQL**,
**Dependency Review** und **Production Smokes** die grundlegenden Prüfungen.
Die Image-Sicherheitsprüfung ergänzt sie um verbindliche Cargo-/Bun-Audits des
Produktionsimages und informative Berichte zu dessen externen Laufzeitkomponenten.
Ein Push auf `main` veröffentlicht kein Dev-Image;
**Dev Image** wird ausdrücklich manuell gestartet.

Die Dateien bleiben getrennt, weil sie unterschiedliche Auslöser, Rechte oder
Artefaktübergaben haben. Es gibt 21 Workflow-Dateien, davon zwei wiederverwendbare
Bausteine, die ausschließlich von anderen Workflows aufgerufen werden.
Zusätzlich erstellt GitHub automatisch den Lauf **Dependency Graph** zur Pflege
des Abhängigkeitsgraphen. Er stammt aus GitHubs integrierter Dependabot-Automation.

| Workflow                                                           | Startet bei                                                        | Aufgabe                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CI](workflows/ci.yml)                                             | PR zu `main`, Push auf `main`, manuell                             | Format, Lint, Typecheck, Web- und Fuzz-Tests, Rust, Produktionsbuild.                                                                                                              |
| [Workflow Lint](workflows/workflow-lint.yml)                       | PR, Push, manuell                                                  | YAML/Actions mit actionlint und Automations-Shellskripte mit ShellCheck prüfen.                                                                                                    |
| [Gitleaks](workflows/gitleaks.yml)                                 | PR, Push, manuell                                                  | Neue Commits auf Geheimnisse prüfen; manuell vollständige Historie.                                                                                                                |
| [CodeQL](workflows/codeql.yml)                                     | PR, Push, wöchentlich, manuell                                     | JavaScript/TypeScript, Rust und GitHub Actions analysieren.                                                                                                                        |
| [Dependency Review](workflows/dependency-review.yml)               | PR                                                                 | Neue Abhängigkeiten auf Advisories ab Schweregrad „moderate“ prüfen.                                                                                                               |
| [Bun Audit](workflows/bun-audit.yml)                               | PR/Push bei Manifest- oder Lockfile-Änderung, wöchentlich, manuell | Bun-Abhängigkeiten ab Schweregrad „moderate“ prüfen.                                                                                                                               |
| [Deployed Dependency Security](workflows/dependency-security.yml)  | PR, Push, täglich, manuell                                         | Cargo-Lockfile, Produktionskandidat und ausgewählte veröffentlichte Images bewerten; Details unten.                                                                                |
| [OpenSSF Scorecard](workflows/scorecard.yml)                       | Push, wöchentlich                                                  | Repository-/Lieferkettenbewertung; SARIF als Artefakt und in Code Scanning.                                                                                                        |
| [Production Smokes](workflows/production-smokes.yml)               | PR, Push, manuell                                                  | Isolierte Proxy-, Appliance-, Backup/Restore-, Drain-, ACME- und TLS-Prüfungen.                                                                                                    |
| [Release Compatibility](workflows/release-compatibility.yml)       | Betroffene PRs/Pushes, wöchentlich, manuell                        | Historische Release-Images auf den aktuellen Stand aktualisieren und Zustand prüfen. PR: `fresh`/Alpha 6; Push: Alpha 4–6; Zeitplan/manuell: vollständige oder ausgewählte Matrix. |
| [Runtime Reliability](workflows/runtime-reliability.yml)           | Betroffene PRs/Pushes, wöchentlich, manuell                        | PR/Push: kurzes Profil mit aktuellem Build. Zeitplan: langes Profil mit aktuellem Build und Alpha 6.                                                                               |
| [Runtime Scale](workflows/runtime-scale.yml)                       | Betroffene PRs/Pushes, manuell                                     | Begrenzte Proxy-Last: standardmäßig 100 Hosts, vier Worker, drei Runden; Laufzeitlimit zehn Minuten.                                                                               |
| [PR Title](workflows/pr-title.yml)                                 | PR, auch Titeländerung                                             | Conventional-Commit-Titel prüfen und Nachweis der getesteten Merge-SHA für Previews speichern.                                                                                     |
| [PR Labeler](workflows/pr-labeler.yml)                             | PR-Metadaten                                                       | Labels aus Dateipfaden vergeben; benötigt Schreibrechte auf PR-Metadaten.                                                                                                          |
| [Duplicate Triage](workflows/duplicate-triage.yml)                 | Issue-/PR-Metadaten                                                | Mögliche Duplikate anhand von Metadaten erkennen.                                                                                                                                  |
| [PR Preview Build](workflows/pr-preview-build.yml)                 | Erfolgreicher PR-Title-Lauf                                        | Exakte getestete SHA und erforderliche Checks verifizieren, dann isoliertes OCI-Image bauen.                                                                                       |
| [PR Preview Publish](workflows/pr-preview-publish.yml)             | Erfolgreicher Preview-Build                                        | Vertrauenswürdige Artefaktübergabe und Checks erneut prüfen, Image bewerten und Preview veröffentlichen.                                                                           |
| [Dev Image](workflows/dev-image.yml)                               | Nur manuell                                                        | Aktuellen Dev-Kandidaten bauen, prüfen und über den Publisher als `:dev` veröffentlichen.                                                                                          |
| [RentnerProxy Release](workflows/release.yml)                      | GitHub-Release wird veröffentlicht                                 | Alpha/Beta/Stable auswählen und Release-Pipeline aufrufen.                                                                                                                         |
| [RentnerProxy Release Pipeline](workflows/release-pipeline.yml)    | Nur durch Release-Workflow                                         | Exakte Release-Identität prüfen, Image bauen/bewerten/veröffentlichen und Release Notes aktualisieren.                                                                             |
| [Publish assessed OCI image](workflows/publish-assessed-image.yml) | Nur durch Dev-/Release-Pipeline                                    | Kandidat und Digest unabhängig erneut prüfen und erst danach Registry-Tags veröffentlichen.                                                                                        |

PR und Push bedeuten in dieser Tabelle `main`, sofern die Zeile nichts anderes
angibt. „Betroffen“ bezeichnet die jeweiligen `paths`-Filter. Zeitpläne laufen
auf dem Standardbranch; die Cron-Zeiten in den YAML-Dateien sind UTC.

## Umfang der Dependency-Prüfung

**Deployed Dependency Security** prüft RentnerProxys vollständige Cargo- und
Bun-Lockfiles verbindlich. Alle RustSec-Befunde sowie Bun-Befunde ab „moderate“
und unvollständige eigene Audits lassen den Check fehlschlagen. Die bestehenden
Check-Namen bleiben erhalten, weil GitHub-Regeln und Preview-Prüfungen sie nutzen.

Debian, Caddy, CrowdSec und andere externe Laufzeitkomponenten werden informativ
bewertet. Deren Befunde und Scannerfehler erscheinen im Bericht und blockieren
den Check nicht. Grün bestätigt ausschließlich die eigenen Dependency-Gates;
es ist keine Aussage, dass das gesamte Image frei von Schwachstellen ist.

Veröffentlichte Images werden täglich und manuell erneut geprüft; bei PRs nur
bei Änderungen an Scannerintegration oder Kompatibilitätsdefinitionen. Eigene
Befunde im Dev-Image blockieren bei jedem Auslöser. Historische Release-Befunde
bleiben informativ, da Security-Fixes laut `SECURITY.md` den aktuellen `main`
betreffen. Ungültige Identitäten und unvollständige eigene Audits bleiben Fehler.
Der tägliche Lauf baut keinen neuen Kandidaten.

**Dev**, **Release** und **Preview Publish** prüfen vor dem Veröffentlichen
erneut die eigenen Abhängigkeiten des konkreten Images und dessen exakte
Identität. Nur ein frischer `own-dependencies-approved`-Bericht für genau diesen
Quellstand und Digest erlaubt die Veröffentlichung. Der frühere Dev-Schalter
für temporäre Advisory-Ausnahmen wurde entfernt.

## Was tatsächlich erforderlich ist

Die effektiven GitHub-Regeln für `main` wurden am 9. Oktober 2026 geprüft. Sie
fordern eine aktuelle PR-Basis und diese 16 Checks:

- `Format`, `Lint`, `Typecheck`, `Web Tests`, `Rust`, `Build`
- `Workflow Lint`, `PR Title`, `Dependency Review`, `Gitleaks`
- `CodeQL (JavaScript / TypeScript)`, `CodeQL (Rust)`, `CodeQL (GitHub Actions)`
- `Production Smokes`, `Locked Cargo advisory audit`,
  `Complete production image advisory assessment`

Die Preview-Prüfung liest die effektiven Regeln aus GitHub und überprüft auch
die Herkunft der Checks für die exakte getestete SHA. Diese Liste ist eine
Momentaufnahme; die GitHub-Regeln bleiben maßgeblich. Die anderen Prüfungen
liefern zusätzliche Abdeckung, sind derzeit aber keine erforderlichen Checks.
Check- und Workflow-Namen sollten deshalb nur zusammen mit ihren Verbrauchern
und Repository-Regeln geändert werden.

## Kurze und lange Laufzeittests

Das Reliability-Profil `short` ist auf 120 Sekunden mit drei Iterationen
ausgelegt; `long` auf 1.800 Sekunden mit 120 Iterationen. Build/Einrichtung kommen
zur Laufzeit hinzu. Normale PRs und Pushes wählen automatisch `short`. Der
bestehende Wochenplan und die manuelle Voreinstellung wählen `long`; für eine
kurze manuelle Kontrolle ausdrücklich `short` auswählen.

Bei normalen Änderungen werden keine zusätzlichen 30-Minuten-Läufe manuell
gestartet oder abgewartet. Zusätzliche Langtests gehören zur
Release-Vorbereitung oder zu einer ausdrücklichen Anforderung. Die bestehenden
Zeitpläne bleiben davon unabhängig aktiv. Runtime Scale hat ein begrenztes
Zehn-Minuten-Limit; sein Job-Timeout von 30 Minuten ist kein 30-Minuten-Profil.

## Versionspflege

Bun wurde am 10. Oktober 2026 auf `1.4.3` mit nativer Typprüfung aktualisiert.
Am 9. Oktober 2026 gegen die offiziellen Upstream-Releases geprüft: Rust
`1.99.0`, actionlint `1.7.12` und die in YAML kommentierten Action-Versionen.
Alle externen Actions bleiben auf vollständige Commit-SHAs
gepinnt. Die CodeQL-Action verwendet ihre eigene SemVer-Release; ein neueres
`codeql-bundle-*`-Tag ist keine Action-Version. Dependabot übernimmt laufende
Updates gemäß [dependabot.yml](dependabot.yml).

Docker-Hub-Images werden über Googles Cache `mirror.gcr.io` geladen, damit die
gemeinsamen Download-Limits der CI-Runner den Build nicht abbrechen. Die
gepinnten Digests wurden gegen die ursprünglichen Images geprüft; der Mirror
ändert deren Inhalt nicht. Das gilt auch für das Dockerfile-Frontend.

Für Skriptzuständigkeiten und vertrauenswürdige Checkouts siehe
[AUTOMATION.md](AUTOMATION.md).
