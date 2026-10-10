# Welche Workflows wofür zuständig sind

Für normale Änderungen prüfen **CI**, **Workflow Lint**, **Gitleaks**, **CodeQL**,
**Dependency Review**, **Deployed Dependency Security** und **Production Smokes**
den eigenen Code, seine Abhängigkeiten und die Integration der Appliance.
Jeder PR behält sein eigenes Docker-Preview-Image. Ein Push auf `main`
veröffentlicht kein Dev-Image; **Dev Image** wird manuell gestartet.

Es gibt 17 Workflow-Dateien, darunter zwei wiederverwendbare Bausteine für
Release und Veröffentlichung. GitHubs integrierte Dependabot-Automation erstellt
zusätzlich den Lauf **Dependency Graph**.

| Workflow                                                           | Startet bei                        | Aufgabe                                                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CI](workflows/ci.yml)                                             | PR, Push, manuell                  | Format, Lint, Skript-Typprüfung, Web-/Fuzz-Tests, Rust und Produktionsbuild. Der Web-Build prüft auch die Web-Typen.                               |
| [Workflow Lint](workflows/workflow-lint.yml)                       | PR, Push, manuell                  | Actions/YAML mit actionlint und Automations-Shellskripte mit ShellCheck prüfen.                                                                    |
| [Gitleaks](workflows/gitleaks.yml)                                 | PR, Push, manuell                  | Neue Commits auf Geheimnisse prüfen; manuell auch die vollständige Historie.                                                                       |
| [CodeQL](workflows/codeql.yml)                                     | PR, Push, wöchentlich, manuell     | Eigenes JavaScript/TypeScript, Rust und GitHub Actions analysieren.                                                                                |
| [Dependency Review](workflows/dependency-review.yml)               | PR                                 | Neu eingeführte Abhängigkeiten ab Schweregrad „moderate“ prüfen.                                                                                   |
| [Deployed Dependency Security](workflows/dependency-security.yml)  | PR, Push, täglich, manuell         | Eigene vollständige Cargo-/Bun-Lockfiles, Produktionskandidat und aktuelles Dev-Image prüfen; Details unten.                                       |
| [Production Smokes](workflows/production-smokes.yml)               | PR, Push, manuell                  | Proxy-, Appliance-, Backup/Restore-, Drain-, ACME- und TLS-Integration prüfen. Drei gemeinsame Images werden einmal pro Lauf gebaut.               |
| [Release Compatibility](workflows/release-compatibility.yml)       | Betroffene PRs/Pushes, manuell     | Backup-, Restore- und Upgrade-Kompatibilität prüfen. PR: `fresh`/Alpha 6; Push: Alpha 4–6; manuell standardmäßig Alpha 6, auf Wunsch alle Quellen. |
| [Runtime Reliability](workflows/runtime-reliability.yml)           | Betroffene PRs/Pushes, manuell     | Kurzes Profil mit aktuellem Build; lange Profile nur nach ausdrücklicher Auswahl.                                                                  |
| [Runtime Scale](workflows/runtime-scale.yml)                       | Nur manuell                        | Begrenzte Proxy-Last: standardmäßig 100 Hosts, vier Worker, drei Runden; Laufzeitlimit zehn Minuten.                                               |
| [PR Preview Source](workflows/pr-preview-source.yml)               | PR                                 | Exakte getestete Merge-SHA erfassen und den Herkunftsnachweis für das Preview speichern.                                                           |
| [PR Preview Build](workflows/pr-preview-build.yml)                 | Erfolgreicher Preview-Source-Lauf  | Getestete SHA und Pflichtchecks verifizieren, dann das eigene PR-Image als OCI-Archiv bauen.                                                       |
| [PR Preview Publish](workflows/pr-preview-publish.yml)             | Erfolgreicher Preview-Build        | Herkunft und Pflichtchecks erneut prüfen, eigene Image-Abhängigkeiten auditieren und das Preview veröffentlichen.                                  |
| [Dev Image](workflows/dev-image.yml)                               | Nur manuell                        | Dev-Kandidaten bauen, prüfen und über den Publisher als `:dev` veröffentlichen.                                                                    |
| [RentnerProxy Release](workflows/release.yml)                      | GitHub-Release wird veröffentlicht | Alpha/Beta/Stable auswählen und die Release-Pipeline aufrufen.                                                                                     |
| [RentnerProxy Release Pipeline](workflows/release-pipeline.yml)    | Durch Release-Workflow             | Exakte Release-Identität prüfen, Image bauen/bewerten/veröffentlichen und Release Notes aktualisieren.                                             |
| [Publish assessed OCI image](workflows/publish-assessed-image.yml) | Durch Dev-/Release-Pipeline        | Kandidat, Digest und eigene Abhängigkeiten unabhängig erneut prüfen, danach Registry-Tags veröffentlichen.                                         |

PR und Push bedeuten `main`. „Betroffen“ bezeichnet die jeweiligen `paths`-Filter.
Release Compatibility reagiert auf Backup/Restore, Kompatibilitätsfixtures und
deren Automations-/Starthelfer. Workflow-Cron-Zeiten sind UTC.

## Umfang der Dependency-Prüfung

**Own dependency audit** prüft die vollständigen Cargo- und Bun-Lockfiles des
Quellstands. Alle RustSec-Befunde, Bun-Befunde ab „moderate“ und unvollständige
eigene Audits lassen den Check fehlschlagen. **Production image dependency audit**
prüft zusätzlich die eingebetteten Locks des konkreten Produktionskandidaten.

Debian, PostgreSQL, Valkey, Caddy, CrowdSec und deren Go-Module werden nicht mehr
separat auf Upstream-Advisories gescannt. Eigene Konfigurationen und die Einbindung
dieser Komponenten bleiben durch Code- und Integrationstests abgedeckt. Grün
bestätigt die eigenen Cargo-/Bun-Gates, keine Bewertung der gesamten Appliance.

Täglich und manuell wird nur das aktuelle Dev-Image erneut geprüft. PRs mit
Änderungen an Scannerintegration lösen ebenfalls diesen Rescan aus. Eigene
Dev-Befunde, ungültige Identitäten und fehlende eingebettete Locks bleiben Fehler.
Der tägliche Lauf baut keinen Kandidaten und scannt keine historischen Releases.

**Dev**, **Release** und **Preview Publish** auditieren vor Veröffentlichung die
eigenen Abhängigkeiten des konkreten Images. Nur ein frischer
`own-dependencies-approved`-Bericht für den exakten Quellstand und Digest erlaubt
die Veröffentlichung. Es gibt keine Advisory-Ausnahme für Dev-Images.

Der separate Bun-Audit-Workflow entfällt: Sein vollständiger Lockfile-Audit steckt
im gemeinsamen Dependency-Check. Scorecard, automatische PR-Labels, Duplikat-Triage
und die Conventional-Commit-Titelpflicht entfallen ebenfalls. Die Label-Zuordnung
für Release Notes bleibt erhalten.

## Erforderliche Checks

Die effektiven GitHub-Regeln für `main` wurden am 10. Oktober 2026 mit den
Workflow-Namen abgeglichen. Sie fordern eine aktuelle PR-Basis und diese 16 Checks:

- `Format`, `Lint`, `Script Typecheck`, `Web Tests`, `Rust`, `Build`
- `Workflow Lint`, `PR Preview Source`, `Dependency Review`, `Gitleaks`
- `CodeQL (JavaScript / TypeScript)`, `CodeQL (Rust)`, `CodeQL (GitHub Actions)`
- `Production Smokes`, `Own dependency audit`, `Production image dependency audit`

Die Preview-Prüfung liest die effektiven Regeln aus GitHub und überprüft die
Herkunft der Checks für die exakte getestete SHA. Diese Liste ist eine
Momentaufnahme; die GitHub-Regeln bleiben maßgeblich. Check-/Workflow-Namen werden
zusammen mit ihren Verbrauchern und Repository-Regeln geändert.

## Kurze und lange Laufzeittests

Reliability `short` dauert 120 Sekunden mit drei Iterationen; `long` 1.800 Sekunden
mit 120 Iterationen. Build/Einrichtung kommen hinzu. Normale PRs und Pushes sowie
die manuelle Voreinstellung wählen `short` mit aktuellem Build. Der automatische
Wochenlauf entfällt.

Lange Profile und historische Reliability-Quellen bleiben ausdrücklich manuell
für Release-Vorbereitung oder eine konkrete Anforderung verfügbar. Runtime Scale
läuft nur manuell mit Zehn-Minuten-Limit; sein Job-Timeout von 30 Minuten ist kein
30-Minuten-Profil. Release Compatibility hat keinen Wochenplan; die vollständige
historische Matrix bleibt manuell verfügbar.

Production Smokes prüft die aktuelle Appliance. Historische Upgrade-Läufe liegen
in Release Compatibility. Gemeinsame Images sind auf den validierten Lauf und
Commit beschränkt; einzelne Smoke-Befehle bauen weiterhin selbst.

## Versionspflege

Bun wurde am 10. Oktober 2026 auf `1.4.3` mit nativer Typprüfung aktualisiert.
Am 9. Oktober 2026 gegen offizielle Upstream-Releases geprüft: Rust `1.99.0`,
actionlint `1.7.12` und die in YAML kommentierten Action-Versionen. Externe Actions
bleiben auf vollständige Commit-SHAs gepinnt. Die CodeQL-Action verwendet ihre
eigene SemVer-Release; ein neueres `codeql-bundle-*`-Tag ist keine Action-Version.

Dependabot prüft routinemäßige Versionsupdates montags um 03:00 Uhr Europe/Berlin,
gruppiert Minor-/Patch-Updates und lässt Security-Updates aktiv; siehe
[dependabot.yml](dependabot.yml).

Docker-Hub-Images werden über Googles Cache `mirror.gcr.io` geladen, damit
gemeinsame Download-Limits der CI-Runner Builds nicht abbrechen. Die gepinnten
Digests wurden gegen die ursprünglichen Images geprüft; das gilt auch für das
Dockerfile-Frontend.

Für Skriptzuständigkeiten und vertrauenswürdige Checkouts siehe
[AUTOMATION.md](AUTOMATION.md).
