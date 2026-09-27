/**
 * Validatie van het intakeformulier (bouwdocument sectie 8).
 * Eén bestand voor twee omgevingen: Apps Script (server) en de publieke pagina (web/, gekopieerd bij publiceren).
 * Alleen gewone JavaScript, geen Apps Script-services. Getest in Node (test/validatie.test.js).
 */

/** BSN 11-proef: 9 cijfers, 9×d1 + 8×d2 + … + 2×d8 − 1×d9 deelbaar door 11. */
function bsnGeldig(bsn) {
  var s = String(bsn || '').replace(/\D/g, '');
  if (s.length === 8) s = '0' + s;
  if (!/^\d{9}$/.test(s) || /^0+$/.test(s)) return false;
  var som = 0;
  for (var i = 0; i < 8; i++) som += Number(s[i]) * (9 - i);
  som -= Number(s[8]);
  return som % 11 === 0;
}

function normaliseerIban(iban) {
  return String(iban || '').replace(/[\s.-]/g, '').toUpperCase();
}

/** IBAN mod-97; NL-nummers moeten 18 tekens zijn. */
function ibanGeldig(iban) {
  var s = normaliseerIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.slice(0, 2) === 'NL' && !/^NL\d{2}[A-Z]{4}\d{10}$/.test(s)) return false;
  var r = s.slice(4) + s.slice(0, 4);
  var rest = 0;
  for (var i = 0; i < r.length; i++) {
    var c = r.charCodeAt(i);
    var d = c >= 65 ? String(c - 55) : r[i];
    for (var j = 0; j < d.length; j++) rest = (rest * 10 + Number(d[j])) % 97;
  }
  return rest === 1;
}

/** BIC van Nederlandse banken, op bankcode in de IBAN. Onbekend → ''. */
var BIC_NL = {
  ABNA: 'ABNANL2A', ADYB: 'ADYBNL2A', ASNB: 'ASNBNL21', BITS: 'BITSNL2A', BUNQ: 'BUNQNL2A', DEUT: 'DEUTNL2A',
  FVLB: 'FVLBNL22', HAND: 'HANDNL2A', INGB: 'INGBNL2A', KNAB: 'KNABNL2H', NNBA: 'NNBANL2G', NTSB: 'NTSBDEB1',
  RABO: 'RABONL2U', RBRB: 'RBRBNL21', REVO: 'REVOLT21', SNSB: 'SNSBNL2A', TRIO: 'TRIONL2U', FRBK: 'FRBKNL2L'
};

function bicUitIban(iban) {
  var s = normaliseerIban(iban);
  if (s.slice(0, 2) !== 'NL') return '';
  return BIC_NL[s.slice(4, 8)] || '';
}

/** "1234ab" → "1234 AB"; ongeldig → ''. */
function normaliseerPostcode(pc) {
  var m = /^([1-9]\d{3})\s?([A-Za-z]{2})$/.exec(String(pc || '').trim());
  if (!m) return '';
  var letters = m[2].toUpperCase();
  if (['SA', 'SD', 'SS'].indexOf(letters) !== -1) return '';
  return m[1] + ' ' + letters;
}

/** Telefoonnummer: 06-nummer of internationaal; geeft opgeschoond nummer of ''. */
function normaliseerTelefoon(tel) {
  var s = String(tel || '').replace(/[\s().-]/g, '');
  if (/^\+\d{9,15}$/.test(s)) return s;
  if (/^00\d{9,15}$/.test(s)) return '+' + s.slice(2);
  if (/^0\d{9}$/.test(s)) return s;
  return '';
}

/** "dd-mm-jjjj" of "jjjj-mm-dd" (date-input) → Date; ongeldig → null. */
function leesDatumInvoer(tekst) {
  var t = String(tekst || '').trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  var d, mnd, j;
  if (m) { j = +m[1]; mnd = +m[2]; d = +m[3]; } else {
    m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t);
    if (!m) return null;
    d = +m[1]; mnd = +m[2]; j = +m[3];
  }
  var dt = new Date(j, mnd - 1, d);
  return dt.getFullYear() === j && dt.getMonth() === mnd - 1 && dt.getDate() === d ? dt : null;
}

function leeftijdOpDatum(geb, datum) {
  var l = datum.getFullYear() - geb.getFullYear();
  if (datum.getMonth() < geb.getMonth() || (datum.getMonth() === geb.getMonth() && datum.getDate() < geb.getDate())) l--;
  return l;
}

var INTAKE_KEUZES = {
  geslacht: ['man', 'vrouw', 'anders'],
  id_soort: ['paspoort', 'id-kaart', 'verblijfsdocument'],
  ja_nee: ['ja', 'nee']
};

/** Velden per stap; gebruikt door de pagina (per scherm valideren) en de server (alles). */
var INTAKE_STAPPEN = [
  ['roepnaam', 'voornamen', 'tussenvoegsel', 'achternaam', 'geslacht', 'geboortedatum', 'leeftijd_bevestigd', 'geboorteplaats',
    'geboorteland', 'nationaliteit'],
  ['straat', 'huisnummer', 'toevoeging', 'postcode', 'woonplaats', 'mobiel', 'noodcontact_naam', 'noodcontact_relatie', 'noodcontact_telefoon'],
  ['bsn', 'iban', 'id_soort'],
  ['loonheffingskorting', 'alleenstaande_ouderenkorting', 'akkoord']
];

/**
 * Valideert (een deel van) het intakeformulier.
 * g: {veld: tekst}; stap: 0–3 of null voor alles; vandaag: Date.
 * Geeft {fouten: {veld: melding}, schoon: {veld: waarde}}.
 */
function valideerIntake(g, stap, vandaag) {
  var velden = stap == null ? [].concat.apply([], INTAKE_STAPPEN) : INTAKE_STAPPEN[stap];
  var fouten = {};
  var schoon = {};
  function tekst(v) { return String(g[v] == null ? '' : g[v]).replace(/\s+/g, ' ').trim(); }
  function verplicht(v, melding) {
    var t = tekst(v);
    if (!t) fouten[v] = melding || 'Dit veld is verplicht.';
    return t;
  }
  var geb = leesDatumInvoer(g.geboortedatum);
  var minderjarig = geb ? leeftijdOpDatum(geb, vandaag) < 18 : false;

  velden.forEach(function (v) {
    var t;
    switch (v) {
      case 'tussenvoegsel':
      case 'toevoeging':
        schoon[v] = tekst(v);
        break;
      case 'roepnaam':
      case 'voornamen':
      case 'achternaam':
      case 'geboorteplaats':
      case 'geboorteland':
      case 'nationaliteit':
      case 'straat':
      case 'woonplaats':
        schoon[v] = verplicht(v);
        break;
      case 'geslacht':
        t = tekst(v).toLowerCase();
        if (INTAKE_KEUZES.geslacht.indexOf(t) === -1) fouten[v] = 'Maak een keuze.';
        schoon[v] = t;
        break;
      case 'geboortedatum':
        if (!geb) fouten[v] = 'Vul een geldige datum in.';
        else if (leeftijdOpDatum(geb, vandaag) < 13 || leeftijdOpDatum(geb, vandaag) > 100) fouten[v] = 'Klopt deze geboortedatum?';
        schoon[v] = geb;
        break;
      case 'huisnummer':
        t = tekst(v);
        if (!/^\d{1,5}$/.test(t)) fouten[v] = 'Alleen het nummer, bijv. 12.';
        schoon[v] = t;
        break;
      case 'postcode':
        t = normaliseerPostcode(g[v]);
        if (!t) fouten[v] = 'Vul je postcode in als 1234 AB.';
        schoon[v] = t;
        break;
      case 'mobiel':
        t = normaliseerTelefoon(g[v]);
        if (!t) fouten[v] = 'Vul een geldig mobiel nummer in, bijv. 0612345678.';
        schoon[v] = t;
        break;
      case 'noodcontact_naam':
      case 'noodcontact_relatie':
        t = tekst(v);
        if (!t && minderjarig) fouten[v] = 'Verplicht omdat je jonger bent dan 18.';
        schoon[v] = t;
        break;
      case 'noodcontact_telefoon':
        t = tekst(v);
        if (t) {
          t = normaliseerTelefoon(t);
          if (!t) fouten[v] = 'Vul een geldig telefoonnummer in.';
        } else if (minderjarig) {
          fouten[v] = 'Verplicht omdat je jonger bent dan 18.';
        }
        schoon[v] = t;
        break;
      case 'bsn':
        t = String(g[v] || '').replace(/\D/g, '');
        if (t.length === 8) t = '0' + t;
        if (!bsnGeldig(t)) fouten[v] = 'Dit BSN klopt niet. Controleer de 9 cijfers.';
        schoon[v] = t;
        break;
      case 'iban':
        t = normaliseerIban(g[v]);
        if (!ibanGeldig(t)) fouten[v] = 'Dit IBAN klopt niet. Controleer het nummer.';
        schoon[v] = t;
        schoon.bic = bicUitIban(t);
        break;
      case 'id_soort':
        t = tekst(v).toLowerCase();
        if (INTAKE_KEUZES.id_soort.indexOf(t) === -1) fouten[v] = 'Kies paspoort, ID-kaart of verblijfsdocument.';
        schoon[v] = t;
        break;
      case 'loonheffingskorting':
      case 'alleenstaande_ouderenkorting':
        t = tekst(v).toLowerCase();
        if (INTAKE_KEUZES.ja_nee.indexOf(t) === -1) fouten[v] = 'Kies ja of nee.';
        schoon[v] = t;
        break;
      case 'leeftijd_bevestigd':
        // Vangnet: de medewerker bevestigt de leeftijd op de startdatum die uit de geboortedatum volgt.
        if (geb && g.leeftijd_bevestigd !== true) fouten[v] = 'Vink aan dat je leeftijd klopt, of pas je geboortedatum aan.';
        break;
      case 'akkoord':
        if (g.akkoord !== true && g.akkoord !== 'ja') fouten[v] = 'Vink aan dat je gegevens kloppen.';
        break;
    }
  });
  return { fouten: fouten, schoon: schoon };
}

/** Moet er een foto van de achterkant bij? Een paspoort heeft alleen een gegevenspagina. */
function achterkantNodig(idSoort) {
  return idSoort !== 'paspoort';
}
