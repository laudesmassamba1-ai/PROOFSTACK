import type { LocaleProfileData } from "@proofcore/contracts";

/**
 * Shipped locale profiles.
 *
 * Eight profiles are provided. This is a documented, extensible starting set — it
 * is *not* national coverage, and every profile lists its own limitations. Facts
 * here were read from maintained sources rather than written from memory:
 *  - phone validity/format: libphonenumber-js metadata (Google libphonenumber data)
 *  - UTC offsets and DST behaviour: the runtime ICU database
 *  - number and date rendering: Intl.NumberFormat / Intl.DateTimeFormat
 *  - collation order: Intl.Collator with sensitivity "variant"
 *
 * Anything derived from a convention that ICU does not expose (week start) is
 * marked in `limitations` instead of presented as verified.
 */

export const PROFILE_VERSION = 1;

export const en_US: LocaleProfileData = {
  id: "en-US",
  version: PROFILE_VERSION,
  language: "en",
  country: "US",
  region: "United States",
  script: "Latin",
  direction: "ltr",
  timeZones: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
  ],
  currency: "USD",
  phoneCountryCode: "+1",
  nationalLeadingZero: false,
  nameOrder: "given-first",
  address: {
    lines: 2,
    order: ["street", "extra", "city", "state", "postal"],
    postalCode: {
      pattern: "^\\d{5}(-\\d{4})?$",
      required: true,
      examples: ["94105", "10001-1234"],
    },
  },
  dateFormats: {
    short: "M/d/yy",
    long: "EEEE, MMMM d, yyyy",
    input: ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD"],
  },
  weekStartsOn: 0,
  collationSamples: [
    { a: "Apple", b: "apple", expected: "gt" },
    { a: "Z", b: "a", expected: "gt" },
  ],
  fixtures: {
    names: ["Avery Smith", "Jordan Lee"],
    difficultNames: [
      "Mary Anne O'Neill-Smith",
      "Zoë",
      "Beyoncé",
      "Anaïs",
      "Łukasz",
      "Cher", // single-name record
      "Johnson Jr.",
      "Ten-character",
      "Christopher Maximilian Alexander Ferdinand Washington",
      "🎃 Festival",
      "Nullius Anni",
      "A".repeat(200),
    ],
    phones: ["+14155550100", "+12125550123", "3125550199", "(415) 555-0100"],
    invalidPhones: ["41555501", "41555501000", "+10000", "abc", "", "1-415-555"],
    addresses: [
      "1 Market St",
      "10001 Northwest Expressway, Building 4, Suite 210",
      "4521 42nd Ave NE",
    ],
    postalCodes: ["94105", "10001-1234", "00501", "99501"],
    amounts: ["1,234.56", "0.10", "-45.00", "1000000.00", "1,234.565"],
    dateSamples: ["01/15/2026", "1/5/2026", "2026-02-29", "12/31/2025", "02/30/2026"],
  },
  limitations: [
    "Only seven of the ~30 US time zones are listed; Indiana and Arizona exceptions are not modelled.",
    "ZIP+4 examples are structural, not deliverable addresses.",
  ],
  notes: "Fictional numbers use the 555-01xx range reserved for examples.",
};

export const en_GB: LocaleProfileData = {
  id: "en-GB",
  version: PROFILE_VERSION,
  language: "en",
  country: "GB",
  region: "United Kingdom",
  script: "Latin",
  direction: "ltr",
  timeZones: ["Europe/London"],
  currency: "GBP",
  phoneCountryCode: "+44",
  nationalLeadingZero: true,
  nameOrder: "given-first",
  address: {
    lines: 3,
    order: ["street", "locality", "town", "postal", "country"],
    postalCode: {
      pattern: "^[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}$",
      required: true,
      examples: ["SW1A 1AA", "EC1A 1BB", "M1 1AE", "B29 6TB", "W1J 7NT"],
    },
  },
  dateFormats: { short: "dd/MM/y", long: "EEEE d MMMM yyyy", input: ["DD/MM/YYYY", "YYYY-MM-DD"] },
  weekStartsOn: 1,
  collationSamples: [
    { a: "Dafydd", b: "Aaron", expected: "gt" },
    { a: "café", b: "cafe", expected: "gt" },
  ],
  fixtures: {
    names: ["Oliver Hughes", "Freya Nkosi"],
    difficultNames: [
      "Anne-Marie O'Grady",
      "Mhairi",
      "Siân",
      "Gwyneth ap Rhys",
      "Llywelyn the Great",
      "Rachael Sarah Jones",
      "St. John",
      "Amaia",
      "Niamh",
      "Wojciech",
      "A".repeat(180),
    ],
    phones: ["+447457123456", "07457 123456", "0117 123 4567", "020 7183 8750"],
    invalidPhones: ["077009001230", "447457123456", "0745 123", "+44000", ""],
    addresses: [
      "10 Downing Street",
      "Flat 2, 15A Church Road",
      "Pen-y-Gentrel Farm, Llanfairpwllgwyngyll",
    ],
    postalCodes: ["SW1A 1AA", "EC1A 1BB", "M1 1AE", "B29 6TB", "NE1 4ST"],
    amounts: ["1,234.56", "£9.99", "-0.01", "1,000,000.00"],
    dateSamples: ["15/01/2026", "1/5/2026", "2026-02-29", "31/04/2026"],
  },
  limitations: [
    "The postcode pattern is a simplification: GIR 0AA and BFPO addresses are outside it.",
    "Ofcom's 07700 900xxx drama range is deliberately excluded because current metadata marks it invalid.",
  ],
  notes: "Ambiguity hazard: 05/03/2026 means 5 March here and 3 May in en-US.",
};

export const fr_FR: LocaleProfileData = {
  id: "fr-FR",
  version: PROFILE_VERSION,
  language: "fr",
  country: "FR",
  region: "France",
  script: "Latin",
  direction: "ltr",
  timeZones: ["Europe/Paris"],
  currency: "EUR",
  phoneCountryCode: "+33",
  nationalLeadingZero: true,
  nameOrder: "given-first",
  address: {
    lines: 4,
    order: ["street", "extra", "postal", "city", "country"],
    postalCode: {
      pattern: "^\\d{5}$",
      required: true,
      examples: ["75001", "13008", "69003", "97400", "01000"],
    },
  },
  dateFormats: {
    short: "dd/MM/yyyy",
    long: "EEEE d MMMM yyyy",
    input: ["DD/MM/YYYY", "YYYY-MM-DD"],
  },
  weekStartsOn: 1,
  collationSamples: [
    { a: "é", b: "e", expected: "gt" },
    { a: "a", b: "é", expected: "lt" },
    { a: "Élodie", b: "Eric", expected: "lt" },
    { a: "cote", b: "côté", expected: "lt" },
  ],
  fixtures: {
    names: ["Camille Durand", "Nassim Benali"],
    difficultNames: [
      "François de L'Estoile",
      "Élodie",
      "Le Goff",
      "Jean-Pierre",
      "Anaïs",
      "Nolwenn",
      "Laure-Marie Chardin",
      "Éric",
      "Zoé",
      "Aimé",
      "Lætitia",
      "Bérangère",
      "A".repeat(160),
    ],
    phones: ["+33612345678", "06 12 34 56 78", "05 01 23 45 67", "01 23 45 67 89"],
    invalidPhones: ["061234567", "3012345678", "+330", "06 12 34", ""],
    addresses: [
      "12 rue de l'Église",
      "Appartement 7, 3 bis boulevard Voltaire",
      "8 allée des Châtaigniers, Résidence Le Coteau",
    ],
    postalCodes: ["75001", "13008", "97400", "01000", "69003"],
    amounts: ["1 234,56", "0,10", "-45,00", "1 000 000,00", "1 234,565"],
    dateSamples: ["15/01/2026", "1/5/2026", "2026-02-29", "30/02/2026"],
  },
  limitations: [
    "Grouping uses U+202F narrow no-break space in current ICU; older data used U+00A0.",
    "Overseas territories (971xx Guadeloupe, 973xx Guyane…) share the metropolitan pattern.",
  ],
  notes: "A product that requires ASCII spaces in amounts will reject its own output.",
};

export const fr_BJ: LocaleProfileData = {
  id: "fr-BJ",
  version: PROFILE_VERSION,
  language: "fr",
  country: "BJ",
  region: "Benin",
  script: "Latin",
  direction: "ltr",
  timeZones: ["Africa/Porto-Novo"],
  currency: "XOF",
  phoneCountryCode: "+229",
  nationalLeadingZero: false,
  nameOrder: "given-first",
  address: {
    lines: 2,
    order: ["district", "city", "landmark"],
    postalCode: { pattern: "", required: false, examples: [] },
  },
  dateFormats: {
    short: "dd/MM/yyyy",
    long: "EEEE d MMMM yyyy",
    input: ["DD/MM/YYYY", "YYYY-MM-DD"],
  },
  weekStartsOn: 1,
  collationSamples: [
    { a: "Aïcha", b: "Aicha", expected: "gt" },
    { a: "Sègla", b: "Segla", expected: "gt" },
  ],
  fixtures: {
    names: ["Kossi Sossou", "Awoh Dossou"],
    difficultNames: [
      "Koffi",
      "Sègla",
      "Aïcha",
      "Adjovi-Kpèssou",
      "Ganiou",
      "Zinsou",
      "Djobossin",
      "Biklè-Koutché",
      "Bintou",
      "Kpèdinhin",
      "A".repeat(140),
    ],
    phones: ["+2290197505050", "01 97 50 50 50", "0123456789", "+229 01 97 50 50 50"],
    invalidPhones: [
      "97505050", // legacy 8-digit plan: current metadata rejects it
      "019750505",
      "96505050",
      "+2299750505",
      "",
    ],
    addresses: [
      "Quartier Zogbadjè, Cotonou",
      "Aguéguès, 06 BP 1526 Cotonou",
      "Pk 4 route de Porto-Novo, immeuble Blechot",
    ],
    postalCodes: [],
    amounts: ["2 500", "2.500", "15 000", "-500", "999 999"],
    dateSamples: ["15/01/2026", "29/02/2026", "31/04/2026", "2026-01-15"],
  },
  limitations: [
    "Benin has no national postal code system: `required=false` is the correct expectation, and an address form that blocks submission for a missing postcode is a defect.",
    "The 2021 numbering plan added a leading 01 to make numbers 10 digits; the legacy 8-digit form is listed as invalid because current metadata says so, not because the number never worked.",
    "XOF has no subunit: amounts with cents are a real-world input error, not a rounding choice.",
  ],
  notes:
    "Mobile money is the dominant payment rail; the FLOW module exercises MTN/Moov pushes for this profile.",
};

export const fr_CG: LocaleProfileData = {
  id: "fr-CG",
  version: PROFILE_VERSION,
  language: "fr",
  country: "CG",
  region: "Republic of the Congo",
  script: "Latin",
  direction: "ltr",
  timeZones: ["Africa/Brazzaville"],
  currency: "XAF",
  phoneCountryCode: "+242",
  nationalLeadingZero: false,
  nameOrder: "given-first",
  address: {
    lines: 2,
    order: ["quarter", "city", "landmark"],
    postalCode: { pattern: "", required: false, examples: [] },
  },
  dateFormats: { short: "dd/MM/yyyy", long: "EEEE d MMMM yyyy", input: ["DD/MM/YYYY"] },
  weekStartsOn: 1,
  collationSamples: [{ a: "N'Gali", b: "Ngali", expected: "gt" }],
  fixtures: {
    names: ["Obamba Makosso", "Tchibinda Okoumba"],
    difficultNames: [
      "N'Gali",
      "Okoumba-Yandji",
      "Banzabanzou",
      "Délphine",
      "Edwige",
      "Pindika",
      "A".repeat(120),
    ],
    phones: ["+242061234567", "06 123 4567", "05 512 3456", "05 123 4567"],
    invalidPhones: ["021234567", "06123456", "11002233", ""],
    addresses: [
      "Poto-Poto, Avenue Monseigneur Ngalani",
      "Makélékélé, 12 rue de l'École",
      "Ouenzé, derrière le marché Total",
    ],
    postalCodes: [],
    amounts: ["65 000", "15 500", "-1 000", "1 000 000"],
    dateSamples: ["15/01/2026", "29/02/2028", "31/02/2026"],
  },
  limitations: [
    "No national postal code system.",
    "XAF has no subunit; the same 0-exponent rule as XOF applies.",
    "Phone validity is checked against current metadata; 8-digit forms are rejected there.",
  ],
  notes:
    "Distinct from the DRC (CD): same currency family, different numbering plan and country code.",
};

export const ar_EG: LocaleProfileData = {
  id: "ar-EG",
  version: PROFILE_VERSION,
  language: "ar",
  country: "EG",
  region: "Egypt",
  script: "Arabic",
  direction: "rtl",
  timeZones: ["Africa/Cairo"],
  currency: "EGP",
  phoneCountryCode: "+20",
  nationalLeadingZero: true,
  nameOrder: "given-first",
  address: {
    lines: 3,
    order: ["street", "district", "city", "postal"],
    postalCode: { pattern: "^\\d{5,6}$", required: false, examples: ["11511", "12311", "42519"] },
  },
  dateFormats: {
    short: "dd/MM/yyyy",
    long: "EEEE، d MMMM yyyy",
    input: ["DD/MM/YYYY", "YYYY/M/D"],
  },
  weekStartsOn: 6,
  collationSamples: [
    { a: "أ", b: "ا", expected: "lt" },
    { a: "ة", b: "ه", expected: "lt" },
  ],
  fixtures: {
    names: ["محمود عبد الله", "سارة إبراهيم"],
    difficultNames: [
      "عبد الرحمن",
      "الشيخ",
      "مصطفى",
      "أسماء",
      "نورهان",
      "عمرو",
      "محمد محمود محمد",
      "مريم عبد الله السيد",
      "Amina محمود",
      "١٢٣",
      "A".repeat(150),
    ],
    phones: ["+201011234567", "010 11234567", "015 51234567", "02 21234567"],
    invalidPhones: ["0100123456", "10012345", "+200", ""],
    addresses: [
      "12 شارع طلعت حرب، وسط البلد",
      "عمارة 4، شارع الجمهورية، شبرا",
      "١٢ شارع الحرية، المعادي",
    ],
    postalCodes: ["11511", "12311", "42519", ""],
    amounts: ["١٬٢٣٤٫٥٦", "1,234.56", "-45.00", "1000000"],
    dateSamples: ["15/01/2026", "١٥/٠١/٢٠٢٦", "2026/2/29", "30/02/2026"],
  },
  limitations: [
    "Arabic-Indic digits (٠-٩) and the U+066C/U+066B separators are what ICU renders; many products only parse ASCII digits.",
    "Egypt reintroduced DST in 2023: offsets verified as +02:00 in January and +03:00 in July for 2026.",
    "Postal codes exist but are frequently absent in delivery addresses, hence required=false.",
  ],
  notes:
    "Base direction is RTL; a form that left-aligns and truncates the last name visually corrupts it.",
};

export const ja_JP: LocaleProfileData = {
  id: "ja-JP",
  version: PROFILE_VERSION,
  language: "ja",
  country: "JP",
  region: "Japan",
  script: "Han",
  direction: "ltr",
  timeZones: ["Asia/Tokyo"],
  currency: "JPY",
  phoneCountryCode: "+81",
  nationalLeadingZero: true,
  nameOrder: "family-first",
  address: {
    lines: 4,
    order: ["postal", "prefecture", "city", "ward", "street", "building"],
    postalCode: {
      pattern: "^\\d{3}-?\\d{4}$",
      required: true,
      examples: ["100-0001", "150-0043", "8120012"],
    },
  },
  dateFormats: {
    short: "y/MM/dd",
    long: "yyyy年M月d日",
    input: ["YYYY/MM/DD", "YYYY-MM-DD", "YYYY年M月D日"],
  },
  weekStartsOn: 0,
  collationSamples: [
    { a: "あ", b: "い", expected: "lt" },
    { a: "ｱ", b: "あ", expected: "eq" },
  ],
  fixtures: {
    names: ["田中太郎", "山本周"],
    difficultNames: [
      "髙橋", // 髙 compatibility kanji, not equal to 高 under NFC
      "﨑", // CJK compatibility ideograph, not folded to 奇 by NFC
      "佐藤𐂂",
      "中嶋 弘",
      "澤田",
      "渡辺",
      "D.B.エマニエル",
      "A".repeat(120),
      "１２３", // full-width digits
    ],
    phones: ["+819077456789", "090-7745-6789", "03-1234-5678", "011-234-5678", "+81312345678"],
    invalidPhones: ["901234567", "0901234567", "031234", ""],
    addresses: [
      "東京都千代田区千代田1-1",
      "大阪府大阪市北区梅田 3-1-1 梅田スカイビル",
      "北海道札幌市中央区北1条西2丁目",
    ],
    postalCodes: ["100-0001", "150-0043", "8120012", "900-0001"],
    amounts: ["1,234", "1234567890", "-100", "0"],
    dateSamples: ["2026/01/15", "2026-01-15", "2026年1月15日", "2026-02-30", "令和8年1月15日"],
  },
  limitations: [
    "Names are commonly written family-first; a form labelled First/Last without guidance reverses them.",
    "Reiwa era dates (令和) are used on paper and in some UIs; ISO parsing rejects them.",
    "Direction is recorded as ltr because modern software renders Japanese left-to-right, though traditional vertical writing runs right-to-left.",
    "Full-width digits and kana are folded by NFKC, not by NFC.",
  ],
  notes: "JPY has no subunit: 0.5 JPY is not a representable amount.",
};

export const pt_BR: LocaleProfileData = {
  id: "pt-BR",
  version: PROFILE_VERSION,
  language: "pt",
  country: "BR",
  region: "Brazil",
  script: "Latin",
  direction: "ltr",
  timeZones: [
    "America/Sao_Paulo",
    "America/Manaus",
    "America/Belem",
    "America/Porto_Velho",
    "America/Recife",
    "America/Porto_Velho",
  ],
  currency: "BRL",
  phoneCountryCode: "+55",
  nationalLeadingZero: true,
  nameOrder: "given-first",
  address: {
    lines: 3,
    order: ["street", "extra", "postal", "city", "state"],
    postalCode: {
      pattern: "^\\d{5}-?\\d{3}$",
      required: true,
      examples: ["01310-100", "20040-020", "70040-010"],
    },
  },
  dateFormats: {
    short: "dd/MM/yyyy",
    long: "EEEE, d de MMMM de yyyy",
    input: ["DD/MM/YYYY", "YYYY-MM-DD"],
  },
  weekStartsOn: 0,
  collationSamples: [
    { a: "a", b: "á", expected: "lt" },
    { a: "São", b: "Sao", expected: "gt" },
  ],
  fixtures: {
    names: ["Ana Silva", "Bruno Costa"],
    difficultNames: [
      "José",
      "Ana Beatriz da Silva Souza",
      "Nascimento",
      "Coração",
      "Çaçá",
      "Rê",
      "Maria das Dores dos Santos Oliveira",
      "D'Angelo",
      "Ayrton Senna do Brasil",
      "🎉",
      "A".repeat(150),
    ],
    phones: ["+5511998765432", "(11) 99876-5432", "(11) 3555-1234", "+5521987654321"],
    invalidPhones: ["1199876543", "0119987654321", "11 99876", ""],
    addresses: [
      "Avenida Paulista, 1000, 12º andar",
      "Rua dos Andradas, 878, sala 305",
      "Travessa da Paz, s/n",
    ],
    postalCodes: ["01310-100", "20040-020", "70040010", "99999-999"],
    amounts: ["1.234,56", "0,10", "-45,00", "1.000.000,00", "1.234,565"],
    dateSamples: ["15/01/2026", "29/02/2028", "30/02/2026", "2026-01-15"],
  },
  limitations: [
    "Brazil abolished DST in 2019: America/Sao_Paulo is UTC-03:00 all year in current ICU data.",
    "Five time zones exist; only the main ones are listed.",
  ],
  notes:
    "The 12º ordinal marker and 's/n' (sem número) are legitimate address text that ASCII-only validators break.",
};

export const PROFILES: LocaleProfileData[] = [
  en_US,
  en_GB,
  fr_FR,
  fr_BJ,
  fr_CG,
  ar_EG,
  ja_JP,
  pt_BR,
];
