# 8star Chat

Een eerste werkende versie van een white-label eventchat die als aparte iframe naast een livestream kan draaien. De app bevat drie losse schermen: de chat voor kijkers, een moderatorconsole en een afgeschermd sprekersscherm.

## Wat zit erin

- Events met eigen titel, kleuren, deelnemerlimiet en taalkeuze.
- Chat per event aan- of uitzetten; openbare berichten, privéberichten of beide.
- Openbare vragen blijven privé totdat een moderator ze goedkeurt. Publiceren kan voor de ingestelde taal of voor alle talen.
- Meerdere persoonlijke moderator- en stageaccounts per event.
- Moderatiequeue met taalfilter, afwijzen, privé beantwoorden en deelnemer blokkeren.
- Sprekersscherm toont alleen doorgestuurde vragen en regieberichten. Een moderator kan een tijdelijke stage-link maken; deze verloopt na twaalf uur. De spreker kan privé terugberichten sturen naar het moderatieteam.
- Iframe-code en CSV-export per event.
- Beperking van het aantal live chatverbindingen per event, berichtlengte, verzendsnelheid per bezoeker en het aantal openbare publicaties per seconde.
- Chatserver en livestreampagina draaien los van elkaar.

## Uitrollen via Dockhand

Dockhand kan Compose-stacks uit Git beheren en de Dockerfile bouwen als de repo- en contextmap de bestanden bevat. Zet de map `8star-chat` in een Git-repository en voeg in Dockhand een Git-stack toe met:

1. Compose-bestand: `8star-chat/compose.yaml`.
2. Context directory: `8star-chat` als deze map een submap in de repository is.
3. Zet **Build images on deploy** aan; Compose bouwt de meegeleverde Dockerfile.
4. Stackvariabelen: `ADMIN_EMAIL` en `ADMIN_PASSWORD`.
5. Deploy de stack. De app is daarna bereikbaar op poort `3088` van de Docker-host.

Maak `ADMIN_PASSWORD` uniek en minstens 12 tekens lang. Dit wachtwoord is nodig om de stack te starten. Verander het opgeslagen eigenaarwachtwoord niet alleen door de omgevingsvariabele aan te passen; gebruikers staan in de persistente datamap.

De Compose-stack bewaart data in de named volume `8star_chat_data`. Zet de app achter je HTTPS-reverse-proxy voor gebruik op een publiek domein en configureer daar lange SSE-verbindingen zonder buffering. Stel `FRAME_ANCESTORS` in op de toegestane livestreamdomeinen, bijvoorbeeld `https://live.klant.nl https://www.klant.nl`. `*` staat embedden vanaf ieder domein toe en is alleen geschikt als tijdelijke testinstelling.

## Routes

- `/` — beheer en eventlijst
- `/e/<event-slug>` — publieke chatiframe
- `/moderator/<event-slug>` — moderatorconsole
- `/stage/<event-slug>` — sprekersscherm (inloggen met een toegewezen stageaccount, of open de tijdelijke link die de moderator heeft gemaakt)
- `/health` — healthcheck

Iframe-voorbeeld:

```html
<iframe
  src="https://chat.example.nl/e/jaarcongres-2026"
  style="width:100%;height:650px;border:0"
  title="Live chat">
</iframe>
```

## Eerste gebruik

1. Log in met het eigenaaraccount uit de stackvariabelen.
2. Maak een event aan en kopieer de publieke iframe-code.
3. Open de moderatorconsole en maak extra moderator- en stageaccounts aan.
4. Open `Stage / cues` en maak desgewenst een tijdelijke stage-link.
5. Deel de publieke iframe-link met kijkers; de livestream blijft op de aparte kijkpagina.

## Status en capaciteit

Dit is een eerste functionele versie, geen gevalideerde commerciële productieomgeving. De opslag is één JSON-bestand op één container en de actieve verbindingen worden door één Node-proces afgehandeld. Er is nog geen cluster, gedeelde sessieopslag, automatische back-up, wachtwoordreset, accountuitnodiging per e-mail, uitgebreide audittrail of onafhankelijke loadtest. De ingestelde limiet voorkomt meer dan het ingestelde aantal gelijktijdige kijkerverbindingen per event, maar bewijst niet dat de server die belasting al betrouwbaar kan verwerken. Voer een loadtest uit op de uiteindelijke server, reverse-proxy en netwerkverbinding voordat je een 10.000-gebruikerscapaciteit belooft.

De app bewaart berichten en accountgegevens in de volume `8star_chat_data`. Maak daarvan aparte versleutelde back-ups en stel een retentiebeleid in voordat je echte persoonsgegevens verwerkt.

## Aansluiting op STREAMING MANAGER 2

De chat- en sprekerseisen uit sectie 7.7 zijn meegenomen. CHT-01 t/m CHT-11 zijn in deze versie afgedekt: eventinstelling, openbare en privéberichten, goedkeuringswachtrij, antwoorden, meerdere moderators, taalkeuze en filter, publiceren in de eigen taal of alle talen, en doorsturen naar het sprekersscherm. SPK-01 t/m SPK-05 zijn afgedekt met een aparte stagepagina, persoonlijke of tijdelijke toegang, alleen geselecteerde inhoud, taalweergave/filter en een scherm zonder toegang tot beheer. SPK-06 wordt gevolgd doordat de stagepagina alleen vragen en regieberichten toont.

De woordenfilter uit CHT-12, pincode- of QR-uitgifte voor het sprekersscherm, configureerbare moderatierollen, gedetailleerde auditlogging en retentie-instellingen zijn nog niet in deze eerste versie opgenomen.
