/*
 * Intakeformulier Pasta And More.
 * Praat met de Apps Script-API (config.js) via fetch zonder cookies, zodat het ook werkt als iemand met
 * meerdere Google-accounts is ingelogd. Het token staat in het #-deel van de link en gaat niet naar GitHub.
 * Validatie komt uit validatie.js (hetzelfde bestand als op de server).
 */
(function () {
  'use strict';

  var TITELS = ['Over jou', 'Adres en contact', 'Bank en ID', 'Belasting en handtekening', 'Controleren'];
  var LAATSTE_INVULSTAP = 3;
  var CONTROLESTAP = 4;
  var API_TIMEOUT_MS = 90000;
  var MAX_FOTO_PX = 1600;
  var KLEIN_FOTO_PX = 480;

  var $ = function (id) { return document.getElementById(id); };
  var token = (/[#&]t=([A-Za-z0-9]{32,})/.exec(location.hash) || [])[1] || '';
  var contractToken = (/[#&]c=([A-Za-z0-9]{32,})/.exec(location.hash) || [])[1] || '';
  var wijzigToken = (/[#&]w=([A-Za-z0-9]{32,})/.exec(location.hash) || [])[1] || '';
  var stap = 0;
  var fotos = { voor: '', achter: '' };          // nieuw gekozen foto's (data-URL)
  var fotosKlein = { voor: '', achter: '' };     // voorbeeldversie (max 480 px) voor de beheerpagina
  var opServer = { voor: false, achter: false }; // al tussentijds opgeslagen
  var bewaardTot = 0;                             // aantal afgeronde stappen op de server
  var bewaarKetting = Promise.resolve();
  var keuzes = { alleenstaande_ouderenkorting: 'nee' };
  var bezig = false;
  var startdatum = null; // Date, uit intake_start
  var openStappen = null; // bij terugsturen: alleen deze stappen zijn open (anders null = alles)
  var gewijzigd = false;

  // ---------- API ----------
  function apiEenmaal(verzoek) {
    var afbreken = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = afbreken ? setTimeout(function () { afbreken.abort(); }, API_TIMEOUT_MS) : null;
    return fetch(window.PF_CONFIG.api, {
      method: 'POST',
      signal: afbreken ? afbreken.signal : undefined,
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(verzoek)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      // Google geeft bij drukte soms een HTML-foutpagina met status 200; dat telt als mislukt.
      try { return JSON.parse(t); } catch (e) { throw new Error('Geen geldig antwoord'); }
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 'fout') throw new Error('Serverfout');
      return r;
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  /**
   * Eén automatische nieuwe poging na 3 s bij een netwerkfout, time-out, HTML-foutpagina of serverfout.
   * De server is idempotent: is de eerste poging toch opgeslagen, dan geeft de tweede "ingevuld" en is het klaar.
   */
  function api(verzoek) {
    if (!verzoek.token) verzoek.token = token;
    return apiEenmaal(verzoek).catch(function () {
      return new Promise(function (ok) { setTimeout(ok, 3000); }).then(function () {
        return apiEenmaal(verzoek).then(function (r) {
          if (verzoek.actie === 'intake_verstuur' && r.status === 'ingevuld') r.status = 'klaar';
          return r;
        });
      });
    });
  }

  // ---------- Schermen ----------
  function toonLaden(tekst) {
    $('scherm-wijziging').hidden = true;
    $('scherm-contract').hidden = true;
    $('formulier').hidden = true;
    $('voortgang').hidden = true;
    $('scherm-melding').hidden = false;
    $('melding').hidden = true;
    $('laden').hidden = false;
    $('ladenTekst').textContent = tekst;
  }

  var MELDINGEN = {
    ongeldig: ['🔒', 'Link werkt niet', 'Deze link is niet (meer) geldig. Stuur een WhatsApp-bericht als je hulp nodig hebt.'],
    verlopen: ['⏰', 'Link verlopen', 'Deze link is verlopen. Stuur een WhatsApp-bericht, dan krijg je een nieuwe.'],
    ingevuld: ['✅', 'Al ingevuld', 'Je gegevens zijn al binnen. Bedankt!'],
    gewijzigd: ['✅', 'Bedankt!', 'Je wijziging is doorgegeven. We verwerken hem zo snel mogelijk.'],
    geen: ['👍', 'Niets veranderd', 'Je gegevens waren al zo. Er is niets gewijzigd.'],
    aangepast: ['🔄', 'Contract wordt aangepast', 'Je contract wordt aangepast. Je krijgt een nieuwe mail zodra het klaarstaat.'],
    te_vaak: ['⏳', 'Even wachten', 'Je hebt te vaak een code aangevraagd. Probeer het over een uur opnieuw.'],
    sessie_verlopen: ['⏰', 'Verlopen', 'Je sessie is verlopen. Open de link opnieuw en vraag een nieuwe code aan.'],
    getekend: ['✍️', 'Getekend!', 'Je contract is ondertekend. Je krijgt het getekende contract per mail. Tot snel!'],
    later: ['💾', 'Bewaard', 'Je gegevens zijn bewaard. Open de link uit je mail als je je BSN en bankpas bij de hand hebt.'],
    klaar: ['🎉', 'Bedankt!', 'Je gegevens zijn goed ontvangen. Je krijgt binnenkort een mail om je contract te tekenen.'],
    nakijken: ['🎉', 'Bedankt!', 'Je gegevens zijn goed ontvangen. We kijken je gegevens na en sturen je daarna je contract.'],
    fout: ['😕', 'Er ging iets mis', 'Probeer het over een paar minuten opnieuw. Lukt het niet? Stuur een WhatsApp-bericht.']
  };

  function toonMelding(soort, voornaam, tekst) {
    var m = MELDINGEN[soort] || MELDINGEN.fout;
    $('scherm-wijziging').hidden = true;
    $('scherm-contract').hidden = true;
    $('formulier').hidden = true;
    $('voortgang').hidden = true;
    $('scherm-melding').hidden = false;
    $('laden').hidden = true;
    $('melding').hidden = false;
    $('meldingIcoon').textContent = m[0];
    $('meldingTitel').textContent = (soort === 'klaar' || soort === 'nakijken') && voornaam ? 'Bedankt, ' + voornaam + '!' : m[1];
    $('meldingTekst').textContent = tekst || m[2];
    window.scrollTo(0, 0);
  }

  function toonStap(n) {
    n = Number(n);
    if (!(n >= 0 && n <= CONTROLESTAP && n % 1 === 0)) n = openStappen ? openStappen[0] : 0; // nooit een "tussenstap"
    stap = n;
    $('stapFout').hidden = true;
    $('scherm-melding').hidden = true;
    $('formulier').hidden = false;
    $('voortgang').hidden = false;
    $('navigatie').hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('.stap'), function (s) {
      s.hidden = Number(s.dataset.stap) !== n;
    });
    $('stapNummer').textContent = n === CONTROLESTAP ? 'Laatste stap' : 'Stap ' + (n + 1) + ' van 4';
    $('stapTitel').textContent = TITELS[n];
    $('balk').style.width = Math.min(100, (n + 1) * 25) + '%';
    $('terug').hidden = n !== CONTROLESTAP && vorigeStap(n) < 0;
    $('later').parentNode.hidden = !!openStappen; // bij terugsturen niet tussentijds opslaan
    $('terug').textContent = n === CONTROLESTAP ? 'Terug om aan te passen' : 'Terug';
    $('navigatie').classList.toggle('gestapeld', n === CONTROLESTAP);
    $('volgende').textContent = n === CONTROLESTAP ? 'Versturen' : 'Volgende';
    if (n === LAATSTE_INVULSTAP) handtekening.pasAan();
    if (n === CONTROLESTAP) vulOverzicht();
    window.scrollTo(0, 0);
  }

  // ---------- Invoer ----------
  function gegevens() {
    var g = {};
    INTAKE_STAPPEN.forEach(function (velden) {
      velden.forEach(function (v) {
        var el = $(v);
        if (el && el.tagName === 'INPUT' && el.type !== 'checkbox') g[v] = el.value;
      });
    });
    Object.keys(keuzes).forEach(function (k) { g[k] = keuzes[k]; });
    g.akkoord = $('akkoord').checked;
    g.leeftijd_bevestigd = $('leeftijd_bevestigd').checked;
    return g;
  }

  function toonFouten(fouten, alleenStap) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-fout]'), function (el) {
      var veld = el.dataset.fout;
      if (alleenStap != null && stapVan(veld) !== alleenStap) return;
      el.textContent = fouten[veld] || '';
      var input = $(veld);
      if (input && input.tagName === 'INPUT') input.setAttribute('aria-invalid', fouten[veld] ? 'true' : 'false');
    });
  }

  function stapVan(veld) {
    if (veld === 'foto_voor' || veld === 'foto_achter') return 2;
    if (veld === 'handtekening') return 3;
    for (var i = 0; i < INTAKE_STAPPEN.length; i++) if (INTAKE_STAPPEN[i].indexOf(veld) !== -1) return i;
    return -1;
  }

  function foutenVanStap(n) {
    var f = valideerIntake(gegevens(), n, new Date()).fouten;
    if (n === 2) {
      if (!fotos.voor && !opServer.voor) f.foto_voor = 'Voeg een foto toe.';
      if (!fotos.achter && !opServer.achter && achterkantNodig(keuzes.id_soort)) f.foto_achter = 'Voeg een foto toe.';
    }
    if (n === 3 && !handtekening.getekend()) f.handtekening = 'Zet je handtekening.';
    return f;
  }

  /** Fout bij een veld dat niet op dit scherm staat? Dan een melding boven de knoppen, zodat Volgende nooit stil blokkeert. */
  function meldOnzichtbareFouten(fouten) {
    var onzichtbaar = Object.keys(fouten).filter(function (veld) {
      var el = document.querySelector('[data-fout="' + veld + '"]');
      return !el || !el.offsetParent;
    });
    $('stapFout').hidden = !onzichtbaar.length;
    $('stapFout').textContent = onzichtbaar.length ? 'Nog niet compleet: ' + onzichtbaar.map(function (v) { return fouten[v]; })
      .filter(function (t, i, a) { return a.indexOf(t) === i; }).join(' ') + ' Lukt het niet? Stuur een WhatsApp-bericht.' : '';
  }

  function focusEersteFout(fouten) {
    var eerste = Object.keys(fouten)[0];
    var el = $(eerste) || document.querySelector('[data-fout="' + eerste + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    if (el && el.tagName === 'INPUT') el.focus({ preventScroll: true });
  }

  // Keuzeknoppen (geslacht, ID, ja/nee)
  document.addEventListener('click', function (e) {
    var knop = e.target.closest('.keuze button');
    if (!knop) return;
    var groep = knop.parentNode;
    keuzes[groep.dataset.naam] = knop.dataset.waarde;
    Array.prototype.forEach.call(groep.children, function (b) { b.setAttribute('aria-pressed', String(b === knop)); });
    gewijzigd = true;
    if (groep.dataset.naam === 'id_soort') pasFotosAan();
  });

  document.addEventListener('input', function (e) {
    gewijzigd = true;
    var v = e.target.id;
    // Melding bij dit veld weg zodra het wordt aangepast; bij Volgende wordt opnieuw gecontroleerd.
    var foutEl = document.querySelector('[data-fout="' + v + '"]');
    if (foutEl) foutEl.textContent = '';
    if (e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false');
    if (v === 'geboortedatum') formatteerDatum(e);
    if (v === 'geboortedatum') { werkNoodHintBij(); werkLeeftijdBij(); }
    if (v === 'iban') {
      var bic = ibanGeldig(e.target.value) ? bicUitIban(e.target.value) : '';
      $('ibanHint').textContent = bic ? 'Bank herkend (' + bic + ').' : 'Staat op je bankpas of in je bank-app.';
    }
  });

  // dd-mm-jjjj automatisch aanvullen tijdens het typen (streepjes na dag en maand)
  function formatteerDatum(e) {
    if (e.inputType && e.inputType.indexOf('delete') === 0) return;
    var c = e.target.value.replace(/\D/g, '').slice(0, 8);
    var t = c.slice(0, 2);
    if (c.length >= 3) t += '-' + c.slice(2, 4);
    if (c.length >= 5) t += '-' + c.slice(4);
    e.target.value = t;
  }

  /** Vangnet: toon de leeftijd op de startdatum en laat die bevestigen; bij een nieuwe datum opnieuw bevestigen. */
  function werkLeeftijdBij() {
    $('leeftijd_bevestigd').checked = false;
    var geb = leesDatumInvoer($('geboortedatum').value);
    var tonen = !!(geb && startdatum && $('geboortedatum').value.length === 10);
    $('leeftijdCheck').hidden = !tonen;
    if (tonen) {
      $('leeftijdTekst').textContent = 'Je bent op je startdatum ' + leeftijdOpDatum(geb, startdatum) + ' jaar. Klopt dat?';
    }
  }

  function werkNoodHintBij() {
    var geb = leesDatumInvoer($('geboortedatum').value);
    var jong = geb && leeftijdOpDatum(geb, new Date()) < 18;
    $('noodHint').textContent = 'Wie bellen we als er iets met je gebeurt tijdens het werk?' +
      (jong ? ' Verplicht, omdat je jonger bent dan 18.' : geb ? ' Niet verplicht, wel handig.' : '');
  }

  // ---------- Foto's ----------
  function pasFotosAan() {
    var paspoort = keuzes.id_soort === 'paspoort';
    document.querySelector('[data-foto="achter"]').hidden = paspoort;
    document.querySelector('.fotos').classList.toggle('een', paspoort);
    $('fotoVoorTitel').textContent = paspoort ? 'Pagina met je gegevens' : 'Voorkant';
  }

  function verklein(bestand) {
    return new Promise(function (ok, fout) {
      var url = URL.createObjectURL(bestand);
      var img = new Image();
      img.onload = function () {
        function versie(maxPx, kwaliteit) {
          var schaal = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * schaal);
          c.height = Math.round(img.naturalHeight * schaal);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', kwaliteit);
        }
        var uit = { groot: versie(MAX_FOTO_PX, 0.85), klein: versie(KLEIN_FOTO_PX, 0.7) };
        URL.revokeObjectURL(url);
        ok(uit);
      };
      img.onerror = function () { URL.revokeObjectURL(url); fout(new Error('onleesbaar')); };
      img.src = url;
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.foto'), function (vak) {
    var kant = vak.dataset.foto;
    Array.prototype.forEach.call(vak.querySelectorAll('input[type=file]'), function (input) {
      input.addEventListener('change', function () {
        var bestand = input.files && input.files[0];
        input.value = '';
        if (!bestand) return;
        var foutEl = vak.querySelector('.fout');
        foutEl.textContent = '';
        verklein(bestand).then(function (v) {
          var dataUrl = v.groot;
          fotos[kant] = dataUrl;
          fotosKlein[kant] = v.klein;
          opServer[kant] = false;
          gewijzigd = true;
          var img = vak.querySelector('img');
          img.src = dataUrl;
          img.hidden = false;
          vak.querySelector('.foto-vak span').hidden = true;
          vak.querySelector('.foto-vak').classList.add('gevuld');
        }).catch(function () {
          foutEl.textContent = 'Deze foto kan niet worden gelezen. Maak een nieuwe foto of kies een JPG of PNG.';
        });
      });
    });
  });

  // ---------- Handtekening ----------
  /** Tekenvak met de vinger. Gebruikt voor de loonheffing (stap 4) en voor het contract. */
  function maakHandtekening(canvasId, wisId, zichtbaar, foutNaam) {
    var canvas = $(canvasId);
    var ctx = canvas.getContext('2d');
    var lengte = 0; // getekende lengte in px; een stip of vegje telt niet als handtekening
    var vorige = null;

    function pasAan() {
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      var dpr = window.devicePixelRatio || 1;
      if (canvas.width === Math.round(r.width * dpr)) return;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
      lengte = 0; // formaat gewijzigd: canvas is leeg, opnieuw tekenen
    }
    function punt(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var foutEl = document.querySelector('[data-fout="' + foutNaam + '"]');
      if (foutEl) foutEl.textContent = '';
      canvas.setPointerCapture(e.pointerId);
      vorige = punt(e);
      ctx.beginPath();
      ctx.arc(vorige.x, vorige.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!vorige) return;
      var p = punt(e);
      ctx.beginPath();
      ctx.moveTo(vorige.x, vorige.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lengte += Math.hypot(p.x - vorige.x, p.y - vorige.y);
      vorige = p;
      gewijzigd = true;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      canvas.addEventListener(t, function () { vorige = null; });
    });
    $(wisId).addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lengte = 0;
    });
    window.addEventListener('resize', function () {
      if (zichtbaar()) pasAan();
    });
    return {
      pasAan: pasAan,
      getekend: function () { return lengte > 80; },
      // Bijgesneden tot de getekende lijnen (plus marge), zodat de handtekening het vak in de PDF vult.
      dataUrl: function () {
        var w = canvas.width, h = canvas.height;
        var px = ctx.getImageData(0, 0, w, h).data;
        var x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            if (px[(y * w + x) * 4 + 3] > 16) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return canvas.toDataURL('image/png');
        var marge = Math.round(6 * (window.devicePixelRatio || 1));
        x0 = Math.max(0, x0 - marge); y0 = Math.max(0, y0 - marge);
        x1 = Math.min(w - 1, x1 + marge); y1 = Math.min(h - 1, y1 + marge);
        var uit = document.createElement('canvas');
        uit.width = x1 - x0 + 1;
        uit.height = y1 - y0 + 1;
        uit.getContext('2d').drawImage(canvas, x0, y0, uit.width, uit.height, 0, 0, uit.width, uit.height);
        return uit.toDataURL('image/png');
      }
    };
  }

  var handtekening = maakHandtekening('handtekening', 'wisHandtekening', function () {
    return !$('formulier').hidden && stap === LAATSTE_INVULSTAP;
  }, 'handtekening');
  var contractHandtekening = maakHandtekening('contractHandtekening', 'wisContractHandtekening', function () {
    return !$('scherm-contract').hidden;
  }, 'contractHandtekening');

  // ---------- Tussentijds opslaan ----------
  var NIET_TUSSENTIJDS = ['bsn', 'iban', 'handtekening', 'akkoord'];

  function foutenVoorBewaren(n) {
    var f = foutenVanStap(n);
    NIET_TUSSENTIJDS.forEach(function (k) { delete f[k]; });
    return f;
  }

  /** Slaat stap n op de achtergrond op (op volgorde); de medewerker hoeft niet te wachten. */
  function bewaar(n) {
    var verzoek = { actie: 'intake_bewaar', stap: n, gegevens: gegevens(), fotos: {} };
    delete verzoek.gegevens.bsn;
    delete verzoek.gegevens.iban;
    if (n === 2) {
      ['voor', 'achter'].forEach(function (k) {
        if (fotos[k] && !opServer[k] && (k === 'voor' || achterkantNodig(keuzes.id_soort))) {
          verzoek.fotos[k] = fotos[k];
          verzoek.fotos[k + 'Klein'] = fotosKlein[k];
        }
      });
    }
    bewaarKetting = bewaarKetting.then(function () {
      return api(verzoek).then(function (r) {
        if (r.status !== 'bewaard') return;
        bewaardTot = Math.max(bewaardTot, r.stap);
        (r.fotos || []).forEach(function (k) { opServer[k] = true; fotos[k] = ''; fotosKlein[k] = ''; });
      });
    }).catch(function () { /* stil: bij versturen gaat alles alsnog mee */ });
    return bewaarKetting;
  }

  $('later').addEventListener('click', function () {
    var knop = this;
    $('laterFout').textContent = '';
    if (stap <= LAATSTE_INVULSTAP && !Object.keys(foutenVoorBewaren(stap)).length) bewaar(stap);
    knop.disabled = true;
    knop.textContent = 'Bewaren…';
    bewaarKetting.then(function () {
      knop.disabled = false;
      knop.textContent = 'Later verder';
      if (!bewaardTot) {
        $('laterFout').textContent = 'Vul eerst deze stap helemaal in, dan kunnen we je gegevens bewaren.';
        return;
      }
      gewijzigd = false;
      toonMelding('later');
    });
  });

  /** Eerder bewaarde gegevens terugzetten en verder gaan waar de medewerker was. */
  function vulConcept(c) {
    Object.keys(c.gegevens).forEach(function (v) {
      var groep = document.querySelector('.keuze[data-naam="' + v + '"]');
      if (groep) {
        keuzes[v] = c.gegevens[v];
        Array.prototype.forEach.call(groep.children, function (b) {
          b.setAttribute('aria-pressed', String(b.dataset.waarde === c.gegevens[v]));
        });
        return;
      }
      var el = $(v);
      if (el && el.tagName === 'INPUT') el.value = c.gegevens[v];
    });
    werkNoodHintBij();
    werkLeeftijdBij();
    $('leeftijd_bevestigd').checked = c.stap >= 1; // stap 1 kan alleen af met een bevestigde leeftijd
    pasFotosAan();
    ['voor', 'achter'].forEach(function (k) {
      opServer[k] = !!c.fotos[k];
      if (!opServer[k]) return;
      var vak = document.querySelector('[data-foto="' + k + '"] .foto-vak');
      vak.querySelector('span').textContent = 'Al opgeslagen ✓';
      vak.querySelector('span').className = 'opgeslagen';
    });
    bewaardTot = c.stap;
    $('welkomTerug').hidden = false;
    toonStap(Math.min(c.stap, LAATSTE_INVULSTAP));
  }

  // ---------- Controlescherm ----------
  // Huisnummer en toevoeging staan in de regel "Adres" (bij straat).
  var OVERZICHT_OVERSLAAN = ['akkoord', 'leeftijd_bevestigd', 'bsn', 'iban', 'huisnummer', 'toevoeging'];

  var OVERZICHT_LABELS = {
    straat: 'Adres',
    tussenvoegsel: 'Tussenvoegsel',
    noodcontact_naam: 'Noodcontact',
    noodcontact_relatie: 'Relatie noodcontact',
    noodcontact_telefoon: 'Telefoon noodcontact'
  };

  function labelVan(veld) {
    if (OVERZICHT_LABELS[veld]) return OVERZICHT_LABELS[veld];
    var l = document.querySelector('label[for="' + veld + '"]');
    if (!l) {
      var groep = document.querySelector('.keuze[data-naam="' + veld + '"]');
      l = groep && groep.parentNode.querySelector('label');
    }
    return l ? l.textContent.replace(/\?$/, '') : veld;
  }

  /** Waarde zoals die wordt opgeslagen (nette hoofdletters, postcode "1234 AB"); anders zoals ingevuld. */
  function waardeVan(veld, schoon) {
    var groep = document.querySelector('.keuze[data-naam="' + veld + '"]');
    if (groep) {
      var gekozen = groep.querySelector('[aria-pressed="true"]');
      return gekozen ? gekozen.textContent : '';
    }
    if (veld === 'straat') {
      return (schoon.straat || $('straat').value.trim()) + ' ' + huisnummerMetToevoeging($('huisnummer').value, $('toevoeging').value);
    }
    if (schoon && typeof schoon[veld] === 'string' && schoon[veld]) return schoon[veld];
    var el = $(veld);
    return el ? el.value.trim() : '';
  }

  function vulOverzicht() {
    var g = gegevens();
    var schoon = valideerIntake(g, null, new Date()).schoon;
    $('controleBsn').textContent = isOpen(2) ? String(g.bsn || '').replace(/\D/g, '') : 'ongewijzigd';
    $('controleIban').textContent = isOpen(2) ? normaliseerIban(g.iban).replace(/(.{4})/g, '$1 ').trim() : 'ongewijzigd';
    var html = '';
    INTAKE_STAPPEN.forEach(function (velden, n) {
      var rijen = velden.filter(function (v) { return OVERZICHT_OVERSLAAN.indexOf(v) === -1; }).map(function (v) {
        return '<div><dt></dt><dd></dd></div>';
      });
      html += '<div class="overzicht-groep" data-groep="' + n + '"><div class="overzicht-kop"><h2></h2>' +
        (isOpen(n) ? '<button type="button" class="tekst-knop" data-naar="' + n + '">Aanpassen</button>' : '') + '</div><dl>' + rijen.join('') +
        (n === LAATSTE_INVULSTAP ? '<div><dt>Handtekening</dt><dd><img alt="Je handtekening"></dd></div>' : '') + '</dl></div>';
    });
    $('overzicht').innerHTML = html;
    // Teksten via textContent: ingevulde waarden nooit als HTML.
    INTAKE_STAPPEN.forEach(function (velden, n) {
      var groep = document.querySelector('[data-groep="' + n + '"]');
      groep.querySelector('h2').textContent = TITELS[n];
      var dts = groep.querySelectorAll('dt');
      var dds = groep.querySelectorAll('dd');
      velden.filter(function (v) { return OVERZICHT_OVERSLAAN.indexOf(v) === -1; }).forEach(function (v, i) {
        dts[i].textContent = labelVan(v);
        dds[i].textContent = waardeVan(v, schoon) || '–';
      });
      if (n === LAATSTE_INVULSTAP) groep.querySelector('img').src = handtekening.dataUrl();
    });
  }

  $('overzicht').addEventListener('click', function (e) {
    var knop = e.target.closest('[data-naar]');
    if (knop) toonStap(Number(knop.dataset.naar));
  });

  // ---------- Navigatie ----------
  function isOpen(n) { return !openStappen || openStappen.indexOf(n) !== -1; }
  function volgendeStap(n) {
    for (var i = n + 1; i <= LAATSTE_INVULSTAP; i++) if (isOpen(i)) return i;
    return CONTROLESTAP;
  }
  function vorigeStap(n) {
    for (var i = n - 1; i >= 0; i--) if (isOpen(i)) return i;
    return -1;
  }

  $('terug').addEventListener('click', function () {
    if (stap === CONTROLESTAP) { toonStap(isOpen(2) ? 2 : openStappen ? openStappen[0] : 2); return; } // BSN/IBAN staan in "Bank en ID"
    var vorige = vorigeStap(stap);
    if (vorige >= 0) toonStap(vorige);
  });

  $('formulier').addEventListener('submit', function (e) {
    e.preventDefault();
    if (bezig) return;
    if (stap <= LAATSTE_INVULSTAP) {
      var fouten = foutenVanStap(stap);
      toonFouten(fouten, stap);
      if (Object.keys(fouten).length) { focusEersteFout(fouten); meldOnzichtbareFouten(fouten); return; }
    }
    if (stap < CONTROLESTAP) {
      if (stap <= LAATSTE_INVULSTAP && !openStappen) bewaar(stap);
      toonStap(volgendeStap(stap));
      return;
    }
    verstuur();
  });

  function verstuur() {
    // Laatste controle over alle stappen samen.
    for (var n = 0; n <= LAATSTE_INVULSTAP; n++) {
      if (!isOpen(n)) continue;
      var f = foutenVanStap(n);
      if (Object.keys(f).length) { toonStap(n); toonFouten(f, n); focusEersteFout(f); return; }
    }
    bezig = true;
    var verzoek = {
      actie: 'intake_verstuur',
      gegevens: gegevens(),
      fotos: {
        voor: opServer.voor ? '' : fotos.voor,
        voorKlein: opServer.voor ? '' : fotosKlein.voor,
        achter: achterkantNodig(keuzes.id_soort) && !opServer.achter ? fotos.achter : '',
        achterKlein: achterkantNodig(keuzes.id_soort) && !opServer.achter ? fotosKlein.achter : ''
      },
      handtekening: handtekening.dataUrl()
    };
    toonLaden('Je gegevens worden verstuurd. Dit kan een halve minuut duren…');
    bewaarKetting.then(function () { return api(verzoek); }).then(function (r) {
      bezig = false;
      if (r.status === 'fouten') {
        // Alleen naar een stap die open is (bij terugsturen); fouten elders komen in de melding boven de knoppen.
        var eerste = Math.min.apply(null, Object.keys(r.fouten).map(stapVan).filter(function (s) { return s >= 0 && isOpen(s); }));
        toonStap(isFinite(eerste) ? eerste : LAATSTE_INVULSTAP);
        toonFouten(r.fouten, null);
        focusEersteFout(r.fouten);
        meldOnzichtbareFouten(r.fouten);
        return;
      }
      gewijzigd = false;
      if (r.status === 'klaar' && r.contract) {
        // Contract staat klaar: direct door naar de ondertekenpagina (de link staat ook in de mail).
        contractToken = r.contract;
        history.replaceState(null, '', '#c=' + r.contract);
        startContract();
        return;
      }
      toonMelding(r.status === 'klaar' ? (r.nakijken ? 'nakijken' : 'klaar') : r.status, r.voornaam);
    }).catch(function () {
      bezig = false;
      toonStap(LAATSTE_INVULSTAP);
      toonFouten({ akkoord: 'Versturen lukte niet. Controleer je internet en probeer het opnieuw.' }, LAATSTE_INVULSTAP);
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (gewijzigd && !bezig) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Ondertekenen ----------
  var CONTRACT_MELDINGEN = {
    ongeldig: 'ongeldig',
    verlopen: 'verlopen',
    getekend: 'getekend'
  };

  /**
   * Snelle aanroep voor alleen-lezen-acties: komt er na `dubbelNa` ms nog geen antwoord, dan gaat er een tweede,
   * identieke aanroep; de eerste die antwoordt wint (vangt de uitschieters van Google Apps Script op).
   * Na `max` ms zonder antwoord: fout (de pagina toont dan "Opnieuw proberen").
   */
  function apiSnel(verzoek, dubbelNa, max) {
    if (!verzoek.token) verzoek.token = token;
    return new Promise(function (ok, fout) {
      var klaar = false;
      var gestart = 0;
      var mislukt = 0;
      function poging() {
        gestart++;
        apiEenmaal(verzoek).then(function (r) {
          if (klaar) return;
          klaar = true;
          clearTimeout(t1);
          clearTimeout(t2);
          ok(r);
        }, function (e) {
          mislukt++;
          if (klaar) return;
          // Foutpagina van Google of netwerkfout: na een korte pauze opnieuw (maximaal 3 pogingen).
          if (gestart < 3) { setTimeout(function () { if (!klaar) poging(); }, 400); return; }
          if (mislukt >= gestart) { klaar = true; clearTimeout(t2); fout(e); }
        });
      }
      var t1 = setTimeout(function () { if (!klaar && gestart < 3) poging(); }, dubbelNa);
      var t2 = setTimeout(function () {
        if (!klaar) { klaar = true; fout(new Error('Het duurt te lang')); }
      }, max);
      poging();
    });
  }

  var contractGeladenOp = 0;
  var contractStartTijd = 0;

  function toonContractDeel(deel) {
    ['contractLaden', 'contractFout', 'contractInhoud'].forEach(function (id) { $(id).hidden = id !== deel; });
  }

  function startContract() {
    // Meteen iets laten zien: logo, "Hoi!" en een laadbalk. De gegevens komen zo snel mogelijk; de PDF pas op verzoek.
    contractStartTijd = Date.now();
    $('scherm-melding').hidden = true;
    $('formulier').hidden = true;
    $('voortgang').hidden = true;
    $('scherm-contract').hidden = false;
    toonContractDeel('contractLaden');
    apiSnel({ actie: 'contract_start', token: contractToken }, 6000, 20000).then(function (r) {
      if (r.status !== 'open') { toonMelding(CONTRACT_MELDINGEN[r.status] || 'fout', r.voornaam); return; }
      $('contractKop').textContent = 'Hoi ' + r.voornaam + ', hier is je contract';
      var s = r.samenvatting;
      var rijen = [['Naam', s.naam], ['Functie', s.functie], ['Start', s.startdatum], ['Tot en met', s.einddatum],
        ['Proeftijd tot en met', s.proeftijd], ['Bruto all-in uurloon', '€ ' + s.uurloon]];
      $('contractSamenvatting').innerHTML = '';
      rijen.forEach(function (rij) {
        var div = document.createElement('div');
        var dt = document.createElement('dt');
        var dd = document.createElement('dd');
        dt.textContent = rij[0];
        dd.textContent = rij[1];
        div.appendChild(dt);
        div.appendChild(dd);
        $('contractSamenvatting').appendChild(div);
      });
      // Leesversie: HTML van de server (tekst ge-escaped, alleen eenvoudige opmaak). Zonder leesversie: de PDF.
      $('lezerInhoud').innerHTML = r.html || '';
      $('contractLezen').hidden = !r.html;
      $('contractDatum').textContent = 'Datum: ' + formatDatumNl(new Date());
      toonContractDeel('contractInhoud');
      contractGeladenOp = Date.now() - contractStartTijd;
      contractHandtekening.pasAan();
    }).catch(function () {
      $('contractFoutTekst').textContent = 'Het laden duurt langer dan normaal of lukt nu niet. ' +
        'Controleer je internet en probeer het opnieuw.';
      toonContractDeel('contractFout');
    });
  }

  $('contractOpnieuw').addEventListener('click', startContract);

  // Leesweergave: volledig scherm, sluiten met ✕, vaste knop "Akkoord, naar ondertekenen" (actief na scrollen tot het einde).
  function lezerAanHetEinde() {
    var el = $('lezerInhoud');
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  }
  function werkLezerKnopBij() {
    var eind = lezerAanHetEinde();
    $('lezerAkkoord').disabled = !eind;
    $('lezerHint').textContent = eind ? 'Je hebt alles gelezen.' : 'Scroll tot het einde';
  }
  function openLezer() {
    $('lezer').hidden = false;
    document.body.classList.add('lezer-open');
    $('lezerInhoud').scrollTop = 0;
    werkLezerKnopBij();
    $('lezerSluit').focus();
  }
  function sluitLezer() {
    $('lezer').hidden = true;
    document.body.classList.remove('lezer-open');
  }
  $('contractLezen').addEventListener('click', openLezer);
  $('lezerSluit').addEventListener('click', sluitLezer);
  $('lezerInhoud').addEventListener('scroll', werkLezerKnopBij, { passive: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('lezer').hidden) sluitLezer(); });
  $('lezerAkkoord').addEventListener('click', function () {
    sluitLezer();
    $('contractAkkoord').checked = true;
    document.querySelector('[data-fout="contractAkkoord"]').textContent = '';
    $('contractHandtekening').scrollIntoView({ block: 'center', behavior: 'smooth' });
    contractHandtekening.pasAan();
  });

  // PDF pas ophalen als erom gevraagd wordt; daarna een echte link (opent ook in Safari zonder pop-upblokkering).
  $('pdfDownload').addEventListener('click', function () {
    var knop = this;
    if (knop.dataset.url) return;
    knop.disabled = true;
    knop.textContent = 'PDF laden…';
    apiSnel({ actie: 'contract_pdf', token: contractToken }, 8000, 40000).then(function (r) {
      if (r.status !== 'ok') throw new Error();
      var bytes = Uint8Array.from(atob(r.pdf), function (c) { return c.charCodeAt(0); });
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      var link = document.createElement('a');
      link.className = 'knop licht';
      link.href = url;
      link.download = r.naam;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'PDF openen';
      knop.replaceWith(link);
    }).catch(function () {
      knop.disabled = false;
      knop.textContent = 'Downloaden (PDF) – opnieuw proberen';
    });
  });

  $('tekenKnop').addEventListener('click', function () {
    if (bezig) return;
    var fouten = {};
    if (!$('contractAkkoord').checked) fouten.contractAkkoord = 'Vink aan dat je het contract hebt gelezen en akkoord gaat.';
    if (!contractHandtekening.getekend()) fouten.contractHandtekening = 'Zet je handtekening.';
    ['contractAkkoord', 'contractHandtekening'].forEach(function (k) {
      document.querySelector('[data-fout="' + k + '"]').textContent = fouten[k] || '';
    });
    if (Object.keys(fouten).length) {
      document.querySelector('[data-fout="' + Object.keys(fouten)[0] + '"]').scrollIntoView({ block: 'center' });
      return;
    }
    bezig = true;
    var verzoek = { actie: 'contract_teken', token: contractToken, akkoord: true,
      handtekening: contractHandtekening.dataUrl(), userAgent: navigator.userAgent, laadtijdMs: contractGeladenOp };
    toonLaden('Je contract wordt ondertekend. Dit kan een halve minuut duren…');
    api(verzoek).then(function (r) {
      bezig = false;
      if (r.status === 'fouten') {
        $('scherm-melding').hidden = true;
        $('scherm-contract').hidden = false;
        toonContractDeel('contractInhoud');
        Object.keys(r.fouten).forEach(function (k) {
          var el = document.querySelector('[data-fout="' + k + '"]');
          if (el) el.textContent = r.fouten[k];
        });
        return;
      }
      toonMelding(CONTRACT_MELDINGEN[r.status] || 'fout', r.voornaam);
    }).catch(function () {
      bezig = false;
      toonMelding('fout');
    });
  });

  // ---------- Wijziging doorgeven (#w=token) ----------
  var wSessie = '';
  var wLhk = '';
  var wHandtekening = maakHandtekening('wHandtekening', 'wWis', function () { return !$('scherm-wijziging').hidden; }, 'wHandtekening');
  var W_VELDEN = {
    iban: ['iban'], adres: ['straat', 'huisnummer', 'toevoeging', 'postcode', 'woonplaats'], telefoon: ['mobiel'],
    noodcontact: ['noodcontact_naam', 'noodcontact_relatie', 'noodcontact_telefoon'], loonheffingskorting: []
  };

  function toonWijziging(deel) {
    $('scherm-melding').hidden = true;
    $('formulier').hidden = true;
    $('voortgang').hidden = true;
    $('scherm-wijziging').hidden = false;
    $('wStapCode').hidden = deel !== 'code';
    $('wStapKeuze').hidden = deel !== 'keuze';
  }

  function wFouten(fouten) {
    Array.prototype.forEach.call(document.querySelectorAll('#scherm-wijziging [data-fout]'), function (el) {
      var k = el.dataset.fout;
      el.textContent = fouten[k.replace(/^w-/, '')] || fouten[k] || '';
    });
  }

  function startWijziging() {
    toonLaden('Even laden…');
    apiSnel({ actie: 'wijziging_start', token: wijzigToken }, 6000, 20000).then(function (r) {
      if (r.status !== 'open') { toonMelding(r.status); return; }
      $('wKop').textContent = 'Hoi ' + r.voornaam + ', wat verandert er?';
      $('wEmail').textContent = r.email;
      toonWijziging('code');
    }).catch(function () { toonMelding('fout'); });
  }

  $('wStuurCode').addEventListener('click', function () {
    var knop = this;
    knop.disabled = true;
    knop.textContent = 'Code wordt verstuurd…';
    $('wCodeVak').hidden = false;
    $('wCode').focus();
    api({ actie: 'wijziging_code', token: wijzigToken }).then(function (r) {
      knop.disabled = false;
      knop.textContent = 'Nieuwe code sturen';
      if (r.status !== 'verstuurd') toonMelding(r.status);
    }).catch(function () { knop.disabled = false; knop.textContent = 'Stuur code'; toonMelding('fout'); });
  });

  $('wCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('wBevestig').click(); } });
  $('wCode').addEventListener('input', function () { if ($('wCode').value.replace(/\D/g, '').length === 6) $('wBevestig').click(); });
  $('wBevestig').addEventListener('click', function () {
    var knop = this;
    knop.disabled = true;
    wFouten({});
    apiSnel({ actie: 'wijziging_verifieer', token: wijzigToken, code: $('wCode').value }, 6000, 30000).then(function (r) {
      knop.disabled = false;
      if (r.status === 'fouten') { wFouten(r.fouten); return; }
      if (r.status !== 'ok') { toonMelding(r.status); return; }
      wSessie = r.sessie;
      var g = r.gegevens;
      $('wIbanNu').textContent = 'Nu: ' + g.ibanMasker;
      ['straat', 'huisnummer', 'toevoeging', 'postcode', 'woonplaats', 'mobiel', 'noodcontact_naam', 'noodcontact_relatie',
        'noodcontact_telefoon'].forEach(function (v) { $('w-' + v).value = g[v] || ''; });
      $('wDatum').textContent = 'Datum: ' + formatDatumNl(new Date());
      toonWijziging('keuze');
    }).catch(function () { knop.disabled = false; toonMelding('fout'); });
  });

  // Onderwerp aan/uit → velden tonen
  $('wStapKeuze').addEventListener('change', function (e) {
    var o = e.target.dataset && e.target.dataset.onderwerp;
    if (!o) return;
    document.querySelector('[data-velden="' + o + '"]').hidden = !e.target.checked;
    if (o === 'loonheffingskorting' && e.target.checked) wHandtekening.pasAan();
  });
  document.querySelector('[data-naam="w-lhk"]').addEventListener('click', function (e) {
    var knop = e.target.closest('button');
    if (!knop) return;
    wLhk = knop.dataset.waarde;
    Array.prototype.forEach.call(this.children, function (b) { b.setAttribute('aria-pressed', String(b === knop)); });
    $('wLhkDatumLabel').textContent = wLhk === 'ja' ? 'Toepassen vanaf' : 'Niet meer toepassen vanaf';
  });

  $('wVerstuur').addEventListener('click', function () {
    if (bezig) return;
    var onderwerpen = Array.prototype.filter.call(document.querySelectorAll('[data-onderwerp]'), function (c) { return c.checked; })
      .map(function (c) { return c.dataset.onderwerp; });
    var fouten = {};
    if (!onderwerpen.length) fouten.onderwerpen = 'Vink aan wat je wilt wijzigen.';
    var lhk = onderwerpen.indexOf('loonheffingskorting') !== -1;
    if (lhk) {
      if (!wLhk) fouten.loonheffingskorting = 'Kies wel of niet toepassen.';
      if (!$('w-lhkDatum').value) fouten.lhkDatum = 'Kies een datum.';
      if (!wHandtekening.getekend()) fouten.wHandtekening = 'Zet je handtekening.';
      if (!$('wAkkoord').checked) fouten.wAkkoord = 'Vink aan dat je gegevens kloppen.';
    }
    wFouten(fouten);
    if (Object.keys(fouten).length) return;
    var gegevens = {};
    onderwerpen.forEach(function (o) { W_VELDEN[o].forEach(function (v) { gegevens[v] = $('w-' + v).value; }); });
    if (lhk) gegevens.loonheffingskorting = wLhk;
    bezig = true;
    toonLaden('Je wijziging wordt verstuurd…');
    api({ actie: 'wijziging_verstuur', token: wijzigToken, sessie: wSessie, onderwerpen: onderwerpen, gegevens: gegevens,
      lhkDatum: lhk ? $('w-lhkDatum').value : '', handtekening: lhk ? wHandtekening.dataUrl() : '', akkoord: $('wAkkoord').checked })
      .then(function (r) {
        bezig = false;
        if (r.status === 'fouten') { toonWijziging('keuze'); wFouten(r.fouten); return; }
        toonMelding(r.status === 'klaar' ? 'gewijzigd' : r.status);
      }).catch(function () { bezig = false; toonMelding('fout'); });
  });

  // ---------- Start ----------
  function start() {
    if (wijzigToken) { startWijziging(); return; }
    if (contractToken) { startContract(); return; }
    if (!token) { toonMelding('ongeldig'); return; }
    toonLaden('Even laden…');
    apiSnel({ actie: 'intake_start' }, 6000, 30000).then(function (r) {
      if (r.status !== 'open') { toonMelding(r.status, r.voornaam); return; }
      Array.prototype.forEach.call(document.querySelectorAll('.voornaam'), function (el) { el.textContent = r.voornaam; });
      $('email').textContent = r.email;
      $('startdatum').textContent = r.startdatum;
      startdatum = leesDatumInvoer(r.startdatum);
      $('tekenDatum').textContent = 'Datum: ' + formatDatumNl(new Date());
      if (r.correctie) {
        openStappen = (r.correctie.stappen || []).map(Number).filter(function (n, i, a) {
          return n >= 0 && n <= LAATSTE_INVULSTAP && n % 1 === 0 && a.indexOf(n) === i;
        });
        if (openStappen.indexOf(LAATSTE_INVULSTAP) === -1) openStappen.push(LAATSTE_INVULSTAP);
        openStappen.sort(function (a, b) { return a - b; });
        if (r.concept) r.concept.stap = openStappen[0];
        $('welkomTerug').textContent = 'Pas je gegevens aan: ' + r.correctie.reden + '. Je eerder ingevulde gegevens staan er al. ' +
          'Aan het eind zet je opnieuw je handtekening.';
      }
      if (r.concept) vulConcept(r.concept);
      else toonStap(0);
      if (r.correctie && !isOpen(0)) $('leeftijd_bevestigd').checked = true;
    }).catch(function () { toonMelding('fout'); });
  }

  function formatDatumNl(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
  }

  start();
})();
