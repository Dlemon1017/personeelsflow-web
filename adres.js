/**
 * Adrescontrole via de PDOK Locatieserver (Kadaster, BAG-adressen; gratis, geen API-sleutel).
 * Gedeeld: server (waarschuwing op de beheerpagina) én beide websites (straat/woonplaats automatisch invullen;
 * gepubliceerd als adres.js). Alleen pure functies; het ophalen zelf doet de aanroeper.
 * Naar PDOK gaan alleen postcode en huisnummer (geen naam of andere gegevens).
 */

var PDOK_ZOEK_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
var BAG_NIET_GEVONDEN = 'Adres niet gevonden in BAG.';
var BAG_AFWIJKING = 'Adres wijkt af van BAG';

/** Zoek-URL voor postcode + huisnummer; '' als die nog niet compleet/geldig zijn. */
function pdokUrl(postcode, huisnummer) {
  var pc = String(postcode || '').replace(/\s+/g, '').toUpperCase();
  var nr = String(huisnummer || '').trim();
  if (!/^[1-9]\d{3}[A-Z]{2}$/.test(pc) || !/^\d{1,5}$/.test(nr)) return '';
  return PDOK_ZOEK_URL + '?q=*&fq=type:adres&fq=postcode:' + pc + '&fq=huisnummer:' + Number(nr) +
    '&fl=straatnaam,woonplaatsnaam,huisletter,huisnummertoevoeging&rows=50';
}

function adresSleutel_(t) {
  return String(t || '').toUpperCase().replace(/[\s\-.]/g, '');
}

/**
 * Vergelijkt de invoer met de PDOK-resultaten (docs uit response.docs).
 * adres: {toevoeging, straat, woonplaats}. Geeft
 * {gevonden: bool (postcode+huisnummer+toevoeging bestaan), nummerBestaat: bool, straat, woonplaats, afwijkend: bool}.
 */
function bagOordeel(docs, adres) {
  docs = docs || [];
  var uit = { gevonden: false, nummerBestaat: docs.length > 0, straat: '', woonplaats: '', afwijkend: false };
  if (!docs.length) return uit;
  var t = adresSleutel_(adres && adres.toevoeging);
  var passend = docs.filter(function (d) { return adresSleutel_((d.huisletter || '') + (d.huisnummertoevoeging || '')) === t; })[0];
  var d = passend || docs[0];
  uit.gevonden = !!passend;
  uit.straat = String(d.straatnaam || '');
  uit.woonplaats = String(d.woonplaatsnaam || '');
  var gelijk = function (a, b) { return String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').toLowerCase(); };
  if (adres && (adres.straat || adres.woonplaats)) {
    uit.afwijkend = !gelijk(adres.straat, uit.straat) || !gelijk(adres.woonplaats, uit.woonplaats);
  }
  return uit;
}

/** Waarschuwing voor de beheerpagina ('' als alles klopt). */
function bagWaarschuwing(oordeel) {
  if (!oordeel.gevonden) return BAG_NIET_GEVONDEN;
  if (oordeel.afwijkend) return BAG_AFWIJKING + ' (BAG: ' + oordeel.straat + ', ' + oordeel.woonplaats + ').';
  return '';
}

/** Haalt eerdere BAG-waarschuwingen uit de waarschuwingen (voor opnieuw controleren). */
function zonderBagWaarschuwing(waarschuwingen) {
  return String(waarschuwingen || '')
    .split(BAG_NIET_GEVONDEN).join('')
    .replace(/Adres wijkt af van BAG \([^)]*\)\./g, '')
    .replace(/\s+/g, ' ').trim();
}
