(() => {
  const rows = [
    ['Interface language', 'Taal van de interface', 'Sprache der Oberfläche', 'Langue de l’interface'],
    ['Sign in', 'Inloggen', 'Anmelden', 'Se connecter'],
    ['Sign in to manage events.', 'Log in om evenementen te beheren.', 'Melde dich an, um Veranstaltungen zu verwalten.', 'Connectez-vous pour gérer les événements.'],
    ['Email address', 'E-mailadres', 'E-Mail-Adresse', 'Adresse e-mail'],
    ['Password', 'Wachtwoord', 'Passwort', 'Mot de passe'],
    ['Sign out', 'Uitloggen', 'Abmelden', 'Se déconnecter'],
    ['Light mode', 'Lichte modus', 'Heller Modus', 'Mode clair'],
    ['Dark mode', 'Donkere modus', 'Dunkler Modus', 'Mode sombre'],
    ['Dashboard', 'Dashboard', 'Übersicht', 'Tableau de bord'],
    ['Your events', 'Jouw evenementen', 'Deine Veranstaltungen', 'Vos événements'],
    ['New event', 'Nieuw evenement', 'Neue Veranstaltung', 'Nouvel événement'],
    ['Event name', 'Naam van het evenement', 'Name der Veranstaltung', 'Nom de l’événement'],
    ['Maximum participants', 'Maximum aantal deelnemers', 'Maximale Teilnehmerzahl', 'Nombre maximal de participants'],
    ['Participant limit', 'Deelnemerslimiet', 'Teilnehmerlimit', 'Limite de participants'],
    ['Chat mode', 'Chatmodus', 'Chatmodus', 'Mode de chat'],
    ['Moderated', 'Gereguleerd', 'Moderiert', 'Modéré'],
    ['Read-only', 'Alleen lezen', 'Nur lesen', 'Lecture seule'],
    ['Open', 'Open', 'Offen', 'Ouvert'],
    ['Moderated: approve before public.', 'Gereguleerd: keur berichten goed voordat ze openbaar worden.', 'Moderiert: erst nach Freigabe öffentlich.', 'Modéré : valider avant publication.'],
    ['Read-only: attendees can only view.', 'Alleen lezen: bezoekers kunnen alleen meekijken.', 'Nur lesen: Teilnehmende können nur mitlesen.', 'Lecture seule : les participants peuvent uniquement consulter.'],
    ['Open: public messages go live immediately.', 'Open: openbare berichten verschijnen direct.', 'Offen: öffentliche Nachrichten erscheinen sofort.', 'Ouvert : les messages publics sont publiés immédiatement.'],
    ['Moderated: approve messages first. Read-only: attendees only view. Open: public messages appear immediately.', 'Gereguleerd: keur berichten eerst goed. Alleen lezen: bezoekers kijken alleen mee. Open: openbare berichten verschijnen direct.', 'Moderiert: Nachrichten zuerst freigeben. Nur lesen: Teilnehmende können nur mitlesen. Offen: öffentliche Nachrichten erscheinen sofort.', 'Modéré : validez d’abord les messages. Lecture seule : les participants consultent uniquement. Ouvert : les messages publics apparaissent immédiatement.'],
    ['Create event', 'Evenement maken', 'Veranstaltung erstellen', 'Créer un événement'],
    ['Included', 'Inbegrepen', 'Enthalten', 'Inclus'],
    ['Moderation queue and archive, private conversations, speaker question queue, topic assignments, and a secure speaker link.', 'Moderatie en archief, privégesprekken, vragenwachtrij voor sprekers, onderwerpstoewijzing en een beveiligde sprekerslink.', 'Moderationsliste und Archiv, private Gespräche, Fragenliste für die Bühne, Themenzuweisungen und ein sicherer Bühnenlink.', 'File de modération et archive, conversations privées, file de questions pour les intervenants, attribution par sujet et lien sécurisé.'],
    ['White-label for each event', 'Aanpasbaar per evenement', 'Individuell anpassbar', 'Personnalisable pour chaque événement'],
    ['Events', 'Evenementen', 'Veranstaltungen', 'Événements'],
    ['Go to public chat', 'Naar de openbare chat', 'Zum öffentlichen Chat', 'Ouvrir le chat public'],
    ['Moderate', 'Modereren', 'Moderieren', 'Modérer'],
    ['Stage login', 'Inloggen als spreker', 'Bühnen-Anmeldung', 'Connexion scène'],
    ['Copy embed code', 'Embedcode kopiëren', 'Einbettungscode kopieren', 'Copier le code d’intégration'],
    ['No events yet.', 'Nog geen evenementen.', 'Noch keine Veranstaltungen.', 'Aucun événement pour le moment.'],
    ['Chat is disabled.', 'De chat is uitgeschakeld.', 'Der Chat ist deaktiviert.', 'Le chat est désactivé.'],
    ['Enter your name to join.', 'Vul je naam in om mee te doen.', 'Gib deinen Namen ein, um teilzunehmen.', 'Saisissez votre nom pour rejoindre le chat.'],
    ['Name', 'Naam', 'Name', 'Nom'],
    ['Your name', 'Je naam', 'Dein Name', 'Votre nom'],
    ['Your language (optional)', 'Je taal (optioneel)', 'Deine Sprache (optional)', 'Votre langue (facultatif)'],
    ['Language (optional)', 'Taal (optioneel)', 'Sprache (optional)', 'Langue (facultatif)'],
    ['Any language', 'Elke taal', 'Beliebige Sprache', 'Toutes les langues'],
    ['You can leave this blank. Messages in any language are accepted.', 'Je kunt dit leeg laten. Berichten in elke taal zijn toegestaan.', 'Du kannst dieses Feld leer lassen. Nachrichten in jeder Sprache sind möglich.', 'Vous pouvez laisser ce champ vide. Les messages dans toutes les langues sont acceptés.'],
    ['Join chat', 'Deelnemen aan de chat', 'Chat beitreten', 'Rejoindre le chat'],
    ['Read-only · You can view the live chat', 'Alleen lezen · Je kunt de livechat bekijken', 'Nur lesen · Du kannst den Live-Chat verfolgen', 'Lecture seule · Vous pouvez consulter le chat en direct'],
    ['Live chat', 'Livechat', 'Live-Chat', 'Chat en direct'],
    ['Private conversation with moderators', 'Privégesprek met moderators', 'Privater Chat mit Moderatoren', 'Conversation privée avec les modérateurs'],
    ['Open private conversation', 'Open privégesprek', 'Privaten Chat öffnen', 'Ouvrir la conversation privée'],
    ['Only you and the moderation team can read these messages.', 'Alleen jij en het moderatieteam kunnen deze berichten lezen.', 'Nur du und das Moderationsteam können diese Nachrichten lesen.', 'Seuls vous et l’équipe de modération pouvez lire ces messages.'],
    ['Your private conversation is empty.', 'Je privégesprek is nog leeg.', 'Dein privater Chat ist noch leer.', 'Votre conversation privée est vide.'],
    ['Private messages are disabled for this event.', 'Privéberichten zijn voor dit evenement uitgeschakeld.', 'Private Nachrichten sind für diese Veranstaltung deaktiviert.', 'Les messages privés sont désactivés pour cet événement.'],
    ['Back to public chat', 'Terug naar de openbare chat', 'Zurück zum öffentlichen Chat', 'Retour au chat public'],
    ['Message type', 'Type bericht', 'Nachrichtentyp', 'Type de message'],
    ['Public question', 'Openbare vraag', 'Öffentliche Frage', 'Question publique'],
    ['Private to moderators', 'Privé aan moderators', 'Privat an Moderatoren', 'Privé aux modérateurs'],
    ['Write a message…', 'Schrijf een bericht…', 'Nachricht schreiben…', 'Écrire un message…'],
    ['Write a private message…', 'Schrijf een privébericht…', 'Private Nachricht schreiben…', 'Écrire un message privé…'],
    ['Send', 'Versturen', 'Senden', 'Envoyer'],
    ['Send privately', 'Privé versturen', 'Privat senden', 'Envoyer en privé'],
    ['This event is read-only.', 'Dit evenement is alleen-lezen.', 'Diese Veranstaltung ist schreibgeschützt.', 'Cet événement est en lecture seule.'],
    ['Your message is now public.', 'Je bericht is nu openbaar.', 'Deine Nachricht ist jetzt öffentlich.', 'Votre message est maintenant public.'],
    ['Your private message has been sent to the moderators.', 'Je privébericht is naar de moderators verstuurd.', 'Deine private Nachricht wurde an die Moderatoren gesendet.', 'Votre message privé a été envoyé aux modérateurs.'],
    ['Your message is awaiting moderator approval.', 'Je bericht wacht op goedkeuring van een moderator.', 'Deine Nachricht wartet auf die Freigabe durch einen Moderator.', 'Votre message attend l’approbation d’un modérateur.'],
    ['Reconnecting…', 'Opnieuw verbinden…', 'Verbindung wird wiederhergestellt…', 'Reconnexion…'],
    ['You no longer have access to this chat.', 'Je hebt geen toegang meer tot deze chat.', 'Du hast keinen Zugriff mehr auf diesen Chat.', 'Vous n’avez plus accès à ce chat.'],
    ['Copied', 'Gekopieerd', 'Kopiert', 'Copié'],
    ['Copy failed', 'Kopiëren mislukt', 'Kopieren fehlgeschlagen', 'Échec de la copie'],
    ['Copy', 'Kopiëren', 'Kopieren', 'Copier'],
    ['Event not found or access denied', 'Evenement niet gevonden of geen toegang', 'Veranstaltung nicht gefunden oder Zugriff verweigert', 'Événement introuvable ou accès refusé'],
    ['Moderator console', 'Moderatorpaneel', 'Moderationsbereich', 'Console de modération'],
    ['Limit', 'Limiet', 'Limit', 'Limite'],
    ['Inbox', 'Postvak IN', 'Posteingang', 'Boîte de réception'],
    ['Private messages', 'Privéberichten', 'Private Nachrichten', 'Messages privés'],
    ['Published / archive', 'Gepubliceerd / archief', 'Veröffentlicht / Archiv', 'Publiées / archive'],
    ['Stage / cues', 'Podium / aanwijzingen', 'Bühne / Hinweise', 'Scène / consignes'],
    ['Team', 'Team', 'Team', 'Équipe'],
    ['Blocked users', 'Geblokkeerde gebruikers', 'Blockierte Nutzer', 'Utilisateurs bloqués'],
    ['Settings', 'Instellingen', 'Einstellungen', 'Paramètres'],
    ['No messages to review.', 'Geen berichten om te beoordelen.', 'Keine Nachrichten zur Prüfung.', 'Aucun message à vérifier.'],
    ['Publish', 'Publiceren', 'Veröffentlichen', 'Publier'],
    ['Send to stage', 'Naar de stage sturen', 'An die Bühne senden', 'Envoyer sur scène'],
    ['Reject', 'Afwijzen', 'Ablehnen', 'Rejeter'],
    ['Private conversation', 'Privégesprek', 'Privater Chat', 'Conversation privée'],
    ['Unassigned', 'Niet toegewezen', 'Nicht zugewiesen', 'Non attribué'],
    ['Topic / area', 'Onderwerp / onderdeel', 'Thema / Bereich', 'Sujet / domaine'],
    ['Assign to moderator', 'Toewijzen aan moderator', 'Moderator zuweisen', 'Attribuer à un modérateur'],
    ['Save assignment', 'Toewijzing opslaan', 'Zuweisung speichern', 'Enregistrer l’attribution'],
    ['e.g. Delta works or infrastructure', 'bijv. Deltawerken of infrastructuur', 'z. B. Deltawerke oder Infrastruktur', 'ex. travaux du Delta ou infrastructure'],
    ['Participant blocked', 'Deelnemer geblokkeerd', 'Teilnehmer blockiert', 'Participant bloqué'],
    ['Block participant', 'Deelnemer blokkeren', 'Teilnehmer blockieren', 'Bloquer le participant'],
    ['Block IP address', 'IP-adres blokkeren', 'IP-Adresse blockieren', 'Bloquer l’adresse IP'],
    ['Pin color', 'Kleur van vastgezet bericht', 'Farbe der angehefteten Nachricht', 'Couleur du message épinglé'],
    ['Save color', 'Kleur opslaan', 'Farbe speichern', 'Enregistrer la couleur'],
    ['Pin at top of chat', 'Bovenaan de chat vastzetten', 'Oben im Chat anheften', 'Épingler en haut du chat'],
    ['Unpin', 'Losmaken', 'Lösen', 'Désépingler'],
    ['Pinned announcements', 'Vastgezette aankondigingen', 'Angeheftete Ankündigungen', 'Annonces épinglées'],
    ['Write an announcement to pin at the top of the public chat.', 'Schrijf een aankondiging die bovenaan de openbare chat wordt vastgezet.', 'Schreibe eine Ankündigung, die oben im öffentlichen Chat angeheftet wird.', 'Rédigez une annonce à épingler en haut du chat public.'],
    ['Announcement text…', 'Tekst van de aankondiging…', 'Ankündigungstext…', 'Texte de l’annonce…'],
    ['Post and pin announcement', 'Aankondiging plaatsen en vastzetten', 'Ankündigung veröffentlichen und anheften', 'Publier et épingler l’annonce'],
    ['No pinned announcements.', 'Geen vastgezette aankondigingen.', 'Keine angehefteten Ankündigungen.', 'Aucune annonce épinglée.'],
    ['Announcement', 'Aankondiging', 'Ankündigung', 'Annonce'],
    ['Pinned message', 'Vastgezet bericht', 'Angeheftete Nachricht', 'Message épinglé'],
    ['Up to five messages can be pinned at a time.', 'Je kunt maximaal vijf berichten tegelijk vastzetten.', 'Es können bis zu fünf Nachrichten gleichzeitig angeheftet werden.', 'Vous pouvez épingler jusqu’à cinq messages à la fois.'],
    ['Speaker queue', 'Sprekerswachtrij', 'Warteschlange für die Bühne', 'File des intervenants'],
    ['The speaker can scroll this list on an iPad, select a question, and mark it read. Sent questions stay in the archive.', 'De spreker kan deze lijst op een iPad doorlopen, een vraag kiezen en als gelezen markeren. Verstuurde vragen blijven in het archief.', 'Der Sprecher kann diese Liste auf dem iPad durchsehen, eine Frage auswählen und als gelesen markieren. Gesendete Fragen bleiben im Archiv.', 'L’intervenant peut faire défiler cette liste sur un iPad, choisir une question et la marquer comme lue. Les questions envoyées restent dans l’archive.'],
    ['Nothing waiting for the speaker.', 'Er staat niets klaar voor de spreker.', 'Keine Einträge für den Sprecher vorhanden.', 'Aucun message en attente pour l’intervenant.'],
    ['Remove from speaker queue', 'Uit de sprekerswachtrij halen', 'Aus der Sprecher-Warteschlange entfernen', 'Retirer de la file des intervenants'],
    ['Send a note to the speaker', 'Stuur een bericht naar de spreker', 'Eine Nachricht an den Sprecher senden', 'Envoyer une note à l’intervenant'],
    ['Message for the speaker…', 'Bericht voor de spreker…', 'Nachricht für den Sprecher…', 'Message pour l’intervenant…'],
    ['Add stage cue', 'Aanwijzing toevoegen', 'Bühnenhinweis hinzufügen', 'Ajouter une consigne scène'],
    ['Open stage login', 'Stage-login openen', 'Bühnen-Anmeldung öffnen', 'Ouvrir la connexion scène'],
    ['Create secure stage link + QR', 'Beveiligde stage-link + QR maken', 'Sicheren Bühnenlink + QR-Code erstellen', 'Créer un lien sécurisé + QR pour la scène'],
    ['Private messages from stage', 'Privéberichten vanaf de stage', 'Private Nachrichten von der Bühne', 'Messages privés depuis la scène'],
    ['No messages yet.', 'Nog geen berichten.', 'Noch keine Nachrichten.', 'Aucun message pour le moment.'],
    ['Stage cue', 'Stage-aanwijzing', 'Bühnenhinweis', 'Consigne scène'],
    ['Question', 'Vraag', 'Frage', 'Question'],
    ['Cue', 'Aanwijzing', 'Hinweis', 'Consigne'],
    ['Selected question', 'Geselecteerde vraag', 'Ausgewählte Frage', 'Question sélectionnée'],
    ['Choose a question, show it, then mark it as read.', 'Kies een vraag, toon deze en markeer hem daarna als gelezen.', 'Wähle eine Frage aus, zeige sie an und markiere sie anschließend als gelesen.', 'Choisissez une question, affichez-la puis marquez-la comme lue.'],
    ['Select a question from the queue.', 'Selecteer een vraag uit de wachtrij.', 'Wähle eine Frage aus der Warteschlange aus.', 'Sélectionnez une question dans la file.'],
    ['0 waiting', '0 wachtend', '0 wartend', '0 en attente'],
    ['waiting', 'wachtend', 'wartend', 'en attente'],
    ['Questions to read', 'Te lezen vragen', 'Zu lesende Fragen', 'Questions à lire'],
    ['Tap a question to display it. Mark it read when you are done.', 'Tik op een vraag om deze te tonen. Markeer hem als gelezen wanneer je klaar bent.', 'Tippe auf eine Frage, um sie anzuzeigen. Markiere sie als gelesen, wenn du fertig bist.', 'Touchez une question pour l’afficher. Marquez-la comme lue lorsque vous avez terminé.'],
    ['I’ve read this', 'Ik heb dit gelezen', 'Ich habe das gelesen', 'J’ai lu ceci'],
    ['Mark read', 'Markeer als gelezen', 'Als gelesen markieren', 'Marquer comme lu'],
    ['All caught up. New selected questions appear here automatically.', 'Je bent bij. Nieuwe geselecteerde vragen verschijnen hier automatisch.', 'Alles erledigt. Neue ausgewählte Fragen erscheinen hier automatisch.', 'Tout est à jour. Les nouvelles questions apparaîtront ici automatiquement.'],
    ['Private message to moderators…', 'Privébericht aan moderators…', 'Private Nachricht an die Moderatoren…', 'Message privé aux modérateurs…'],
    ['Private messages', 'Privéberichten', 'Private Nachrichten', 'Messages privés'],
    ['Anyone with this link can open the speaker page. It expires in 12 hours.', 'Iedereen met deze link kan het sprekersscherm openen. De link verloopt na 12 uur.', 'Jeder mit diesem Link kann die Bühnenseite öffnen. Der Link läuft nach 12 Stunden ab.', 'Toute personne disposant de ce lien peut ouvrir la page scène. Il expire dans 12 heures.'],
    ['Open speaker page', 'Sprekersscherm openen', 'Bühnenseite öffnen', 'Ouvrir la page scène'],
    ['Copy secure link', 'Beveiligde link kopiëren', 'Sicheren Link kopieren', 'Copier le lien sécurisé'],
    ['Scan this QR code with the speaker’s iPad or phone.', 'Scan deze QR-code met de iPad of telefoon van de spreker.', 'Scanne diesen QR-Code mit dem iPad oder Smartphone des Sprechers.', 'Scannez ce QR code avec l’iPad ou le téléphone de l’intervenant.'],
    ['Creating secure link…', 'Beveiligde link maken…', 'Sicherer Link wird erstellt…', 'Création du lien sécurisé…'],
    ['Team accounts', 'Teamaccounts', 'Teamkonten', 'Comptes de l’équipe'],
    ['Role', 'Rol', 'Rolle', 'Rôle'],
    ['Moderator', 'Moderator', 'Moderator', 'Modérateur'],
    ['Stage monitor', 'Stage-monitor', 'Bühnenmonitor', 'Régie scène'],
    ['Event owner (this chat only)', 'Eigenaar (alleen deze chat)', 'Veranstaltungsinhaber (nur dieser Chat)', 'Propriétaire (ce chat uniquement)'],
    ['Topics / areas for this moderator', 'Onderwerpen / onderdelen voor deze moderator', 'Themen / Bereiche dieses Moderators', 'Sujets / domaines de ce modérateur'],
    ['Delta works, Infrastructure', 'Deltawerken, Infrastructuur', 'Deltawerke, Infrastruktur', 'Travaux du Delta, Infrastructure'],
    ['Comma-separated. The event owner can assign questions to the moderator responsible for each area.', 'Scheid met komma’s. De eigenaar kan vragen toewijzen aan de moderator voor elk onderdeel.', 'Durch Kommas trennen. Der Veranstaltungsinhaber kann Fragen dem zuständigen Moderator zuweisen.', 'Séparez par des virgules. Le propriétaire peut attribuer les questions au modérateur responsable de chaque domaine.'],
    ['Add account', 'Account toevoegen', 'Konto hinzufügen', 'Ajouter un compte'],
    ['The event owner manages accounts and topic responsibilities.', 'De eigenaar beheert accounts en onderwerpstoewijzingen.', 'Der Veranstaltungsinhaber verwaltet Konten und Themenzuständigkeiten.', 'Le propriétaire gère les comptes et les responsabilités par sujet.'],
    ['Remove this account from this chat?', 'Dit account uit deze chat verwijderen?', 'Dieses Konto aus dem Chat entfernen?', 'Supprimer ce compte de ce chat ?'],
    ['Edit account', 'Account bewerken', 'Konto bearbeiten', 'Modifier le compte'],
    ['Blocked attendees cannot reconnect or send messages in this event. Unblocking here restores access.', 'Geblokkeerde bezoekers kunnen niet opnieuw deelnemen of berichten sturen. Hier deblokkeren herstelt de toegang.', 'Blockierte Teilnehmer können dieser Veranstaltung nicht erneut beitreten oder Nachrichten senden. Hier kannst du die Sperre aufheben.', 'Les participants bloqués ne peuvent pas se reconnecter ni envoyer de messages. Le déblocage ici rétablit l’accès.'],
    ['Unblock user', 'Gebruiker deblokkeren', 'Nutzer entsperren', 'Débloquer l’utilisateur'],
    ['No blocked users.', 'Geen geblokkeerde gebruikers.', 'Keine blockierten Nutzer.', 'Aucun utilisateur bloqué.'],
    ['Chat and moderation settings', 'Chat- en moderatie-instellingen', 'Chat- und Moderationseinstellungen', 'Paramètres du chat et de modération'],
    ['Logo URL (HTTPS, optional)', 'Logo-URL (HTTPS, optioneel)', 'Logo-URL (HTTPS, optional)', 'URL du logo (HTTPS, facultatif)'],
    ['Blocked words/phrases', 'Geblokkeerde woorden/zinnen', 'Gesperrte Wörter/Phrasen', 'Mots/expressions bloqués'],
    ['Enter comma-separated words or phrases', 'Vul woorden of zinnen in, gescheiden door komma’s', 'Gesperrte Wörter oder Phrasen durch Kommas trennen', 'Saisissez des mots ou expressions séparés par des virgules'],
    ['Messages containing one of these terms are stopped before publication or moderation. Separate entries with commas or new lines.', 'Berichten met een van deze termen worden tegengehouden voordat ze worden gepubliceerd of gemodereerd. Scheid termen met komma’s of nieuwe regels.', 'Nachrichten mit diesen Begriffen werden vor Veröffentlichung oder Moderation gestoppt. Trenne Einträge mit Kommas oder Zeilenumbrüchen.', 'Les messages contenant ces termes sont bloqués avant publication ou modération. Séparez les entrées par des virgules ou des retours à la ligne.'],
    ['Chat enabled', 'Chat ingeschakeld', 'Chat aktiviert', 'Chat activé'],
    ['Allow private messages to moderators', 'Privéberichten aan moderators toestaan', 'Private Nachrichten an Moderatoren erlauben', 'Autoriser les messages privés aux modérateurs'],
    ['When disabled, attendees can still read their existing private conversation history.', 'Als dit uitstaat, kunnen bezoekers hun bestaande privégesprekken nog lezen.', 'Wenn deaktiviert, können Teilnehmende ihren bisherigen privaten Chatverlauf weiterhin lesen.', 'Si cette option est désactivée, les participants peuvent toujours consulter leur historique privé.'],
    ['Save settings', 'Instellingen opslaan', 'Einstellungen speichern', 'Enregistrer les paramètres'],
    ['Export full chat CSV', 'Volledige chat exporteren als CSV', 'Gesamten Chat als CSV exportieren', 'Exporter tout le chat en CSV'],
    ['Public link:', 'Openbare link:', 'Öffentlicher Link:', 'Lien public :'],
    ['Settings saved', 'Instellingen opgeslagen', 'Einstellungen gespeichert', 'Paramètres enregistrés'],
    ['Copy embed code', 'Embedcode kopiëren', 'Einbettungscode kopieren', 'Copier le code d’intégration'],
    ['Public chat', 'Openbare chat', 'Öffentlicher Chat', 'Chat public'],
    ['Published questions and archive', 'Gepubliceerde vragen en archief', 'Veröffentlichte Fragen und Archiv', 'Questions publiées et archive'],
    ['Withdraw, republish, send questions to speakers, pin key messages, and manage participant access.', 'Haal vragen offline, publiceer opnieuw, stuur ze naar sprekers, zet berichten vast en beheer deelnemers.', 'Ziehe Fragen zurück, veröffentliche sie erneut, sende sie an Sprecher, hefte wichtige Nachrichten an und verwalte den Teilnehmerzugriff.', 'Retirez ou republiez des questions, envoyez-les aux intervenants, épinglez des messages et gérez l’accès des participants.'],
    ['Published', 'Gepubliceerd', 'Veröffentlicht', 'Publiée'],
    ['Withdrawn', 'Ingetrokken', 'Zurückgezogen', 'Retirée'],
    ['Withdraw from public chat', 'Uit openbare chat halen', 'Aus öffentlichem Chat zurückziehen', 'Retirer du chat public'],
    ['Republish', 'Opnieuw publiceren', 'Erneut veröffentlichen', 'Republier'],
    ['On speaker queue', 'Op sprekerswachtrij', 'In Sprecher-Warteschlange', 'Dans la file des intervenants'],
    ['Stage:', 'Stage:', 'Bühne:', 'Scène :'],
    ['No published messages yet.', 'Nog geen gepubliceerde berichten.', 'Noch keine veröffentlichten Nachrichten.', 'Aucun message publié pour le moment.'],
    ['Stage questions', 'Stagevragen', 'Bühnenfragen', 'Questions scène'],
    ['Send this question to the speaker?', 'Deze vraag naar de spreker sturen?', 'Diese Frage an den Sprecher senden?', 'Envoyer cette question à l’intervenant ?'],
    ['Send to stage', 'Naar de stage sturen', 'An die Bühne senden', 'Envoyer sur scène'],
    ['Open mode makes every public attendee message visible immediately. Continue?', 'In de open modus wordt elk openbaar bezoekersbericht direct zichtbaar. Doorgaan?', 'Im offenen Modus werden alle öffentlichen Nachrichten sofort angezeigt. Fortfahren?', 'En mode ouvert, chaque message public est immédiatement visible. Continuer ?'],
    ['Invalid email address or password.', 'Ongeldig e-mailadres of wachtwoord.', 'Ungültige E-Mail-Adresse oder ungültiges Passwort.', 'Adresse e-mail ou mot de passe invalide.'],
    ['Enter a valid email address and a password of at least 12 characters.', 'Vul een geldig e-mailadres en een wachtwoord van minimaal 12 tekens in.', 'Gib eine gültige E-Mail-Adresse und ein Passwort mit mindestens 12 Zeichen ein.', 'Saisissez une adresse e-mail valide et un mot de passe d’au moins 12 caractères.'],
    ['Passwords must be at least 12 characters.', 'Wachtwoorden moeten minimaal 12 tekens bevatten.', 'Passwörter müssen mindestens 12 Zeichen lang sein.', 'Les mots de passe doivent comporter au moins 12 caractères.'],
    ['That email address is already in use.', 'Dit e-mailadres is al in gebruik.', 'Diese E-Mail-Adresse wird bereits verwendet.', 'Cette adresse e-mail est déjà utilisée.'],
    ['Please enter a message first.', 'Schrijf eerst een bericht.', 'Bitte schreibe zuerst eine Nachricht.', 'Veuillez d’abord saisir un message.'],
    ['Your message contains a blocked word or phrase.', 'Je bericht bevat een geblokkeerd woord of een geblokkeerde zin.', 'Deine Nachricht enthält ein gesperrtes Wort oder eine Phrase.', 'Votre message contient un mot ou une expression bloquée.'],
    ['Please wait before sending another message.', 'Wacht even voordat je nog een bericht verstuurt.', 'Bitte warte, bevor du eine weitere Nachricht sendest.', 'Veuillez patienter avant d’envoyer un autre message.'],
    ['This chat has reached its maximum capacity.', 'Deze chat heeft het maximale aantal deelnemers bereikt.', 'Dieser Chat hat seine maximale Teilnehmerzahl erreicht.', 'Ce chat a atteint sa capacité maximale.'],
    ['This chat is busy. Please try again shortly.', 'Deze chat is druk. Probeer het zo nog eens.', 'Dieser Chat ist ausgelastet. Bitte versuche es gleich erneut.', 'Ce chat est très fréquenté. Veuillez réessayer dans un instant.'],
    ['You do not have access to this chat.', 'Je hebt geen toegang tot deze chat.', 'Du hast keinen Zugriff auf diesen Chat.', 'Vous n’avez pas accès à ce chat.'],
    ['Access denied', 'Toegang geweigerd', 'Zugriff verweigert', 'Accès refusé'],
    ['Stage access required.', 'Toegang tot de stage is vereist.', 'Bühnenzugriff erforderlich.', 'Accès à la scène requis.'],
    ['Message not found.', 'Bericht niet gevonden.', 'Nachricht nicht gefunden.', 'Message introuvable.'],
    ['This item is no longer in the speaker queue.', 'Dit item staat niet meer in de sprekerswachtrij.', 'Dieser Eintrag ist nicht mehr in der Sprecher-Warteschlange.', 'Cet élément n’est plus dans la file des intervenants.'],
    ['Only published public questions can be pinned.', 'Alleen gepubliceerde openbare vragen kunnen worden vastgezet.', 'Nur veröffentlichte öffentliche Fragen können angeheftet werden.', 'Seules les questions publiques publiées peuvent être épinglées.'],
    ['Only the event owner can assign questions.', 'Alleen de eigenaar kan vragen toewijzen.', 'Nur der Veranstaltungsinhaber kann Fragen zuweisen.', 'Seul le propriétaire peut attribuer des questions.'],
    ['Only the event owner can manage the team.', 'Alleen de eigenaar kan het team beheren.', 'Nur der Veranstaltungsinhaber kann das Team verwalten.', 'Seul le propriétaire peut gérer l’équipe.'],
    ['Stage cue removed from the speaker queue.', 'Stage-aanwijzing uit de sprekerswachtrij gehaald.', 'Bühnenhinweis aus der Warteschlange entfernt.', 'Consigne retirée de la file des intervenants.'],
    ['IP address blocked for this event.', 'IP-adres voor dit evenement geblokkeerd.', 'IP-Adresse für diese Veranstaltung gesperrt.', 'Adresse IP bloquée pour cet événement.'],
    ['Could not determine the visitor IP address. Enable trusted proxy support if the app is behind a reverse proxy.', 'Het IP-adres van de bezoeker kon niet worden bepaald. Schakel vertrouwde proxy-ondersteuning in als de app achter een reverse proxy staat.', 'Die IP-Adresse konnte nicht ermittelt werden. Aktiviere die Proxy-Vertrauensstellung, wenn die App hinter einem Reverse-Proxy läuft.', 'Impossible de déterminer l’adresse IP. Activez la confiance du proxy si l’application est derrière un reverse proxy.'],
    ['IP blocking uses the address seen by the chat server. Behind a reverse proxy, enable TRUST_PROXY and make sure the proxy overwrites X-Forwarded-For.', 'IP-blokkering gebruikt het adres dat de chatserver ziet. Schakel achter een reverse proxy TRUST_PROXY in en zorg dat de proxy X-Forwarded-For overschrijft.', 'Die IP-Sperre verwendet die vom Chatserver erkannte Adresse. Aktiviere hinter einem Reverse-Proxy TRUST_PROXY und stelle sicher, dass der Proxy X-Forwarded-For überschreibt.', 'Le blocage IP utilise l’adresse vue par le serveur. Derrière un reverse proxy, activez TRUST_PROXY et assurez-vous que le proxy remplace X-Forwarded-For.'],
    ['Topics / areas', 'Onderwerpen / onderdelen', 'Themen / Bereiche', 'Sujets / domaines'],
    ['Save account', 'Account opslaan', 'Konto speichern', 'Enregistrer le compte'],
    ['Topics / areas for this chat', 'Onderwerpen / onderdelen voor deze chat', 'Themen / Bereiche für diesen Chat', 'Sujets / domaines pour ce chat'],
    ['Moderation queue', 'Moderatie-wachtrij', 'Moderations-Warteschlange', 'File de modération'],
    ['Closed', 'Gesloten', 'Geschlossen', 'Fermée'],
    ['No team accounts yet.', 'Nog geen teamaccounts.', 'Noch keine Teamkonten.', 'Aucun compte d’équipe pour le moment.'],
    ['QR code for secure speaker page', 'QR-code voor het beveiligde sprekersscherm', 'QR-Code für die sichere Bühnenseite', 'QR code pour la page scène sécurisée'],
    ['Write a private reply…', 'Schrijf een privéantwoord…', 'Private Antwort schreiben…', 'Écrire une réponse privée…'],
    ['Set TRUST_PROXY=true to enable IP blocking. Use it only behind a reverse proxy that sets X-Forwarded-For.', 'Stel TRUST_PROXY=true in om IP-blokkering in te schakelen. Gebruik dit alleen achter een reverse proxy die X-Forwarded-For instelt.', 'Setze TRUST_PROXY=true, um IP-Sperren zu aktivieren. Verwende dies nur hinter einem Reverse-Proxy, der X-Forwarded-For setzt.', 'Définissez TRUST_PROXY=true pour activer le blocage IP. Utilisez cette option uniquement derrière un reverse proxy qui définit X-Forwarded-For.'],
    ['Log in', 'Log in', 'Anmelden', 'Se connecter'],
    ['Session expired.', 'Sessie verlopen.', 'Sitzung abgelaufen.', 'Session expirée.'],
    ['Not found', 'Niet gevonden', 'Nicht gefunden', 'Introuvable'],
    ['Message not found', 'Bericht niet gevonden', 'Nachricht nicht gefunden', 'Message introuvable'],
    ['This private conversation cannot be answered.', 'Op dit privégesprek kan niet worden geantwoord.', 'Auf diesen privaten Chat kann nicht geantwortet werden.', 'Impossible de répondre à cette conversation privée.'],
    ['Participant not found', 'Deelnemer niet gevonden', 'Teilnehmer nicht gefunden', 'Participant introuvable'],
    ['Message is empty', 'Het bericht is leeg', 'Die Nachricht ist leer', 'Le message est vide'],
    ['This stage link has expired. Create a new one.', 'Deze stage-link is verlopen. Maak een nieuwe link.', 'Dieser Bühnenlink ist abgelaufen. Erstelle einen neuen.', 'Ce lien scène a expiré. Créez-en un nouveau.'],
    ['Could not determine the public host for the QR code.', 'De publieke host voor de QR-code kon niet worden bepaald.', 'Der öffentliche Host für den QR-Code konnte nicht ermittelt werden.', 'Impossible de déterminer l’hôte public pour le QR code.'],
    ['The platform admin cannot be added as a team account.', 'De platformbeheerder kan niet als teamaccount worden toegevoegd.', 'Der Plattformadministrator kann nicht als Teamkonto hinzugefügt werden.', 'L’administrateur de la plateforme ne peut pas être ajouté comme compte d’équipe.'],
    ['This account cannot be edited here.', 'Dit account kan hier niet worden bewerkt.', 'Dieses Konto kann hier nicht bearbeitet werden.', 'Ce compte ne peut pas être modifié ici.'],
    ['Enter a valid email address.', 'Vul een geldig e-mailadres in.', 'Gib eine gültige E-Mail-Adresse ein.', 'Saisissez une adresse e-mail valide.'],
    ['Choose a valid team role.', 'Kies een geldige teamrol.', 'Wähle eine gültige Teamrolle aus.', 'Choisissez un rôle d’équipe valide.'],
    ['This account cannot be removed from the team.', 'Dit account kan niet uit het team worden verwijderd.', 'Dieses Konto kann nicht aus dem Team entfernt werden.', 'Ce compte ne peut pas être retiré de l’équipe.'],
    ['Event not found', 'Evenement niet gevonden', 'Veranstaltung nicht gefunden', 'Événement introuvable'],
    ['IP blocking is enabled through the proxy.', 'IP-blokkering is ingeschakeld via de proxy.', 'IP-Sperren sind über den Proxy aktiviert.', 'Le blocage IP est activé via le proxy.'],
    ['IP blocking is unavailable until TRUST_PROXY is enabled for the reverse proxy.', 'IP-blokkering is niet beschikbaar totdat TRUST_PROXY voor de reverse proxy is ingeschakeld.', 'IP-Sperren sind erst verfügbar, wenn TRUST_PROXY für den Reverse-Proxy aktiviert ist.', 'Le blocage IP sera disponible lorsque TRUST_PROXY sera activé pour le reverse proxy.'],
    ['Page ', 'Pagina ', 'Seite ', 'Page '],
    [' of ', ' van ', ' von ', ' sur '],
    [' conversations', ' gesprekken', ' Gespräche', ' conversations'],
    [' messages · ', ' berichten · ', ' Nachrichten · ', ' messages · '],
    [' connected', ' verbonden', ' verbunden', ' connectés'],
    [' participants · ', ' deelnemers · ', ' Teilnehmende · ', ' participants · '],
    ['Last message by ', 'Laatste bericht van ', 'Letzte Nachricht von ', 'Dernier message de '],
    ['New attendee messages reopen a closed conversation. The newest activity appears first.', 'Nieuwe berichten van bezoekers heropenen een gesloten gesprek. De nieuwste activiteit staat bovenaan.', 'Neue Nachrichten von Teilnehmenden öffnen einen geschlossenen Chat erneut. Die neueste Aktivität steht zuerst.', 'Les nouveaux messages des participants rouvrent une conversation fermée. L’activité la plus récente apparaît en premier.'],
    ['Only the platform admin can create events.', 'Alleen de platformbeheerder kan evenementen maken.', 'Nur der Plattformadministrator kann Veranstaltungen erstellen.', 'Seul l’administrateur de la plateforme peut créer des événements.'],
    ['Chat is read-only.', 'De chat is alleen-lezen.', 'Der Chat ist schreibgeschützt.', 'Le chat est en lecture seule.'],
    ['Only the event owner can set moderator topics.', 'Alleen de eigenaar kan onderwerpen voor moderators instellen.', 'Nur der Veranstaltungsinhaber kann Moderator-Themen festlegen.', 'Seul le propriétaire peut définir les sujets des modérateurs.'],
    ['Moderator not found.', 'Moderator niet gevonden.', 'Moderator nicht gefunden.', 'Modérateur introuvable.'],
    ['Choose an active moderator for this event.', 'Kies een actieve moderator voor dit evenement.', 'Wähle einen aktiven Moderator für diese Veranstaltung aus.', 'Choisissez un modérateur actif pour cet événement.'],
    ['Private conversation not found.', 'Privégesprek niet gevonden.', 'Privater Chat nicht gefunden.', 'Conversation privée introuvable.'],
    ['Publishing is temporarily rate-limited. Please try again shortly.', 'Publiceren is tijdelijk beperkt. Probeer het zo nog eens.', 'Das Veröffentlichen ist vorübergehend begrenzt. Bitte versuche es gleich erneut.', 'La publication est temporairement limitée. Veuillez réessayer dans un instant.'],
    ['Only a published question can be withdrawn.', 'Alleen een gepubliceerde vraag kan worden ingetrokken.', 'Nur eine veröffentlichte Frage kann zurückgezogen werden.', 'Seule une question publiée peut être retirée.'],
    ['Only the event owner can create stage links.', 'Alleen de eigenaar kan stage-links maken.', 'Nur der Veranstaltungsinhaber kann Bühnenlinks erstellen.', 'Seul le propriétaire peut créer des liens scène.'],
    ['Only the platform admin can create an event owner.', 'Alleen de platformbeheerder kan een evenementeigenaar aanmaken.', 'Nur der Plattformadministrator kann einen Veranstaltungsinhaber erstellen.', 'Seul l’administrateur de la plateforme peut créer un propriétaire d’événement.'],
    ['An event owner account must be unique to this event.', 'Een evenementeigenaaraccount mag alleen bij dit evenement horen.', 'Ein Veranstaltungsinhaber-Konto muss eindeutig dieser Veranstaltung zugeordnet sein.', 'Un compte propriétaire doit être réservé à cet événement.'],
    ['This account already has a different role.', 'Dit account heeft al een andere rol.', 'Dieses Konto hat bereits eine andere Rolle.', 'Ce compte a déjà un autre rôle.'],
    ['This account belongs to another event.', 'Dit account hoort bij een ander evenement.', 'Dieses Konto gehört zu einer anderen Veranstaltung.', 'Ce compte appartient à un autre événement.'],
    ['Team account not found.', 'Teamaccount niet gevonden.', 'Teamkonto nicht gefunden.', 'Compte d’équipe introuvable.'],
    ['This account is also used in another event. Ask the platform admin to change its login or access settings.', 'Dit account wordt ook voor een ander evenement gebruikt. Vraag de platformbeheerder om de aanmeld- of toegangsinstellingen te wijzigen.', 'Dieses Konto wird auch für eine andere Veranstaltung verwendet. Bitte den Plattformadministrator, die Anmelde- oder Zugriffseinstellungen zu ändern.', 'Ce compte est également utilisé pour un autre événement. Demandez à l’administrateur de modifier ses paramètres de connexion ou d’accès.'],
    ['Only the platform admin can assign an event owner.', 'Alleen de platformbeheerder kan een evenementeigenaar toewijzen.', 'Nur der Plattformadministrator kann einen Veranstaltungsinhaber zuweisen.', 'Seul l’administrateur de la plateforme peut attribuer un propriétaire d’événement.'],
    ['Remove this account from its other events before making it an event owner.', 'Verwijder dit account eerst uit de andere evenementen voordat je er een evenementeigenaar van maakt.', 'Entferne dieses Konto aus den anderen Veranstaltungen, bevor du es zum Veranstaltungsinhaber machst.', 'Retirez ce compte des autres événements avant de lui attribuer le rôle de propriétaire.'],
    ['Forbidden', 'Geen toegang', 'Verboten', 'Interdit'],
    ['Public', 'Openbaar', 'Öffentlich', 'Public'],
    ['Private', 'Privé', 'Privat', 'Privé'],
    ['Queued', 'In wachtrij', 'In Warteschlange', 'En file'],
    ['Read', 'Gelezen', 'Gelesen', 'Lu'],
    ['Removed', 'Verwijderd', 'Entfernt', 'Retiré'],
    ['Pin color', 'Vastzetkleur', 'Anheftfarbe', 'Couleur d’épingle'],
    ['Platform admin', 'Platformbeheerder', 'Plattformadministrator', 'Administrateur de la plateforme'],
    ['Event owner', 'Evenementeigenaar', 'Veranstaltungsinhaber', 'Propriétaire de l’événement'],
    ['IP address', 'IP-adres', 'IP-Adresse', 'Adresse IP'],
    ['User', 'Gebruiker', 'Nutzer', 'Utilisateur'],
    ['Disabled', 'Uitgeschakeld', 'Deaktiviert', 'Désactivé'],
    ['Account active', 'Account actief', 'Konto aktiv', 'Compte actif'],
    ['New password (optional)', 'Nieuw wachtwoord (optioneel)', 'Neues Passwort (optional)', 'Nouveau mot de passe (facultatif)'],
    ['Leave blank to keep current', 'Laat leeg om het huidige te behouden', 'Leer lassen, um das aktuelle beizubehalten', 'Laissez vide pour conserver l’actuel'],
    ['Remove from this chat', 'Uit deze chat verwijderen', 'Aus diesem Chat entfernen', 'Retirer de ce chat'],
    ['Save topics', 'Onderwerpen opslaan', 'Themen speichern', 'Enregistrer les sujets'],
    ['This login is shared with another event. Only the platform admin can change its login or access settings here.', 'Deze aanmelding wordt gedeeld met een ander evenement. Alleen de platformbeheerder kan hier de aanmeld- of toegangsinstellingen wijzigen.', 'Dieser Zugang wird für eine weitere Veranstaltung verwendet. Nur der Plattformadministrator kann hier Anmelde- oder Zugriffseinstellungen ändern.', 'Cette connexion est partagée avec un autre événement. Seul l’administrateur de la plateforme peut modifier ici les paramètres de connexion ou d’accès.'],
    ['The event owner manages accounts and topic responsibilities.', 'De eigenaar beheert accounts en onderwerpstoewijzingen.', 'Der Veranstaltungsinhaber verwaltet Konten und Themenzuständigkeiten.', 'Le propriétaire gère les comptes et les responsabilités par sujet.'],
    ['Speaker questions', 'Sprekersvragen', 'Fragen für die Bühne', 'Questions des intervenants'],
    ['Private message sent', 'Privébericht verstuurd', 'Private Nachricht gesendet', 'Message privé envoyé'],
    ['Close conversation', 'Gesprek sluiten', 'Gespräch schließen', 'Fermer la conversation'],
    ['Reopen conversation', 'Gesprek heropenen', 'Gespräch wieder öffnen', 'Rouvrir la conversation'],
    ['Search names or messages', 'Zoek namen of berichten', 'Namen oder Nachrichten suchen', 'Rechercher des noms ou messages'],
    ['All conversations', 'Alle gesprekken', 'Alle Gespräche', 'Toutes les conversations'],
    ['No matching private conversations.', 'Geen privégesprekken gevonden.', 'Keine passenden privaten Chats gefunden.', 'Aucune conversation privée correspondante.'],
    ['Previous', 'Vorige', 'Zurück', 'Précédent'],
    ['Next', 'Volgende', 'Weiter', 'Suivant'],
    ['Open conversation', 'Gesprek openen', 'Gespräch öffnen', 'Ouvrir la conversation'],
    ['Block this IP address for the event? Other people sharing the same network may also lose access.', 'Dit IP-adres voor het evenement blokkeren? Andere mensen op hetzelfde netwerk kunnen dan ook geen toegang meer hebben.', 'Diese IP-Adresse für die Veranstaltung sperren? Andere Personen im selben Netzwerk können ebenfalls den Zugriff verlieren.', 'Bloquer cette adresse IP pour l’événement ? D’autres personnes sur le même réseau pourraient également perdre l’accès.'],
    ['Remove this item from the speaker queue?', 'Dit item uit de sprekerswachtrij halen?', 'Diesen Eintrag aus der Sprecher-Warteschlange entfernen?', 'Retirer cet élément de la file des intervenants ?'],
    ['Blocked user not found.', 'Geblokkeerde gebruiker niet gevonden.', 'Blockierter Nutzer nicht gefunden.', 'Utilisateur bloqué introuvable.'],
    ['English', 'English', 'English', 'English'],
    ['Nederlands', 'Nederlands', 'Nederlands', 'Nederlands'],
    ['Deutsch', 'Deutsch', 'Deutsch', 'Deutsch'],
    ['Français', 'Français', 'Français', 'Français']
  ];
  const languages = ['en', 'nl', 'de', 'fr'];
  const codes = languages.reduce((out, lang, i) => { out[lang] = new Map(rows.map(row => [row[0], row[i + 1]])); return out; }, {});
  const preferred = (navigator.languages || [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase()).find(x => ['nl', 'de', 'fr'].includes(x)) || 'en';
  let current = localStorage.getItem('8star-language') || preferred;
  if (!languages.includes(current)) current = 'en';
  const originalText = new WeakMap();
  const originalAttrs = new WeakMap();
  const attrNames = ['placeholder', 'aria-label', 'title', 'alt'];
  const orderedKeys = rows.map(row => row[0]).sort((a, b) => b.length - a.length);
  const translate = value => {
    const raw = String(value ?? '');
    if (current === 'en') return raw;
    let result = raw;
    for (const key of orderedKeys) {
      const translated = codes[current].get(key);
      if (!key || !translated || key === translated || !result.includes(key)) continue;
      if (/^[\p{L}\p{N}]+$/u.test(key)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const expression = new RegExp('(^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])', 'gu');
        result = result.replace(expression, (_, before) => before + translated);
      } else result = result.split(key).join(translated);
    }
    return result;
  };
  const skipText = node => node.parentElement?.closest('[data-user-content], .bubble p, .private-line p, .pinned-bubble p, .question > p, .stage-question, .stage-select > span:not(.pill), .brand');
  const translateTextNode = node => {
    if (skipText(node)) return;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const next = translate(originalText.get(node));
    if (node.nodeValue !== next) node.nodeValue = next;
  };
  const translateElement = element => {
    if (!(element instanceof Element)) return;
    if (!originalAttrs.has(element)) originalAttrs.set(element, {});
    const saved = originalAttrs.get(element);
    for (const name of attrNames) {
      if (!element.hasAttribute(name)) continue;
      if (!(name in saved)) saved[name] = element.getAttribute(name);
      const next = translate(saved[name]);
      if (element.getAttribute(name) !== next) element.setAttribute(name, next);
    }
  };
  const translateTree = root => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    if (root.nodeType === Node.ELEMENT_NODE) root.querySelectorAll('*').forEach(translateElement);
  };
  const apply = () => {
    document.documentElement.lang = current;
    translateTree(document.body);
    document.querySelectorAll('#locale-select').forEach(select => { select.value = current; });
  };
  const picker = () => '<label class="locale-switch"><span>Interface language</span><select id="locale-select" aria-label="Interface language"><option value="nl">Nederlands</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="en">English</option></select></label>';
  document.addEventListener('change', event => {
    if (event.target?.id !== 'locale-select') return;
    current = languages.includes(event.target.value) ? event.target.value : 'en';
    localStorage.setItem('8star-language', current);
    apply();
  });
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(translateTree);
      else if (record.type === 'characterData') translateTextNode(record.target);
      else if (record.type === 'attributes') translateElement(record.target);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attrNames });
  window.chatI18n = { picker, translate, get language() { return current; }, text(key) { return translate(key); } };
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = message => nativeAlert(translate(message));
  window.confirm = message => nativeConfirm(translate(message));
  apply();
})();
