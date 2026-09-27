/*
 * Intakeformulier Pasta And More.
 * Praat met de Apps Script-API (config.js) via fetch zonder cookies, zodat het ook werkt als iemand met
 * meerdere Google-accounts is ingelogd. Het token staat in het #-deel van de link en gaat niet naar GitHub.
 * Validatie komt uit validatie.js (hetzelfde bestand als op de server).
 */
(function () {
  'use strict';

  var TITELS = ['Over jou', 'Adres en contact', 'Bank en ID', 'Belasting en handtekening'];
  var MAX_FOTO_PX = 1600;

  var $ = function (id) { return document.getElementById(id); };
  var token = (/[#&]t=([A-Za-z0-9]{32,})/.exec(location.hash) || [])[1] || '';
  var stap = 0;
  var fotos = { voor: '', achter: '' };
  var keuzes = { alleenstaande_ouderenkorting: 'nee' };
  var bezig = false;
  var gewijzigd = false;

  // ---------- API ----------
  function api(verzoek) {
    verzoek.token = token;
    return fetch(window.PF_CONFIG.api, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(verzoek)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ---------- Schermen ----------
  function toonLaden(tekst) {
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
    klaar: ['🎉', 'Bedankt!', 'Je gegevens zijn goed ontvangen. Je krijgt binnenkort een mail om je contract te tekenen.'],
    fout: ['😕', 'Er ging iets mis', 'Probeer het over een paar minuten opnieuw. Lukt het niet? Stuur een WhatsApp-bericht.']
  };

  function toonMelding(soort, voornaam, tekst) {
    var m = MELDINGEN[soort] || MELDINGEN.fout;
    $('formulier').hidden = true;
    $('voortgang').hidden = true;
    $('scherm-melding').hidden = false;
    $('laden').hidden = true;
    $('melding').hidden = false;
    $('meldingIcoon').textContent = m[0];
    $('meldingTitel').textContent = soort === 'klaar' && voornaam ? 'Bedankt, ' + voornaam + '!' : m[1];
    $('meldingTekst').textContent = tekst || m[2];
    window.scrollTo(0, 0);
  }

  function toonStap(n) {
    stap = n;
    $('scherm-melding').hidden = true;
    $('formulier').hidden = false;
    $('voortgang').hidden = false;
    $('navigatie').hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('.stap'), function (s) {
      s.hidden = Number(s.dataset.stap) !== n;
    });
    $('stapNummer').textContent = 'Stap ' + (n + 1) + ' van 4';
    $('stapTitel').textContent = TITELS[n];
    $('balk').style.width = ((n + 1) * 25) + '%';
    $('terug').hidden = n === 0;
    $('volgende').textContent = n === 3 ? 'Versturen' : 'Volgende';
    if (n === 3) handtekening.pasAan();
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
      if (!fotos.voor) f.foto_voor = 'Voeg een foto toe.';
      if (!fotos.achter && achterkantNodig(keuzes.id_soort)) f.foto_achter = 'Voeg een foto toe.';
    }
    if (n === 3 && !handtekening.getekend()) f.handtekening = 'Zet je handtekening.';
    return f;
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
    if (v === 'geboortedatum') formatteerDatum(e);
    if (v === 'geboortedatum') werkNoodHintBij();
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
        var schaal = Math.min(1, MAX_FOTO_PX / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * schaal);
        c.height = Math.round(img.naturalHeight * schaal);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.85));
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
        verklein(bestand).then(function (dataUrl) {
          fotos[kant] = dataUrl;
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
  var handtekening = (function () {
    var canvas = $('handtekening');
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
    $('wisHandtekening').addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lengte = 0;
    });
    window.addEventListener('resize', function () {
      if (!$('formulier').hidden && stap === 3) pasAan();
    });
    return {
      pasAan: pasAan,
      getekend: function () { return lengte > 80; },
      dataUrl: function () { return canvas.toDataURL('image/png'); }
    };
  })();

  // ---------- Navigatie ----------
  $('terug').addEventListener('click', function () { if (stap > 0) toonStap(stap - 1); });

  $('formulier').addEventListener('submit', function (e) {
    e.preventDefault();
    if (bezig) return;
    var fouten = foutenVanStap(stap);
    toonFouten(fouten, stap);
    if (Object.keys(fouten).length) { focusEersteFout(fouten); return; }
    if (stap < 3) { toonStap(stap + 1); return; }
    verstuur();
  });

  function verstuur() {
    // Laatste controle over alle stappen samen.
    for (var n = 0; n < 4; n++) {
      var f = foutenVanStap(n);
      if (Object.keys(f).length) { toonStap(n); toonFouten(f, n); focusEersteFout(f); return; }
    }
    bezig = true;
    var verzoek = {
      actie: 'intake_verstuur',
      gegevens: gegevens(),
      fotos: { voor: fotos.voor, achter: achterkantNodig(keuzes.id_soort) ? fotos.achter : '' },
      handtekening: handtekening.dataUrl()
    };
    toonLaden('Je gegevens worden verstuurd. Dit kan een halve minuut duren…');
    api(verzoek).then(function (r) {
      bezig = false;
      if (r.status === 'fouten') {
        var eerste = Math.min.apply(null, Object.keys(r.fouten).map(stapVan).filter(function (s) { return s >= 0; }));
        toonStap(isFinite(eerste) ? eerste : 0);
        toonFouten(r.fouten, null);
        focusEersteFout(r.fouten);
        return;
      }
      gewijzigd = false;
      toonMelding(r.status === 'klaar' ? 'klaar' : r.status, r.voornaam);
    }).catch(function () {
      bezig = false;
      toonStap(3);
      toonFouten({ akkoord: 'Versturen lukte niet. Controleer je internet en probeer het opnieuw.' }, 3);
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (gewijzigd && !bezig) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Start ----------
  function start() {
    if (!token) { toonMelding('ongeldig'); return; }
    toonLaden('Even laden…');
    api({ actie: 'intake_start' }).then(function (r) {
      if (r.status !== 'open') { toonMelding(r.status, r.voornaam); return; }
      Array.prototype.forEach.call(document.querySelectorAll('.voornaam'), function (el) { el.textContent = r.voornaam; });
      $('email').textContent = r.email;
      $('startdatum').textContent = r.startdatum;
      $('tekenDatum').textContent = 'Datum: ' + formatDatumNl(new Date());
      toonStap(0);
    }).catch(function () { toonMelding('fout'); });
  }

  function formatDatumNl(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
  }

  start();
})();
