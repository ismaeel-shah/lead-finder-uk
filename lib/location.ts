import { mentionsLocation, normaliseCompanyName, type AddressLike } from "@/lib/matching";

/**
 * Is a search result (a Facebook page, usually) in the UK?
 *
 * Search results carry no structured address, but Facebook titles often end
 * in the page's town ("Acme Plumbing | Bristol", "Rise Tennis | Franklin TN")
 * and snippets mention towns, countries, phone numbers and websites. Seen on
 * live data: same-named pages in the US, Peru, India, Brazil and Jamaica were
 * being matched to new UK companies.
 */

export type LocationVerdict = { kind: "uk"; reason: string } | { kind: "foreign"; reason: string } | { kind: "unknown" };

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const words = (s: string) => ` ${fold(s).replace(/[^a-z0-9]+/g, " ").trim()} `;

// --- UK signals ------------------------------------------------------------

const UK_WORDS = ["uk", "united kingdom", "england", "scotland", "wales", "northern ireland", "great britain", "britain", "british"];

/**
 * UK towns and cities. Names shared with big places abroad (Perth, Boston,
 * Newcastle alone, Washington...) are left out; others (Birmingham, Manchester)
 * stay because a foreign signal such as "Birmingham, AL" is checked first.
 */
const UK_PLACES_ALL = [
  "london", "birmingham", "manchester", "liverpool", "leeds", "sheffield", "bristol", "bradford", "nottingham", "leicester",
  "coventry", "hull", "kingston upon hull", "stoke on trent", "wolverhampton", "derby", "southampton", "portsmouth", "plymouth",
  "reading", "luton", "milton keynes", "northampton", "norwich", "swindon", "bournemouth", "brighton", "brighton and hove",
  "oxford", "cambridge", "peterborough", "ipswich", "colchester", "chelmsford", "southend on sea", "basildon", "slough",
  "watford", "st albans", "crawley", "guildford", "woking", "maidstone", "canterbury", "gillingham", "chatham", "dartford",
  "croydon", "bromley", "harrow", "ilford", "romford", "enfield", "wembley", "hounslow", "ealing", "hackney", "camden",
  "islington", "lambeth", "southwark", "westminster", "greenwich", "lewisham", "wandsworth", "barnet", "walthamstow",
  "stratford", "leyton", "tottenham", "exeter", "torquay", "taunton", "gloucester", "cheltenham", "bath", "swansea",
  "cardiff", "newport", "wrexham", "bangor", "aberdeen", "dundee", "edinburgh", "glasgow", "inverness", "stirling", "perth and kinross",
  "paisley", "belfast", "derry", "londonderry", "lisburn", "newry", "newcastle upon tyne", "newcastle under lyme", "gateshead",
  "sunderland", "middlesbrough", "durham", "darlington", "hartlepool", "stockton on tees", "york", "harrogate", "scarborough",
  "doncaster", "rotherham", "barnsley", "wakefield", "huddersfield", "halifax", "preston", "blackpool", "blackburn", "burnley",
  "bolton", "bury", "rochdale", "oldham", "stockport", "salford", "wigan", "warrington", "st helens", "chester", "crewe",
  "macclesfield", "stafford", "telford", "shrewsbury", "worcester", "hereford", "lincoln", "grimsby", "carlisle", "lancaster",
  "southport", "birkenhead", "bedford", "stevenage", "hemel hempstead", "high wycombe", "aylesbury", "basingstoke", "winchester",
  "salisbury", "poole", "weymouth", "eastbourne", "hastings", "worthing", "chichester", "tunbridge wells", "ashford", "folkestone",
  "dover", "margate", "ramsgate", "kettering", "corby", "wellingborough", "mansfield", "chesterfield", "loughborough", "nuneaton",
  "rugby", "solihull", "walsall", "dudley", "west bromwich", "sutton coldfield", "redditch", "kidderminster", "bramhall", "altrincham",
  "burntwood", "lichfield", "tamworth", "cannock", "poynton", "wilmslow", "knutsford", "sale", "stretford", "urmston", "didsbury",
  "newton abbot", "barnstaple", "paignton", "falmouth", "penzance", "st austell", "bodmin", "yeovil", "bridgwater", "weston super mare",
  "stroud", "tewkesbury", "banbury", "bicester", "witney", "abingdon", "didcot", "newbury", "bracknell", "wokingham", "maidenhead",
  "windsor", "staines", "epsom", "reigate", "redhill", "dorking", "horsham", "haywards heath", "east grinstead", "sevenoaks",
  "tonbridge", "gravesend", "sittingbourne", "faversham", "whitstable", "herne bay", "deal", "brentwood", "billericay", "harlow",
  "loughton", "romford", "grays", "thurrock", "braintree", "clacton", "bury st edmunds", "lowestoft", "great yarmouth", "kings lynn",
  "king s lynn", "thetford", "ely", "huntingdon", "st neots", "letchworth", "hitchin", "hertford", "harpenden", "berkhamsted",
  "amersham", "chesham", "beaconsfield", "marlow", "bletchley", "leighton buzzard", "dunstable", "wellingborough", "rushden",
  "market harborough", "hinckley", "coalville", "melton mowbray", "grantham", "newark", "boston lincolnshire", "skegness", "louth",
  "scunthorpe", "goole", "selby", "pontefract", "castleford", "dewsbury", "batley", "keighley", "ilkley", "otley", "skipton",
  "shipley", "pudsey", "morley", "brighouse", "todmorden", "accrington", "rossendale", "rawtenstall", "chorley", "leyland",
  "ormskirk", "skelmersdale", "st annes", "lytham", "fleetwood", "morecambe", "kendal", "barrow in furness", "workington",
  "whitehaven", "penrith", "hexham", "morpeth", "ashington", "blyth", "cramlington", "whitley bay", "south shields", "jarrow",
  "washington tyne and wear", "chester le street", "consett", "stanley", "bishop auckland", "redcar", "guisborough", "thornaby",
  "ruthin", "rhyl", "llandudno", "colwyn bay", "caernarfon", "aberystwyth", "carmarthen", "llanelli", "neath", "port talbot",
  "bridgend", "barry", "caerphilly", "pontypridd", "merthyr tydfil", "ebbw vale", "abergavenny", "monmouth", "chepstow",
  "coleford", "thornbury", "yate", "keynsham", "clevedon", "portishead", "frome", "glastonbury", "wells", "chard", "honiton",
  "kilmarnock", "ayr", "greenock", "motherwell", "hamilton", "east kilbride", "cumbernauld", "livingston", "falkirk", "dunfermline",
  "kirkcaldy", "st andrews", "arbroath", "montrose", "elgin", "fort william", "oban", "dumfries", "galashiels", "peebles",
  "armagh", "omagh", "enniskillen", "coleraine", "ballymena", "antrim", "bangor county down", "craigavon", "portadown",
  // Counties and regions
  "yorkshire", "lancashire", "merseyside", "greater manchester", "west midlands", "east midlands", "kent", "essex", "surrey",
  "sussex", "hampshire", "berkshire", "buckinghamshire", "hertfordshire", "oxfordshire", "cambridgeshire", "norfolk", "suffolk",
  "devon", "cornwall", "somerset", "dorset", "wiltshire", "gloucestershire", "cheshire", "derbyshire", "nottinghamshire",
  "leicestershire", "lincolnshire", "northamptonshire", "staffordshire", "shropshire", "warwickshire", "worcestershire",
  "cumbria", "northumberland", "tyne and wear", "county durham", "teesside", "east anglia", "cotswolds",
];

/** Town names that are also everyday words or first names ("for sale", "best deal", "bath taps", "Barry"). */
const AMBIGUOUS_PLACES = new Set(["hull", "reading", "bath", "rugby", "sale", "deal", "wells", "barry", "stanley", "hamilton", "chard", "halifax"]);
const UK_PLACES = UK_PLACES_ALL.filter((p) => !AMBIGUOUS_PLACES.has(p));

const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/;
const UK_PHONE = /(?:\+44\s?\(?0?\)?\s?|\b0)(?:7\d{3}|1\d{3}|2\d|3\d{2}|8\d{2})[\s-]?\d{3}[\s-]?\d{3,4}\b/;
const UK_DOMAIN = /\b[a-z0-9-]+(?:\.co|\.org|\.ltd|\.me|\.net)?\.uk\b/i;

// --- Foreign signals -------------------------------------------------------

const COUNTRIES = [
  "usa", "u s a", "united states", "canada", "australia", "new zealand", "ireland", "india", "pakistan", "bangladesh",
  "sri lanka", "nepal", "nigeria", "ghana", "kenya", "south africa", "uganda", "tanzania", "egypt", "morocco", "uae",
  // (no "turkey" or "chile": they are also food words)
  "united arab emirates", "dubai", "abu dhabi", "saudi arabia", "qatar", "kuwait", "bahrain", "oman", "turkiye",
  "philippines", "malaysia", "singapore", "indonesia", "thailand", "vietnam", "china", "hong kong", "taiwan", "japan",
  "korea", "brazil", "brasil", "mexico", "argentina", "colombia", "peru", "venezuela", "ecuador", "jamaica",
  "trinidad", "barbados", "spain", "espana", "portugal", "france", "germany", "deutschland", "italy", "italia", "netherlands",
  "belgium", "poland", "polska", "romania", "bulgaria", "greece", "russia", "ukraine", "sweden", "norway", "denmark",
  "finland", "switzerland", "austria", "hungary", "czech republic", "israel", "lebanon", "cyprus", "malta",
  "moldova", "croatia", "serbia", "north macedonia", "macedonia", "bosnia", "albania", "slovenia", "slovakia", "lithuania",
  "latvia", "estonia", "belarus", "armenia", "azerbaijan", "kazakhstan", "uzbekistan", "iran", "iraq", "jordan", "syria",
  "tunisia", "algeria", "ethiopia", "somalia", "zimbabwe", "zambia", "cameroon", "senegal", "rwanda", "sudan", "libya",
  "afghanistan", "myanmar", "cambodia", "mongolia", "bolivia", "paraguay", "uruguay", "cuba", "dominican republic",
  "puerto rico", "haiti", "panama", "costa rica", "guatemala", "honduras", "el salvador", "nicaragua", "iceland",
  "luxembourg", "monaco",
];

const FOREIGN_PLACES = [
  "new york", "los angeles", "chicago", "houston", "phoenix", "philadelphia", "san antonio", "san diego", "dallas", "austin",
  "miami", "atlanta", "seattle", "denver", "detroit", "boise", "las vegas", "toronto", "vancouver", "montreal", "calgary",
  "ottawa", "sydney", "melbourne", "brisbane", "adelaide", "gold coast", "lake macquarie", "auckland", "wellington nz",
  "lagos", "abuja", "accra", "nairobi", "johannesburg", "cape town", "durban", "karachi", "lahore", "islamabad", "rawalpindi",
  "dhaka", "delhi", "new delhi", "mumbai", "bangalore", "bengaluru", "chennai", "hyderabad", "kolkata", "gurgaon", "gurugram",
  "jakarta", "manila", "kuala lumpur", "bangkok", "sao paulo", "rio de janeiro", "lima", "bogota", "buenos aires", "santiago",
  "mexico city", "bucharest", "istanbul", "madrid", "barcelona", "paris", "berlin", "rome", "milan", "amsterdam", "lisbon",
  "warsaw", "dublin", "cork", "black river", "kingston jamaica", "piracicaba", "trenton", "tema", "kumasi", "thane", "pune",
  "kochi", "thrissur", "vadodara", "ahmedabad", "surat", "jaipur", "lucknow", "chandigarh", "istinye", "samal", "cebu",
  "davao", "petaling jaya", "cochabamba", "trois rivieres", "quito", "caracas", "medellin", "guadalajara", "monterrey",
];

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "hawaii",
  "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "west virginia", "wisconsin", "wyoming",
  "ontario", "alberta", "british columbia", "quebec", "new south wales", "queensland",
];

const STATE_CODES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|ON|BC|QC|AB|NS|NB|MB|SK|NSW|QLD|VIC|SP|RJ";
/** "Trenton, NJ" / "Detroit, MI 48201" in running text. */
const CITY_COMMA_STATE = new RegExp(`\\b[A-Z][a-z]+(?:\\s[A-Z][a-z]+)*,\\s?(?:${STATE_CODES})\\b(?![a-z])`);
const US_PHONE = /\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\+1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}/;
const FOREIGN_DOMAIN = /\b[a-z0-9-]+\.(?:com?\.)?(?:mx|br|au|in|pk|ng|za|ph|my|id|nz|ro|es|pt|de|fr|it|nl|pl|ca|ie|ae|sa|tr|co\.za)\b/i;

/**
 * Personal profiles, not business pages: "X is on Facebook. Join Facebook to
 * connect with X…", or the profile layout "Lives in London · Works at…".
 */
const PERSONAL_PROFILE = /\bis on Facebook\b.*\bJoin Facebook to connect\b|\bLives in [A-Z]|\bWorks at [A-Z]|\bProfile photo of\b|\bStudied at [A-Z]|\bWent to [A-Z]/;

function containsPhrase(haystack: string, phrases: readonly string[]): string | null {
  for (const p of phrases) if (haystack.includes(` ${p} `)) return p;
  return null;
}

function stripPhrases(haystack: string, phrases: readonly string[]): string {
  let out = haystack;
  for (const p of phrases) out = out.split(` ${p} `).join(" ");
  return out;
}

/** Scripts a UK business address written by Google never uses. */
const NON_LATIN_SCRIPT = /[Ѐ-ӿ؀-ۿऀ-෿฀-๿ᄀ-ᇿ぀-ヿ㐀-鿿가-힯]/;

/**
 * Is a Google Business address in the UK? Rejects addresses with clear
 * foreign evidence: a country anywhere in it, a US state + ZIP, or a script
 * UK listings never use. (Seen live: "…Zhengzhou, Henan, China, 451285",
 * "17 Retirement Rd, Kingston, Jamaica", "1, Moldova".) Street-only
 * addresses such as "433 Ranglet Rd" (Preston) have no signal either way and
 * are kept, as are listings with no address.
 */
export function isUkBusinessAddress(address: string | null | undefined): boolean {
  const a = address?.trim();
  if (!a) return true;
  if (NON_LATIN_SCRIPT.test(a)) return false;
  return classifyLocation({ title: "", snippet: a }, null, "").kind !== "foreign";
}

/**
 * Should a Facebook result be allowed? Personal profiles and pages located
 * abroad never are. With `requireUk` (a Facebook-only match, no Google
 * listing to back it up) the page must also show UK evidence.
 */
export function facebookLocationAllowed(
  result: { title: string; snippet?: string | null },
  address: AddressLike | null | undefined,
  companyName: string,
  requireUk: boolean,
): boolean {
  if (isPersonalProfile(result.snippet)) return false;
  const verdict = classifyLocation(result, address, companyName);
  if (verdict.kind === "foreign") return false;
  return !requireUk || verdict.kind === "uk";
}

/** The town Facebook appends to page titles: "Acme Plumbing | Bristol" -> "Bristol". */
export function facebookTitleLocation(title: string): string | null {
  const cleaned = title.replace(/\s*[|\-–—•·]?\s*facebook\s*$/i, "").trim();
  const bar = cleaned.lastIndexOf(" | ");
  if (bar < 0) return null;
  const place = cleaned.slice(bar + 3).trim();
  return place && place.length <= 40 && !/^home$/i.test(place) ? place : null;
}

export function isPersonalProfile(snippet: string | null | undefined): boolean {
  return !!snippet && PERSONAL_PROFILE.test(snippet);
}

/**
 * Classifies a result as UK, foreign or unknown, in three tiers:
 *  1. strong foreign signals (page town abroad, "Trenton, NJ", a +1 phone,
 *     a foreign website) win over anything else;
 *  2. UK signals (registered office town/postcode, any UK postcode, UK phone,
 *     .uk website, "UK"/"England", a UK town or county);
 *  3. weak foreign signals (a country or foreign city named in the text) are
 *     weak because a UK restaurant may say "authentic food from Italy".
 * Words in the company's own name are ignored ("Paris Nails Ltd").
 */
export function classifyLocation(
  parts: { title: string; snippet?: string | null },
  address: AddressLike | null | undefined,
  companyName: string,
): LocationVerdict {
  const place = facebookTitleLocation(parts.title);
  const raw = `${parts.title} ${parts.snippet ?? ""}`;
  // Remove the company's own name so words in it don't count as places.
  const name = normaliseCompanyName(companyName);
  const text = name ? words(raw).split(` ${name} `).join(" ") : words(raw);
  const placeText = place ? words(place) : "";

  // 1. Strong foreign signals.
  if (place && new RegExp(`\\s(?:${STATE_CODES})$`).test(place)) return { kind: "foreign", reason: `page location "${place}"` };
  if (place && !containsPhrase(placeText, UK_PLACES) && !containsPhrase(placeText, UK_WORDS)) {
    const abroad = containsPhrase(placeText, FOREIGN_PLACES) ?? containsPhrase(placeText, COUNTRIES) ?? containsPhrase(placeText, US_STATES);
    if (abroad) return { kind: "foreign", reason: `page location "${place}"` };
  }
  const cityState = raw.match(CITY_COMMA_STATE);
  if (cityState) return { kind: "foreign", reason: `address "${cityState[0]}"` };
  if (US_PHONE.test(raw)) return { kind: "foreign", reason: "North American phone number" };
  const domain = raw.match(FOREIGN_DOMAIN);
  if (domain && !UK_DOMAIN.test(raw)) return { kind: "foreign", reason: `website ${domain[0]}` };

  // 2. UK signals. Foreign place names are removed first, so "New York" is
  //    not read as York and "New Hampshire" not as Hampshire.
  const ukText = stripPhrases(text, [...FOREIGN_PLACES, ...US_STATES, "new england", "new south wales"]);
  if (mentionsLocation(raw, address)) return { kind: "uk", reason: "mentions the registered office town or postcode" };
  if (UK_POSTCODE.test(raw)) return { kind: "uk", reason: "UK postcode" };
  if (UK_PHONE.test(raw)) return { kind: "uk", reason: "UK phone number" };
  if (UK_DOMAIN.test(raw)) return { kind: "uk", reason: ".uk website" };
  const ukWord = containsPhrase(ukText, UK_WORDS);
  if (ukWord) return { kind: "uk", reason: `mentions ${ukWord}` };
  const ukPlace = containsPhrase(ukText, UK_PLACES);
  if (ukPlace) return { kind: "uk", reason: `mentions ${ukPlace}` };

  // 3. Weak foreign signals.
  const abroad =
    containsPhrase(text.replace(/ northern ireland /g, " "), COUNTRIES) ?? containsPhrase(text, US_STATES) ?? containsPhrase(text, FOREIGN_PLACES);
  if (abroad) return { kind: "foreign", reason: `mentions ${abroad}` };

  // A page town we don't recognise could be a small UK town: unknown.
  return { kind: "unknown" };
}
