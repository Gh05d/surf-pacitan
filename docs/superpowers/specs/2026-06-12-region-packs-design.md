# Region-Packs: Multi-Region-Wiederverwendung des Surf-Forecast-Codes

**Datum:** 2026-06-12
**Status:** Approved (Design-Review durch Owner)

## Ziel & Kontext

Die Codebase soll für zukünftige Surf-Regionen wiederverwendbar werden. Betriebsmodell:

- **Immer nur eine Region aktiv** pro Deployment (Owner zieht weiter, alte Region wird abgeschaltet/eingefroren). Kein Multi-Tenant.
- **Weltweit möglich** (auch DST-Zeitzonen wie Portugal/Marokko), nicht nur Indonesien.
- Jedes Deployment hat eine eigene Domain — die ist nirgends im Code referenziert (nginx-Vhost pro Deployment), bleibt ein reiner Deploy-Schritt.
- Neue Region anlegen = neuen `regions/<id>/`-Ordner schreiben + Thresholds tunen. Keine Code-Änderungen.

Verworfen wurden: Multi-Tenant-Server (eine Instanz, mehrere Domains — Overkill bei nur einer aktiven Region), Fork-pro-Region (Divergenz), Minimal-Vorbereitung (80 % der Arbeit bliebe liegen).

## 1. Struktur — ein Ordner pro Region

```
regions/
  pacitan/
    index.ts            # RegionConfig (typisiert)
    knowledge-base.ts   # Region-Teil des LLM-Prompts
  README.md             # Onboarding-Checkliste für neue Regionen
```

`RegionConfig` enthält:

- `id` (z.B. `"pacitan"`)
- Branding: Titel + Beschreibung (für HTML `<title>`, Meta, `manifest.json`, Header)
- `location` (Marine-Grid-Koordinate für Open-Meteo/StormGlass)
- `timezone` (IANA-Name, z.B. `"Asia/Jakarta"`)
- Open-Meteo-Wettermodell (z.B. `gfs_seamless` — Wahl ist küstenspezifisch)
- Swell-Picker-Schwellwerte (`SURF_SWELL_SECONDARY_*` — pro Region gegen Referenz-Forecast validiert)
- Verify-Referenz (Wisuki-Spot-URL o.ä. für `verify-vs-wisuki.ts`)
- `spots`: Array von `SpotDef`

`SpotDef` pro Spot:

- `id` — freier String (ersetzt die `SpotName`-Union)
- Label, Abkürzung, Emoji, Character-Beschreibung (ersetzt `SPOT_DISPLAY`)
- Map-Koordinaten (ersetzt Hardcoding in `SpotMap.tsx`)
- `facingDirection`
- komplette `SpotThresholds`
- Flag für die Falling-Tide-Kappung (Sandbank-Logik — nicht universell gültig)
- Array-Reihenfolge ersetzt das "west-to-east"-Ordering (Tiebreaks in `candidates.ts`, Anzeige-Reihenfolge)

Auswahl per Env `REGION` (Default `pacitan`). Unbekannte Region → Server bricht beim Start mit klarer Fehlermeldung ab. Pack wird beim Boot schema-validiert (Spot-Anzahl ≥ 1, Thresholds vollständig, Timezone gültig).

## 2. Client: Region zur Build-Zeit eingebacken

Pro Deployment läuft genau eine Region, der Build ist deployment-spezifisch → Vite importiert das Region-Pack **statisch zur Build-Zeit** (`REGION`-Env beim Build). Kein Runtime-Fetch, kein Ladezustand, strenge Typen.

- HTML-Titel und `manifest.json` werden beim Build aus dem Pack generiert.
- Komponenten iterieren über das Spot-Array statt über fix drei Spots.
- TideGraph-Rating-Strips: `STRIP_RESERVED` (bisher fix 77 px für 3 Strips) skaliert mit der Spot-Anzahl.

Alternative Runtime-Config (Client holt Config von der API) wurde verworfen — nur nötig, wenn ein Build mehrere Regionen bedienen müsste.

## 3. Zeitzone: IANA statt hartkodiertem +7

`UTC_OFFSET_HOURS = 7`, `todayWIB()`/`tomorrowWIB()` (Server **und** Client-Kopie in `RecommendationCard.tsx`) entfallen. Ersetzt durch Helpers auf Basis von `Intl.DateTimeFormat` mit dem Pack-Timezone-Namen — **pro Timestamp** konvertiert, kein fester Offset (DST-Korrektheit).

- Cron-Zeiten werden als **Lokalzeiten** konfiguriert ("Tides 00:00 lokal", "Recommendation 20:00 lokal"); der nächste UTC-Firing-Zeitpunkt wird tz-aware berechnet. Die eingebrannten 17:00/13:00 UTC entfallen.
- StormGlass-Parser (`utcToLocal`, `localDateStr`) werden tz-aware. Achtung auf die bekannten Timestamp-Gotchas: Extremes-Endpoint liefert UTC, Sea-Level echot den Request-Offset — Bucketing weiterhin über Epoch-Mathematik, Fixtures mit beiden Formaten bleiben bestehen.

## 4. Server-Seite

- `LOCATION`, Wettermodell, Swell-Schwellwerte kommen aus dem Pack statt aus `config.ts`.
- **Redis-Prefix bekommt die Region**: `surf:<regionId>:forecast:` etc. — verhindert, dass nach einem Regionswechsel auf demselben Server der alte Cache serviert wird.
- Knowledge-Base zweigeteilt: generischer Teil (Input-Format, Candidate-Window-Regeln, Task, Anti-Halluzination, Output-Schema) bleibt Code; regionaler Teil (Geografie, Spots, lokales Windmuster, Tidenhub-Interpretation/Spring-Neap-Schwellen, Saison) kommt aus `regions/<id>/knowledge-base.ts`.
- `validateRecommendation` prüft Spot-IDs gegen das aktive Pack (nicht gegen eine hartkodierte Liste).

## 5. Bewusst NICHT automatisiert: Region-Onboarding als Prozess

Threshold-Werte und Knowledge-Base einer neuen Region kann kein Refactor erzeugen — sie kommen aus lokalem Wissen + Validierung gegen einen Referenz-Forecast. `regions/README.md` dokumentiert die Checkliste:

1. Marine-Grid-Zelle wählen und gegen Referenz-Forecast prüfen (Pacitan-Lektion: Offshore- vs. Küsten-Zelle).
2. Open-Meteo-Wettermodell gegen Referenz validieren (`best_match` kann lokal kippen).
3. Spot-Thresholds tunen (Tide-Fenster, Swell-Richtung/-Höhe/-Periode, Wind).
4. `verify-vs-wisuki.ts` auf die neue Region zeigen lassen (Referenz-URL kommt aus dem Pack).
5. Knowledge-Base-Region-Teil schreiben.
6. Deploy: eigene Domain (nginx-Vhost), eigener Build-OutDir, `REGION`-Env in der systemd-Unit, ggf. eigener StormGlass-Key.

## 6. Migration & Tests

- Pacitan wird das erste Pack; Verhalten muss **identisch** bleiben. Gates: bestehende Tests + `bun run scripts/verify-vs-wisuki.ts` (100 % Bin-Agreement) + Vergleich des `/api/forecast`-Outputs vor/nach.
- Tests importieren das Pacitan-Pack **explizit** (nicht über die Env-Var) — deterministisch, Redis-frei wie bisher.
- Neu: Pack-Schema-Validierungstest, Timezone-Helper-Tests (inkl. DST-Übergang), Test für variable Spot-Anzahl (1 und z.B. 4 Spots) in Candidates/Rating.

## Risiken

- **SpotName-Union auflösen** zieht durch viele Dateien (Types, alle Komponenten, Candidates, Routes) — mechanisch, aber breit. TypeScript + Tests fangen das meiste.
- **Zeitzonen-Umbau** berührt die StormGlass-Parser mit ihren bekannten Timestamp-Gotchas — Fixtures mit beiden realen Formaten sind das Sicherheitsnetz.
- StormGlass-Quota: Verifikation nach dem Umbau sparsam restarten (Pre-Restart-Bundle-Check nutzen, `stormglassQuota` an `/api/status` prüfen).
