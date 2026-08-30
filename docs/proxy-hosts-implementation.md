**Proxy Hosts — Abschlussbericht vom 30. August 2026**

RentnerProxy verwaltet jetzt Proxy Hosts über die authentifizierte Route `/proxy-hosts`: mehrere Domains, CRUD, Aktivieren/Deaktivieren, RBAC, Shared Table, Formulare, Bestätigungsdialoge und Übersetzungen in en/de/es/fr.

Gespeichert wird ausschließlich der gewünschte Zustand in PostgreSQL. Es wird keine Proxy-Konfiguration angewandt und kein Traffic weitergeleitet. Die UI benennt diese Grenze ausdrücklich.

**Datenbank und Migration**

| Tabelle                         | Spalten                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| rentnerproxy.proxy_hosts        | id, forward_scheme, forward_host, forward_port, enabled, created_at, updated_at |
| rentnerproxy.proxy_host_domains | id, proxy_host_id, domain, created_at                                           |

Schema: [proxyHosts.ts](../web/src/db/Schema/proxyHosts.ts).
Generierte Migration: [0006_misty_viper.sql](../web/drizzle/0006_misty_viper.sql), zugehöriger Snapshot und Journal-Eintrag. Die vorhandenen Migrationen 0000–0005 bleiben unverändert. Ein zweiter Aufruf von `bun run db:generate` ergab keine weitere Schemaänderung und keine zusätzliche Migration.

Beide Tabellen verwenden UUIDv7 als Primärschlüssel und `timestamptz` mit `now()` für ihre Zeitstempel. Alle fachlichen Spalten sind NOT NULL. `enabled` hat den Default true. `updated_at` wird bei erfolgreichen Änderungen ausdrücklich im Service gesetzt, entsprechend den bestehenden Management-Services; es wurde keine neue Triggerstrategie eingeführt.

Constraints:

- `proxy_hosts_forward_scheme_check`: nur http/https.
- `proxy_hosts_forward_port_check`: Integer im Bereich 1–65535.
- `proxy_hosts_forward_host_check`: kein leerer oder nur aus Leerzeichen bestehender Host.
- `proxy_host_domains_domain_canonical_check`: kanonische ASCII-DNS-Labels, maximal 63 Zeichen pro Label; keine Großbuchstaben, Leerzeichen, abschließenden Punkte oder rein numerischen/IP-artigen Domains.
- `proxy_host_domains_domain_unique`: eine kanonische Domain ist global genau einem Proxy Host zugeordnet.
- `proxy_host_id` verweist auf `proxy_hosts.id`, mit ON DELETE CASCADE.

Indizes: `proxy_host_domains_proxy_host_id_idx` für die Zuordnung und `proxy_hosts_enabled_idx` für den Status. Der Unique-Constraint erzeugt bereits den Domain-Index; dafür gibt es keinen redundanten Index.

Der Service prüft Domain-Kollisionen vorab. Zusätzlich übersetzt er echte PostgreSQL-Unique-Verletzungen dieses Constraints sicher in einen Domainfehler, einschließlich verschachtelter Drizzle/Bun-Fehler. Die Datenbank entscheidet auch bei parallelen Requests endgültig über Eindeutigkeit.

Create und Update laufen vollständig in einer Transaktion. Update sperrt den betroffenen Host mit FOR UPDATE, prüft die Berechtigungen erneut und ersetzt anschließend dessen Domains atomar. Domain-Insertions erfolgen sortiert. Enable, Disable und Delete verwenden ebenfalls Transaktionen und Zeilensperren. Wiederholtes Enable/Disable desselben Zustands ergibt den kontrollierten Fehler `invalid_status_transition`, ohne den Zeitstempel zu verändern.

Der Client erhält nur id, domains, forwardScheme, forwardHost, forwardPort, enabled, createdAt und updatedAt. Domains werden deterministisch sortiert zurückgegeben. Es gibt kein zusätzliches Feld für eine „primäre“ Domain; die erste kanonisch sortierte Domain dient als kompakte Anzeige.

**Validierung und Normalisierung**

Die gemeinsame [Validierung](../web/src/features/Admin/ProxyHostManagement/validation.ts) wird im Formular, durch `.validator(...)` an der Server Function und erneut im Service verwendet.

Die zentrale [Normalisierung](../web/src/features/Admin/ProxyHostManagement/Helpers/proxyHostValidation.ts) entfernt äußere Leerzeichen, normalisiert DNS-Namen auf Kleinbuchstaben und entfernt einen abschließenden Punkt. Die standardisierte URL-API übernimmt Unicode → ASCII/Punycode; eine eigene Punycode-Implementierung oder zusätzliche Bibliothek wurde nicht eingeführt. Grundlage ist der [WHATWG-URL-Standard zur Domain-to-ASCII-Konvertierung](https://url.spec.whatwg.org/#concept-domain-to-ascii).

Beispiele: `Example.COM.` → `example.com`; `BÜCHER.example` → `xn--bcher-kva.example`.

| Eingabe                   | Regeln                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Domains                   | 1–50 Einträge; keine leeren Einträge und keine Duplikate nach Normalisierung; höchstens 253 ASCII-Zeichen insgesamt und 63 pro Label        |
| Lokale Namen              | Normale lokale DNS-Namen und Einzel-Labels wie backend oder localhost sind erlaubt; keine Beschränkung auf öffentliche TLDs                 |
| Unzulässige Proxy-Domains | URLs, Pfade, eingebettete Ports, Credentials, Query/Fragment, Unterstriche und IP-Adressen                                                  |
| Wildcards                 | Bewusst nicht unterstützt; auch *.example.com wird abgelehnt                                                                                |
| Forward Host              | DNS-Name einschließlich IDN, strikte IPv4-Adresse oder IPv6; optional eingegebene IPv6-Klammern werden entfernt und die Adresse kanonisiert |
| Unzulässige Forward Hosts | Scheme, separater Port im Host-Feld, Pfad, Query, Credentials, ungültige oder verkürzte IPv4-Schreibweisen sowie IPv6-Zonenkennungen        |
| Port                      | Ausschließlich Integer 1–65535; das Formular parst dezimale Texteingaben, keine Exponentialschreibweise oder Dezimalbrüche                  |
| Scheme                    | Ausschließlich http oder https                                                                                                              |

Die Forward-Anzeige setzt die getrennten Werte zu reinem Text zusammen; IPv6 erhält dort die benötigten Klammern. Daraus wird kein unkontrollierter klickbarer Link erzeugt.

**Permissions und Default-Rollen**

Alle Schlüssel und Laufzeitkonstanten liegen in der bestehenden [Permission-Registry](../web/src/config/permissions.config.ts).

| Permission          | Runtime-Konstante               | Owner | Admin | Viewer | Custom: automatisch neu vergeben |
| ------------------- | ------------------------------- | ----- | ----- | ------ | -------------------------------- |
| proxy_hosts.view    | PERMISSIONS.PROXY_HOSTS_VIEW    | Ja    | Ja    | Ja     | Nein                             |
| proxy_hosts.create  | PERMISSIONS.PROXY_HOSTS_CREATE  | Ja    | Ja    | Nein   | Nein                             |
| proxy_hosts.update  | PERMISSIONS.PROXY_HOSTS_UPDATE  | Ja    | Ja    | Nein   | Nein                             |
| proxy_hosts.delete  | PERMISSIONS.PROXY_HOSTS_DELETE  | Ja    | Ja    | Nein   | Nein                             |
| proxy_hosts.enable  | PERMISSIONS.PROXY_HOSTS_ENABLE  | Ja    | Ja    | Nein   | Nein                             |
| proxy_hosts.disable | PERMISSIONS.PROXY_HOSTS_DISABLE | Ja    | Ja    | Nein   | Nein                             |

Custom Roles können die sechs Rechte über die bestehende Role-Management-Gruppe „Proxy Hosts“ erhalten. Der vorhandene Registry-Sync wird unverändert wiederverwendet und bewahrt Custom-Zuweisungen. [db/migrate.ts](../web/src/db/migrate.ts) führt diesen Sync nach den Migrationen aus; ein erneutes Setup ist nicht nötig.

Route und Navigation benötigen VIEW. Der Add-Button benötigt CREATE; ActionMenu-Einträge sind nach UPDATE, DELETE, ENABLE und DISABLE getrennt. Ein Update, das zusätzlich den Aktivierungsstatus ändert, benötigt im Service auch das entsprechende ENABLE- oder DISABLE-Recht. Eine reine Editor-Rolle kann diese Grenze weder über die Checkbox noch durch einen manipulierten Request umgehen.

**Relevante tatsächliche Struktur**

Alle folgenden Pfade sind relativ zum Projektverzeichnis:

```text
web/
├── drizzle/
│   ├── 0006_misty_viper.sql
│   └── meta/
│       ├── 0006_snapshot.json
│       └── _journal.json
└── src/
    ├── config/proxy-hosts.config.ts
    ├── db/Schema/proxyHosts.ts
    ├── features/Admin/ProxyHostManagement/
    │   ├── Components/
    │   │   ├── DomainInputs.tsx
    │   │   ├── ProxyHostFormFields.tsx
    │   │   ├── ProxyHostFormModal.tsx
    │   │   ├── ProxyHostFormModalFooter.tsx
    │   │   ├── ProxyHostManagementPageView.tsx
    │   │   ├── ProxyHostTableActions.tsx
    │   │   ├── ProxyHostTableCells.tsx
    │   │   └── ProxyHostsTable.tsx
    │   ├── Helpers/
    │   │   ├── proxyHostTableActions.ts
    │   │   ├── proxyHostTableCells.ts
    │   │   └── proxyHostValidation.ts
    │   ├── Hooks/
    │   │   ├── useProxyHostFormLogic.ts
    │   │   ├── useProxyHostFormModal.ts
    │   │   ├── useProxyHostManagementLogic.ts
    │   │   ├── useProxyHostsTableColumns.ts
    │   │   └── useProxyHostsTableLogic.ts
    │   ├── Types/
    │   │   ├── proxy-host-form.types.ts
    │   │   ├── proxy-host-management.types.ts
    │   │   └── proxy-host-table.types.ts
    │   ├── index.tsx
    │   ├── queryKeys.ts
    │   ├── server.ts
    │   └── validation.ts
    ├── routes/_authenticated/proxy-hosts.tsx
    ├── server/Admin/ProxyHostManagement/
    │   ├── proxy-hosts.errors.ts
    │   └── proxy-hosts.service.ts
    ├── shared/Types/proxy-hosts.types.ts
    └── tests/
        ├── proxy-hosts-permissions.test.ts
        ├── proxy-hosts-postgresql.integration.test.ts
        ├── proxy-hosts-ui.test.tsx
        └── proxy-hosts-validation.test.ts
```

Hinzu kommen die gezielten Ergänzungen in Permission-Registry, Schema-Export, Role-Management-Gruppierung, Sidebar und Navigations-Typen, Route-Tree, en/de/es/fr sowie dem vorhandenen Architecture-Boundary-Test. Es gibt keine neue Repository-/Controller-/Use-Case-Schicht.

**Tatsächlicher Create-Flow**

| Schritt                 | Datei und Aufgabe                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. /proxy-hosts         | [Route](../web/src/routes/_authenticated/proxy-hosts.tsx): VIEW prüfen und Feature rendern                                                                                                                                                                                                                                                         |
| 2. Feature und Add      | [index.tsx](../web/src/features/Admin/ProxyHostManagement/index.tsx) und [useProxyHostManagementLogic.ts](../web/src/features/Admin/ProxyHostManagement/Hooks/useProxyHostManagementLogic.ts): Liste laden, Berechtigungen auswerten und Create öffnen                                                                                             |
| 3. Shared Modal         | [ProxyHostManagementPageView.tsx](../web/src/features/Admin/ProxyHostManagement/Components/ProxyHostManagementPageView.tsx) → [ProxyHostFormModal.tsx](../web/src/features/Admin/ProxyHostManagement/Components/ProxyHostFormModal.tsx) → [useProxyHostFormModal.ts](../web/src/features/Admin/ProxyHostManagement/Hooks/useProxyHostFormModal.ts) |
| 4. Form und Mutation    | [useProxyHostFormLogic.ts](../web/src/features/Admin/ProxyHostManagement/Hooks/useProxyHostFormLogic.ts): TanStack Form → [Zod-Schema](../web/src/features/Admin/ProxyHostManagement/validation.ts) → TanStack Query Mutation                                                                                                                      |
| 5. Transport und Rechte | [server.ts](../web/src/features/Admin/ProxyHostManagement/server.ts): createProxyHostHandler → .validator → CREATE prüfen                                                                                                                                                                                                                          |
| 6. Transaktion          | [proxy-hosts.service.ts](../web/src/server/Admin/ProxyHostManagement/proxy-hosts.service.ts): createProxyHostService → erneute Validierung/Berechtigung → Permission in der Transaktion → Kollisionsprüfung                                                                                                                                        |
| 7. Speicherung          | [proxyHosts.ts](../web/src/db/Schema/proxyHosts.ts): Drizzle → PostgreSQL, Host und Domains gemeinsam speichern                                                                                                                                                                                                                                    |
| 8. Rückkehr             | useProxyHostFormLogic invalidiert den zentralen Query-Key, zeigt den bestehenden Success-Toast und schließt das Modal nur bei Erfolg                                                                                                                                                                                                               |

Der stabile Query-Key `['admin', 'proxy-hosts']` ist in [queryKeys.ts](../web/src/features/Admin/ProxyHostManagement/queryKeys.ts) definiert. Es gibt kein globales Leeren des Query-Caches.

**Tatsächlicher Edit-Flow**

1. Auf `/proxy-hosts` öffnet [ProxyHostTableActions.tsx](../web/src/features/Admin/ProxyHostManagement/Components/ProxyHostTableActions.tsx) über das bestehende ActionMenu den Editor.
2. [useProxyHostManagementLogic.ts](../web/src/features/Admin/ProxyHostManagement/Hooks/useProxyHostManagementLogic.ts) hält den ausgewählten DTO; [ProxyHostFormModal.tsx](../web/src/features/Admin/ProxyHostManagement/Components/ProxyHostFormModal.tsx) zeigt die bestehenden Werte.
3. [useProxyHostFormLogic.ts](../web/src/features/Admin/ProxyHostManagement/Hooks/useProxyHostFormLogic.ts) validiert mit [validation.ts](../web/src/features/Admin/ProxyHostManagement/validation.ts). Soll ein aktiver Host deaktiviert werden, folgt vor dem Speichern ein zusätzlicher Shared ConfirmDialog.
4. [server.ts](../web/src/features/Admin/ProxyHostManagement/server.ts) führt updateProxyHostHandler mit Validator und UPDATE-Prüfung aus.
5. [proxy-hosts.service.ts](../web/src/server/Admin/ProxyHostManagement/proxy-hosts.service.ts) sperrt den Host, prüft UPDATE und gegebenenfalls ENABLE/DISABLE innerhalb der Transaktion, prüft Domains, aktualisiert den Host und ersetzt die Domains.
6. Drizzle speichert über [proxyHosts.ts](../web/src/db/Schema/proxyHosts.ts) atomar in PostgreSQL. Bei einem Fehler wird vollständig zurückgerollt.
7. Der Form-Hook invalidiert nach Erfolg die Liste, zeigt einen Toast und schließt. Bei Domain- oder Transportfehlern bleiben Modal und Eingaben erhalten.

**Tabelle, Formulare und Shared Components**

| Bereich          | Verhalten                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Spalten          | Domains, Forward Target, Status, Created, Actions; Actions entfallen für reine Viewer                                        |
| Domain-Anzeige   | Zwei kompakte Chips, zusätzliche Domains über +N und Shared Tooltip; lange Werte werden gekürzt                              |
| Suche            | Alle Domains einschließlich verborgener Aliase, Forward Host, Port, Scheme und Status, einschließlich lokalisierter Texte    |
| Filter           | Status, Scheme, Domain-Text und Created-Zeitraum                                                                             |
| Sortierung       | Created standardmäßig absteigend; Domains und Status ebenfalls sortierbar; keine Sortierung der Actions                      |
| Datumssortierung | Expliziter nativer TanStack-v9-Date-Vergleich; neueste/älteste Reihenfolge durch Regressionstest abgesichert                 |
| Pagination       | Bestehende clientseitige Pagination und Rows-per-page-Auswahl, initial 10 Zeilen                                             |
| Zustände         | Loading Skeleton, leere Liste, keine Suchtreffer und Fehler mit Wiederholen                                                  |
| Create/Edit      | Dasselbe Form-Grunddesign; wiederholbare Domain-Inputs mit stabilen Keys, Add/Remove, mindestens ein und höchstens 50 Inputs |
| Disable          | Shared ConfirmDialog; gilt ebenfalls für einen deaktivierenden Edit                                                          |
| Delete           | Shared ConfirmDialog; Abbrechen verändert nichts, Bestätigen löscht mit Cascade                                              |
| Enable           | Direkte Mutation ohne ConfirmDialog                                                                                          |
| Fehler           | Bestehende lokalisierte Toasts/FieldErrors; keine SQL- oder Transportdiagnosen im Client                                     |

Wiederverwendet werden [Shared Table](../web/src/shared/Table/index.tsx), [Modal](../web/src/shared/Modal/index.tsx), [ConfirmDialog](../web/src/shared/Modal/Components/ConfirmDialog.tsx), [ActionMenu](../web/src/shared/ActionMenu/index.tsx), Tooltip, Select und Toast. Die Shared-Table-Implementierung wurde nicht verändert. Alle neuen sichtbaren Labels, Hinweise, Validierungen, Berechtigungsnamen, Bestätigungen und Toast-Texte sind in en/de/es/fr vorhanden.

**Tests — tatsächlich ausgeführte Ergebnisse**

| Bereich                | Ergebnis                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Bun gesamt             | 315 bestanden, 0 fehlgeschlagen, keine übersprungenen Tests; 49 Dateien und 10.539 Assertions                         |
| PostgreSQL-Integration | 36 bestanden: 24 Auth/RBAC/Security, 2 bestehende DB-Tests, 10 neue ProxyHost-Tests                                   |
| Redis-Integration      | 5 dedizierte Tests bestanden; zusätzlich 4 gemeinsame PostgreSQL/Redis-Security-Tests innerhalb der oben genannten 24 |
| Rust                   | 5 bestanden, 0 fehlgeschlagen                                                                                         |
| Neue ProxyHost-Tests   | 42 insgesamt: 11 Validierung, 2 Registry/Permissions, 19 UI, 10 PostgreSQL                                            |

Die Integrationstests sind Teil der 315 Bun-Tests; die Kategorien dürfen nicht noch einmal zum Gesamtwert addiert werden.

Die neuen PostgreSQL-Tests prüfen mehrere kanonische Domains, UUIDv7, atomaren Update/Domain-Ersatz, Rollback bei Konflikten, echte Constraints, Delete-Cascade, Enable/Disable und Statusfehler. Ein konkurrierender Create-Test erlaubt genau einen Gewinner; ein echter Datenbank-Unique-Fehler wird über denselben Mapper wie im Service geprüft. Owner, Admin, Viewer und Custom Roles werden mit echten Sessions geprüft, einschließlich Rechteentzug und Statusänderung über Update. Registry-Sync lässt Custom-Zuweisungen unverändert. Ein Dedicated-DB-Guard läuft vor Cleanup und Registry-Mutationen.

Die UI-Tests prüfen Tabelle, Suche, Filter, Sortierung, Pagination, Modalwerte, Normalisierung, Duplikatkorrektur mit erfolgreichem Re-Submit, Domain-Add/Remove, Confirm-Abbrechen/Bestätigen, direkte Aktivierung, Toasts und Fehlererhalt. Der zusätzliche Date-Sortierungstest verwendet absichtlich abweichende Eingabe- und Domain-Reihenfolgen. Die neue UI-Suite benötigt keine Console-Mutes und erzeugt keine React-act-Warnungen.

Die bestehenden Übersetzungs- und Architekturtests bleiben grün. Der Production-Build besteht den bestehenden Import-Schutz. Ein zusätzlicher Scan der finalen Client-JavaScript-Dateien fand keine Server-/DB-Implementierungsmarker oder Secret-Umgebungsvariablen.

**Vollständige Verification**

| Prüfung                                                                                        | Ergebnis                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| bun install --frozen-lockfile                                                                  | Erfolgreich; Lockfile unverändert                                |
| bun outdated --latest                                                                          | Ausgeführt; verfügbare Updates nur geprüft, nicht installiert    |
| bun run format                                                                                 | Grün                                                             |
| bun run lint                                                                                   | Grün                                                             |
| bun run typecheck                                                                              | Grün                                                             |
| bun run test                                                                                   | Grün; abschließender Gesamtlauf zusätzlich über check            |
| bun run build                                                                                  | Web-Client, SSR-Server und Rust-Release grün                     |
| bun run db:generate, zweimal                                                                   | Genau eine neue Migration, danach keine Schemaänderung           |
| bun run db:check                                                                               | Grün                                                             |
| bun run check                                                                                  | All checks passed                                                |
| cargo fmt --check --manifest-path controller/Cargo.toml                                        | Grün                                                             |
| cargo clippy --manifest-path controller/Cargo.toml --all-targets --all-features -- -D warnings | Grün                                                             |
| cargo test --manifest-path controller/Cargo.toml                                               | 5 bestanden                                                      |
| cargo check --manifest-path controller/Cargo.toml                                              | Grün                                                             |
| cargo build --release --manifest-path controller/Cargo.toml                                    | Grün                                                             |
| Client-Grenzen                                                                                 | Architekturtests, Import-Protection und finaler Bundle-Scan grün |
| git diff --check                                                                               | Grün                                                             |
| Echte Browser-Abnahme                                                                          | Grün, einschließlich Production-Preview                          |

Für PostgreSQL wurden ausschließlich zwei gesonderte Datenbanken verwendet: `rentnerproxy_proxy_hosts_test_1788112319033` für Integrationstests und `rentnerproxy_proxy_hosts_ui_1788112868264` für UI-Prüfungen. Redis wurde über getrennte Test-Datenbanknummern 15 beziehungsweise 14 verwendet; es wurde kein globales FLUSH ausgeführt. Verbindungsdaten und synthetische Passwörter wurden nur im Prozess weitergegeben.

Die Browser-Abnahme erfolgte in einer separaten Chrome-Session ohne vorhandenes Benutzerprofil. Geprüft wurden die echte Route, Create mit mehreren Domains und IPv6, Edit, Suche, Filter, Datumsreihenfolge, Disable, Enable, Delete, Role-Management-Gruppe, Owner/Admin/Viewer/Custom-Unterschiede, persistenter Light/Dark Mode und 390-Pixel-Darstellung. Screenshots wurden visuell geprüft. Der abschließende Durchlauf gegen den Production-Build enthält 15 erfolgreiche Prüfpunkte und keine unbehandelten Browserfehler.

Beim langen Entwicklungsdurchlauf trat vorübergehend ein lokaler Verbindungsengpass auf; die normale Entwicklungsdatenbank hatte bereits 80 offene Leerlaufverbindungen. Diese Verbindungen und die zugehörigen Prozesse wurden nicht verändert. Der abschließende Production-Preview mit einem auf eine Verbindung begrenzten temporären Fixture-Prozess lief erfolgreich. Temporäre UI-Benutzer, Rollen und Proxy Hosts wurden entfernt, die eigenen Testserver beendet. Die dedizierten Datenbanken und Nachweise im ignorierten tmp-Verzeichnis bleiben für eine Wiederholung vorhanden.

**Dependencies und ausdrücklich nicht implementierter Umfang**

New dependencies: none. Package-Manifest und Bun-Lockfile bleiben unverändert. Es wurden keine privaten Packages, keine neue Validierungs- oder Icon-Bibliothek und keine neue Architektur eingeführt.

| Bereich                     | Status                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| Nginx/OpenResty integration | Nicht implementiert                                               |
| Rust ProxyHost API          | Nicht implementiert; Controller bleibt funktional bei GET /health |
| SSL/ACME                    | Nicht implementiert                                               |
| DDNS                        | Nicht implementiert                                               |
| CrowdSec                    | Nicht implementiert                                               |
| WebSockets                  | Nicht implementiert                                               |

Ebenso nicht implementiert: Config-Generierung, nginx -t, Apply/Reload/Rollback, Zertifikate, HTTP/2-/HTTP/3-/HSTS-Optionen, Caching, Compression, Access Lists, Forward-Header-Konfiguration, Advanced/Raw-Nginx-Config, Audit Log, Jobs/BullMQ, Live Logs und Traffic Statistics. Es gibt keine applied/synced/controller_status/nginx_status-Felder oder sonstige vorgezogene Future-Felder.

**Git und lokale Nutzung**

Branch: `main`. Zum Abschluss der Implementierung war nichts gestaged, committed oder gepusht. Der anschließende separate Auftrag gibt den Commit und Push der ausstehenden Änderungen frei. Stash, Reset, Rebase und Clean wurden nicht verwendet.

Der vorhandene Foundation-Stand wurde erhalten. Beim ersten Git-Check war die Working Copy bereits sauber; es lagen keine vorherigen lokalen Foundation-Diffs vor. Rust, Shared Table, Dependencies, Projektskripte und bestehende SQL-Migrationen wurden nicht verändert. Die Feature-Änderungen werden gemeinsam mit Migration, Tests und diesem Bericht in einem zusammenhängenden Feature-Commit veröffentlicht.

Die neue Migration wurde nur auf die dedizierten Testdatenbanken angewandt. Vor Nutzung gegen die normale Entwicklungsdatenbank ist dort einmal `bun run db:migrate` auszuführen; der vorhandene Ablauf synchronisiert dabei auch die neuen Permissions. Es wurde kein tatsächlicher Proxy-Traffic-Test durchgeführt, da dieser Entwicklungsschritt ausschließlich PostgreSQL Desired State verwaltet.
