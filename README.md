# Workoutslop – motion i pauserne mellem dine kampe

Workoutslop er et motionsoverlay til computerspil. Appen kører i baggrunden, mens du spiller. Når der er en
pause i spillet, fx mellem to kampe, foreslår den en øvelse: armbøjninger, pull-ups, curls og meget mere.
En animation viser, hvordan øvelsen laves. Antallet af gentagelser passer til dit styrkeniveau og til, hvor
lang tid der er gået siden din sidste øvelse.

<p align="center"><img src="docs/overlay.png" width="340" alt="Overlayet foreslår 22 armbøjninger i en pause i Counter-Strike 2"></p>

## Sådan bruges den

1. **Start appen.** Første gang kommer en hurtig opsætning i fem trin. Den kan altid åbnes igen fra ikonet i
   systembakken (ved uret):
   - **Styrke** – Begynder, Let øvet, Øvet eller Stærk.
   - **Udstyr** – håndvægte, kettlebell, træningsbænk, pull-up bar, elastikker og/eller vægtstang. Uden
     udstyr får du kropsvægtsøvelser.
   - **Fokus** – hvad du vil træne: Bryst & skuldre, Ryg/nakke & holdning, Ben & mave, Arme – eller en
     kombination, fx Bryst & skuldre + Arme. Vælger du intet, får du hele kroppen.
   - **Pauser** – hvor ofte du vil træne, om inaktivitet skal tælle som pause, og hvilket hjørne overlayet
     skal vises i.
   - **Spil** – de spil appen kender, dine egne spil og den præcise integration til CS2 og Dota 2.

   <img src="docs/setup.png" width="640" alt="Opsætningen: valg af redskaber">
2. **Spil som normalt.** Workoutslop opdager selv, når et spil kører.
3. **Lav øvelsen, når overlayet dukker op**, og tryk **Færdig**. Du kan også vælge **Anden** (en anden
   øvelse), **Om 10 min** (udsæt) eller **✕** (spring over).
4. Starter næste kamp, før du har trykket på noget, bliver overlayet til en lille bjælke: "Nåede du det?"

### Genvejstaster (virker også inde i spillet)

| Tast         | Funktion                        |
| ------------ | ------------------------------- |
| `Ctrl+Alt+W` | Vis en øvelse nu                |
| `Ctrl+Alt+D` | Markér øvelsen som færdig       |
| `Ctrl+Alt+S` | Spring øvelsen over             |

Fra bakkeikonet kan du også skifte fokus (**Træn: …**), sætte motionen på pause (30 min, 1 time eller resten
af dagen) og se, hvor mange øvelser du har lavet i dag.

> **Tip:** Kør spillet i **kantløst vindue** (borderless/windowed fullscreen). I "eksklusiv fuldskærm" kan
> intet program vises ovenpå spillet.

## Sådan virker den

### 1. Hvilket spil kører?

Hvert 5. sekund henter appen listen over kørende programmer (`tasklist` på Windows, `ps` på macOS/Linux) og
sammenligner med en liste over kendte spil, fx `cs2.exe`, `VALORANT-Win64-Shipping.exe` og
`RocketLeague.exe`. Du kan selv tilføje flere spil i opsætningen.

### 2. Er der en pause?

Appen bruger det bedste signal, den har for det spil, du spiller:

| Signal                    | Spil                          | Hvordan                                                                                   |
| ------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Game State Integration** | Counter-Strike 2, Dota 2     | Spillet sender selv sin tilstand til appen. Pause = i menuen eller kampen er slut.        |
| **Lobby/kamp-processer**  | League of Legends             | Klienten kører hele tiden, men selve kampen er et separat program. Kun klient = lobby.   |
| **Inaktivitet**           | Alle andre spil               | Ingen mus/tastatur i fx 25 sekunder, mens spillet kører = kø, loadingskærm eller lobby. |

De præcise signaler skal være stabile i 2 sekunder, før appen tror på dem, så et enkelt mærkeligt
datapunkt ikke får overlayet til at blinke.

**CS2/Dota 2-integration:** Tryk **Installér** i opsætningen. Appen finder spillet i dine Steam-biblioteker og
lægger en lille konfigurationsfil (`gamestate_integration_workoutslop.cfg`) i spillets `cfg`-mappe. Spillet
sender så sin tilstand til `http://127.0.0.1:3417`. Kun beskeder med appens hemmelige nøgle bliver
accepteret. Dota 2 kræver desuden startindstillingen `-gamestateintegration` i Steam.

### 3. Hvor mange gentagelser?

Hver øvelse har en grundmængde for hvert styrkeniveau (fx armbøjninger: 5 / 10 / 18 / 28). Den ganges med en
faktor, der afhænger af tiden siden din sidste øvelse:

| Tid siden sidste øvelse | Faktor | Armbøjninger på "Øvet" |
| ----------------------- | ------ | ---------------------- |
| Lige nu                 | 0,5×   | 9                      |
| 10 min.                 | 0,8×   | 14                     |
| 20 min.                 | 1,0×   | 18                     |
| 45 min.                 | 1,2×   | 22                     |
| 90 min. eller mere      | 1,4×   | 25                     |

Kort tid siden betyder trætte muskler og færre gentagelser. Lang tid betyder mere overskud. Er der gået
mere end 6 timer, starter du forfra med normal mængde, fordi du ikke er varmet op. Øvelser på tid (planke,
vægsid, hæng i stangen) rundes til hele 5 sekunder og har en indbygget timer.

### 4. Hvilken øvelse?

Kun øvelser, der passer til dit udstyr, dit niveau og dit fokus, kan vælges. En øvelse kan høre til flere
fokusområder – pull-ups tæller fx både som ryg og arme. Passer ingen øvelser til dit fokus med det udstyr, du
har, får du en øvelse fra hele kroppen i stedet. For variationens skyld gøres det mindre
sandsynligt at få samme øvelse som sidst, en øvelse fra den seneste time eller den samme muskelgruppe som
sidst. Øvelser med dit eget udstyr bliver valgt lidt oftere.

## Hvad er den bygget af?

Appen er skrevet i **JavaScript, HTML og CSS** med **[Electron](https://www.electronjs.org/)**. Electron
gør det muligt at lave et gennemsigtigt vindue, der altid ligger øverst, at registrere globale genvejstaster,
at have et ikon i systembakken og at læse, hvor længe mus og tastatur har været inaktive.

```
src/
  core/                    Logikken – ren JavaScript uden Electron, så den kan testes
    catalog.js             Styrkeniveauer, udstyr, fokusområder, muskelgrupper
    exercises.js           Alle 44 øvelser med mængder, trin og tips
    workout-engine.js      Vælger øvelse og udregner antal gentagelser
    games.js               Kendte spil og genkendelse af kørende programmer
    gsi.js                 CS2/Dota 2 Game State Integration
    pause-detector.js      Afgør om der er pause lige nu
    coach.js               Bestemmer hvornår overlayet vises, gøres lille eller skjules
    settings.js, stats.js  Indstillinger og dagens statistik
  main/                    Electron-hovedprocessen
    main.js                Vinduer, bakkeikon, genvejstaster og løkken der kører hvert sekund
    preload.js             Sikker bro mellem siderne og hovedprocessen
    gsi-server.js          Lokal webserver som CS2/Dota 2 sender til
    gsi-install.js         Finder spillet i Steam og installerer cfg-filen
    process-list.js        Henter listen over kørende programmer
    store.js               Gemmer indstillinger og historik som JSON
  renderer/                Det brugeren ser
    setup/                 Opsætningen (5 trin)
    overlay/               Overlayet med øvelsen
    shared/figure.js       Tegner og animerer tændstikmanden
    shared/animations.js   Bevægelserne til alle øvelser
test/                      Automatiske tests (node --test)
tools/gallery.html         Viser alle animationer – åbn filen i en browser
assets/                    Ikoner til appen og systembakken
.github/workflows/         Bygger Windows-programmet automatisk på GitHub
```

Indstillinger og historik gemmes i `%APPDATA%\Workoutslop` på Windows (`~/Library/Application Support/Workoutslop`
på macOS, `~/.config/Workoutslop` på Linux).

### Animationerne

Tændstikmanden er bygget som et lille skelet. Hver øvelse består af nogle få nøgleposer, og animationen
glider mellem dem. Hænder og fødder kan "låses" til et punkt (fx hænderne i gulvet under en armbøjning), og
så udregnes albue og knæ med *invers kinematik*, så arme og ben altid har samme længde.

## Kom i gang (udvikling)

Kræver [Node.js](https://nodejs.org/) 20 eller nyere.

```bash
npm install
npm start        # start appen
npm test         # kør de automatiske tests
```

Vil du prøve med en tom profil (fx for at se opsætningen igen), kan du starte sådan:

```bash
WORKOUTSLOP_DATA_DIR=.workoutslop-data npm start
```

(På Windows i PowerShell: `$env:WORKOUTSLOP_DATA_DIR=".workoutslop-data"; npm start`)

## Byg et rigtigt program (.exe)

### Lad GitHub bygge det (nemmest)

Hver gang du pusher til GitHub, tester og bygger `.github/workflows/build.yml` appen på en Windows-maskine:

1. Gå til fanen **Actions** på GitHub og klik på den seneste kørsel af **Byg Workoutslop**.
2. Hent **Workoutslop-Windows** under **Artifacts** og pak zip-filen ud.
3. Indeni ligger:
   - `Workoutslop-Setup-0.1.0.exe` – installationsprogram (genvej på skrivebordet og i startmenuen).
   - `Workoutslop-0.1.0-portable.exe` – kører uden installation, fx fra et USB-stik eller en skolecomputer.

Vil du dele programmet med andre, så ret `version` i `package.json`, commit og push et tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Så lægges `.exe`-filerne op under **Releases**, hvor alle kan hente dem.

### Byg det på din egen Windows-computer

```bash
npm install
npm run dist
```

Programmerne havner i mappen `dist/`. På macOS og Linux hedder kommandoerne `npm run dist:mac` og
`npm run dist:linux`.

> **"Windows beskyttede din pc":** Programmet er ikke signeret med et (dyrt) kodesigneringscertifikat, så
> Windows SmartScreen advarer første gang. Klik **Flere oplysninger → Kør alligevel**.

### Tilføj en øvelse

1. Tilføj øvelsen i `src/core/exercises.js` (navn, muskelgruppe, udstyr, mængder pr. niveau, trin).
2. Lav en animation i `src/renderer/shared/animations.js`, eller genbrug en eksisterende.
3. Åbn `tools/gallery.html?frames` i en browser for at se nøgleposerne, og kør `npm test`. Testene tjekker
   blandt andet, at alle øvelser har en animation, og at figuren aldrig går igennem gulvet.

### Tilføj et spil

Tilføj spillets procesnavn til `KNOWN_GAMES` i `src/core/games.js`, eller tilføj det direkte i opsætningen.

## Kendte begrænsninger

- Overlayet kan ikke ses over spil i **eksklusiv fuldskærm** – brug kantløst vindue.
- Input fra **controller** tæller ikke som aktivitet i Windows. Slå inaktivitet fra, hvis du spiller med
  controller. Så bruges kun de præcise signaler og genvejstasten.
- Overlayet vises på hovedskærmen.
- Valorant, Fortnite og de fleste andre spil har ingen officiel måde at fortælle, hvornår en kamp slutter.
  Derfor bruges inaktivitet for dem.
