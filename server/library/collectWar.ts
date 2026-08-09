import { getSearchApiKey } from "../config.js";
import { r2GetJson, r2PutJson, r2PutObject } from "./r2.js";
import type {
  LibraryAsset,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "./types.js";
import { slugify } from "./types.js";

const BAD_HOSTS = [
  "gettyimages",
  "alamy",
  "shutterstock",
  "istockphoto",
  "dreamstime",
  "depositphotos",
  "123rf",
  "adobe.stock",
  "ytimg.com",
  "fbsbx",
  "lookaside",
];

const BAD_TITLE = [
  "meme",
  "thumbnail",
  "clickbait",
  "watermark",
  "stock photo",
  "cartoon",
  "ai generated",
  "video game",
  "call of duty",
  "war thunder",
];

interface GoogleImageItem {
  title?: string;
  original?: { link?: string; width?: number; height?: number };
  source?: { name?: string; link?: string };
}

export type WarTopic = {
  group: string;
  topic: string;
  /** Classification tags stored on assets */
  tags: string[];
  /** Exactly 10 unique search queries */
  queries: string[];
};

type WarSeed = {
  group: string;
  topic: string;
  tags: string[];
  /** Core subject phrases used to expand into 10 unique Google queries */
  cores: string[];
};

const QUERY_TAILS = [
  "archival photo landscape",
  "documentary photograph horizontal",
  "military photo wide",
  "news photo landscape",
  "official photo horizontal",
  "action photograph landscape",
  "deployment photo wide",
  "training exercise photo landscape",
  "combat documentary image horizontal",
  "war documentary still landscape",
] as const;

/**
 * Seeds derived from viral war-channel title patterns:
 * Iran / US Navy / Israel / China / Ukraine / Houthis / jets / ships / drones / weapons.
 * Expanded to exactly 100 topics × 10 queries = 1000 SearchAPI calls.
 */
const WAR_SEEDS: WarSeed[] = [
  // —— US Navy & Ships ——
  {
    group: "US Navy & Ships",
    topic: "US Navy destroyer",
    tags: ["us-navy", "destroyer", "ship"],
    cores: [
      "US Navy Arleigh Burke destroyer",
      "US Navy destroyer at sea",
      "USS destroyer underway Pacific",
      "US Navy destroyer formation",
      "guided missile destroyer US Navy",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy aircraft carrier",
    tags: ["us-navy", "carrier", "ship"],
    cores: [
      "US Navy aircraft carrier flight deck",
      "USS Gerald Ford aircraft carrier",
      "US Navy carrier strike group",
      "aircraft carrier underway Pacific",
      "carrier jet launch US Navy",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy cruiser",
    tags: ["us-navy", "cruiser", "ship"],
    cores: [
      "US Navy Ticonderoga cruiser",
      "Aegis cruiser US Navy",
      "guided missile cruiser at sea",
      "US Navy cruiser underway",
      "US Navy cruiser Red Sea",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy amphibious ship",
    tags: ["us-navy", "amphibious", "ship"],
    cores: [
      "US Navy amphibious assault ship",
      "USS America amphibious ship",
      "US Marines amphibious landing ship",
      "LHD amphibious ship US Navy",
      "US Navy Wasp class ship",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy littoral combat ship",
    tags: ["us-navy", "lcs", "ship"],
    cores: [
      "US Navy littoral combat ship",
      "LCS Freedom class US Navy",
      "Independence class LCS",
      "US Navy combat ship underway",
      "littoral combat ship deployment",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy Red Sea operations",
    tags: ["us-navy", "red-sea", "operations"],
    cores: [
      "US Navy Red Sea destroyer",
      "US Navy warship Red Sea",
      "US Navy Bab el Mandeb patrol",
      "US Navy Red Sea air defense",
      "US Navy ship Gulf of Aden",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy missile defense",
    tags: ["us-navy", "missile-defense", "aegis"],
    cores: [
      "US Navy SM-2 missile launch",
      "US Navy Aegis missile defense",
      "destroyer missile launch at sea",
      "US Navy intercept missile photo",
      "shipborne air defense US Navy",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy boarding team",
    tags: ["us-navy", "boarding", "special-ops"],
    cores: [
      "US Navy VBSS boarding team",
      "US sailors board vessel",
      "US Navy visit board search seizure",
      "US Navy maritime interdiction",
      "US Navy boarding pirate vessel",
    ],
  },

  // —— US Air Force & Jets ——
  {
    group: "US Air Force & Jets",
    topic: "F-35 Lightning II",
    tags: ["usaf", "fighter-jet", "f-35"],
    cores: [
      "F-35 Lightning II fighter jet",
      "F-35C carrier landing",
      "F-35A US Air Force flight",
      "F-35 strike mission photo",
      "F-35 stealth fighter takeoff",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "F-15 Eagle",
    tags: ["usaf", "fighter-jet", "f-15"],
    cores: [
      "F-15 Eagle fighter jet",
      "F-15E Strike Eagle combat",
      "F-15 fighter takeoff afterburner",
      "US Air Force F-15 formation",
      "F-15 air superiority fighter",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "F/A-18 Hornet",
    tags: ["us-navy", "fighter-jet", "fa-18"],
    cores: [
      "F/A-18 Hornet carrier launch",
      "F/A-18 Super Hornet flight",
      "US Navy F-18 fighter jet",
      "Hornet fighter bombing run",
      "F/A-18 strike aircraft photo",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "A-10 Warthog",
    tags: ["usaf", "attack-aircraft", "a-10"],
    cores: [
      "A-10 Warthog GAU-8 firing",
      "A-10 Thunderbolt II combat",
      "A-10 Warthog low pass",
      "US Air Force A-10 attack",
      "A-10 close air support photo",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "B-2 Spirit bomber",
    tags: ["usaf", "bomber", "b-2", "stealth"],
    cores: [
      "B-2 Spirit stealth bomber",
      "B-2 bomber takeoff night",
      "US Air Force B-2 Spirit flight",
      "B-2 bomber formation photo",
      "ghost bomber B-2 Spirit",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "B-52 Stratofortress",
    tags: ["usaf", "bomber", "b-52"],
    cores: [
      "B-52 Stratofortress bomber",
      "B-52 bomber takeoff",
      "US Air Force B-52 flight",
      "B-52 strategic bomber photo",
      "B-52 bomb bay aircraft",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "US Air Force tanker and AWACS",
    tags: ["usaf", "support-aircraft"],
    cores: [
      "KC-135 aerial refueling",
      "US Air Force AWACS E-3 Sentry",
      "fighter jet aerial refueling",
      "US tanker aircraft boom refuel",
      "E-3 Sentry AWACS flight",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "US military helicopter",
    tags: ["us-military", "helicopter"],
    cores: [
      "US Army Apache helicopter",
      "US Navy Seahawk helicopter",
      "US Marine Corps Osprey flight",
      "Black Hawk helicopter combat",
      "US helicopter door gunner",
    ],
  },

  // —— Coast Guard & Cartels ——
  {
    group: "Coast Guard & Cartels",
    topic: "US Coast Guard cutter",
    tags: ["coast-guard", "ship", "interdiction"],
    cores: [
      "US Coast Guard cutter at sea",
      "Coast Guard patrol boat chase",
      "USCG cutter interdiction",
      "Coast Guard boarding team",
      "US Coast Guard helicopter rescue",
    ],
  },
  {
    group: "Coast Guard & Cartels",
    topic: "Cartel boat interdiction",
    tags: ["coast-guard", "cartel", "boat"],
    cores: [
      "Coast Guard cartel go-fast boat",
      "drug boat interdiction Caribbean",
      "Coast Guard seize cartel boat",
      "narcotics smuggling boat seizure",
      "USCG stop go-fast boat",
    ],
  },
  {
    group: "Coast Guard & Cartels",
    topic: "Cartel submarine",
    tags: ["coast-guard", "cartel", "submarine"],
    cores: [
      "narco submarine seized Coast Guard",
      "drug smuggling semi-submersible",
      "cartel submarine interdiction",
      "narco sub Pacific seizure",
      "Coast Guard cartel submarine photo",
    ],
  },

  // —— China Military ——
  {
    group: "China Military",
    topic: "PLA Navy ship",
    tags: ["china", "navy", "ship"],
    cores: [
      "PLA Navy destroyer Type 052D",
      "Chinese Navy aircraft carrier",
      "PLA Navy warship South China Sea",
      "Chinese Type 055 destroyer",
      "PLA Navy frigate underway",
    ],
  },
  {
    group: "China Military",
    topic: "Chinese fighter jet",
    tags: ["china", "fighter-jet", "plaaf"],
    cores: [
      "Chinese J-20 stealth fighter",
      "PLA Air Force J-16 fighter",
      "Chinese J-10 fighter jet",
      "PLA fighter jet intercept",
      "Chinese fighter flyby photo",
    ],
  },
  {
    group: "China Military",
    topic: "China US intercept",
    tags: ["china", "us-navy", "intercept"],
    cores: [
      "Chinese jet intercept US Navy",
      "PLA fighter buzz US aircraft",
      "China challenge US Navy ship",
      "Chinese warship near US destroyer",
      "unsafe intercept South China Sea",
    ],
  },
  {
    group: "China Military",
    topic: "Chinese helicopter and drones",
    tags: ["china", "helicopter", "drone"],
    cores: [
      "PLA Navy helicopter flight",
      "Chinese military drone UAV",
      "PLA Z-20 helicopter",
      "China naval helicopter deck",
      "Chinese reconnaissance drone",
    ],
  },
  {
    group: "China Military",
    topic: "South China Sea militarization",
    tags: ["china", "south-china-sea", "bases"],
    cores: [
      "South China Sea artificial island",
      "Chinese military base Spratly",
      "PLA radar installation South China Sea",
      "Chinese coast guard ship SCS",
      "militarized reef South China Sea",
    ],
  },

  // —— Iran Military ——
  {
    group: "Iran Military",
    topic: "Iranian Navy ship",
    tags: ["iran", "navy", "ship"],
    cores: [
      "Iranian Navy warship Strait of Hormuz",
      "IRGC Navy fast attack craft",
      "Iranian frigate at sea",
      "Iran Navy patrol boat Persian Gulf",
      "IRGC speedboats swarm photo",
    ],
  },
  {
    group: "Iran Military",
    topic: "Iranian fighter jet",
    tags: ["iran", "fighter-jet", "air-force"],
    cores: [
      "Iranian Air Force F-14 Tomcat",
      "Iran MiG-29 fighter jet",
      "Iranian fighter jet flyover",
      "IRIAF F-4 Phantom fighter",
      "Iran Air Force combat aircraft",
    ],
  },
  {
    group: "Iran Military",
    topic: "Iranian missiles",
    tags: ["iran", "missile", "ballistic"],
    cores: [
      "Iranian ballistic missile launch",
      "Iran Shahab missile parade",
      "Iranian cruise missile display",
      "IRGC missile launch photo",
      "Iran missile transporter TEL",
    ],
  },
  {
    group: "Iran Military",
    topic: "Iranian drones",
    tags: ["iran", "drone", "uav"],
    cores: [
      "Iranian Shahed drone",
      "IRGC drone launch",
      "Iran military UAV photo",
      "Iranian combat drone display",
      "Shahed-136 drone Iran",
    ],
  },
  {
    group: "Iran Military",
    topic: "Iran air defense",
    tags: ["iran", "air-defense", "missile"],
    cores: [
      "Iran air defense radar system",
      "Iranian S-300 air defense",
      "IRGC air defense missile",
      "Iran SAM launcher photo",
      "Iranian air defense battery",
    ],
  },
  {
    group: "Iran Military",
    topic: "Iran US Navy confrontation",
    tags: ["iran", "us-navy", "confrontation"],
    cores: [
      "Iranian boat approach US Navy",
      "IRGC speedboat US destroyer",
      "Iran challenge US Navy Strait Hormuz",
      "US Navy Iranian helicopter close pass",
      "Iranian drone near US warship",
    ],
  },
  {
    group: "Iran Military",
    topic: "Iran explosion aftermath",
    tags: ["iran", "explosion", "strike"],
    cores: [
      "Iran military base explosion",
      "Iran oil facility fire smoke",
      "Iranian ammunition depot blast",
      "strike damage Iran facility",
      "Iran explosion night satellite",
    ],
  },

  // —— Houthis & Red Sea ——
  {
    group: "Houthis & Red Sea",
    topic: "Houthi missiles and drones",
    tags: ["houthis", "yemen", "missile", "drone"],
    cores: [
      "Houthi missile launch Yemen",
      "Houthi drone attack Red Sea",
      "Houthi ballistic missile photo",
      "Ansar Allah missile launcher",
      "Houthi UAV launch Yemen",
    ],
  },
  {
    group: "Houthis & Red Sea",
    topic: "Houthi Red Sea attacks",
    tags: ["houthis", "red-sea", "shipping"],
    cores: [
      "Houthi attack commercial ship Red Sea",
      "cargo ship under attack Bab el Mandeb",
      "Red Sea shipping Houthi threat",
      "burning cargo ship Red Sea",
      "Houthi anti-ship missile Yemen",
    ],
  },
  {
    group: "Houthis & Red Sea",
    topic: "US strikes on Houthi targets",
    tags: ["houthis", "us-military", "airstrike"],
    cores: [
      "US airstrike Yemen Houthi base",
      "US Navy strike Houthi radar",
      "explosion Houthi military site Yemen",
      "US Tomahawk strike Yemen",
      "Houthi launcher destroyed airstrike",
    ],
  },
  {
    group: "Houthis & Red Sea",
    topic: "Houthi port and bases",
    tags: ["houthis", "yemen", "port", "base"],
    cores: [
      "Hodeidah port Yemen",
      "Houthi military base Yemen",
      "Yemen coastal radar site",
      "Houthi weapons depot Yemen",
      "Sanaa military facility Yemen",
    ],
  },

  // —— Ukraine Conflict ——
  {
    group: "Ukraine Conflict",
    topic: "Ukrainian FPV drones",
    tags: ["ukraine", "drone", "fpv"],
    cores: [
      "Ukrainian FPV drone strike",
      "Ukraine first person drone attack",
      "Ukrainian quadcopter combat drone",
      "Ukraine drone operators trench",
      "FPV drone explosion Ukraine war",
    ],
  },
  {
    group: "Ukraine Conflict",
    topic: "Ukrainian long-range drones",
    tags: ["ukraine", "drone", "long-range"],
    cores: [
      "Ukrainian long range strike drone",
      "Ukraine drone attack Russian oil",
      "Ukrainian UAV factory photo",
      "Ukraine cardboard drone",
      "Ukrainian naval drone Magura",
    ],
  },
  {
    group: "Ukraine Conflict",
    topic: "Ukrainian jet strikes",
    tags: ["ukraine", "fighter-jet", "airstrike"],
    cores: [
      "Ukrainian MiG-29 fighter jet",
      "Ukraine Su-27 fighter aircraft",
      "Ukrainian F-16 fighter jet",
      "Ukraine air force strike mission",
      "Ukrainian jet dropping bombs",
    ],
  },
  {
    group: "Ukraine Conflict",
    topic: "Ukrainian HIMARS and artillery",
    tags: ["ukraine", "himars", "artillery"],
    cores: [
      "Ukrainian HIMARS rocket launch",
      "Ukraine M142 HIMARS firing",
      "Ukrainian artillery howitzer fire",
      "Ukraine rocket artillery strike",
      "HIMARS destruction Ukraine war",
    ],
  },
  {
    group: "Ukraine Conflict",
    topic: "Ukrainian naval drones",
    tags: ["ukraine", "naval-drone", "black-sea"],
    cores: [
      "Ukrainian sea drone Black Sea",
      "Ukraine Magura V5 naval drone",
      "Ukrainian USV attack ship",
      "Black Sea drone boat Ukraine",
      "Ukrainian maritime drone strike",
    ],
  },
  {
    group: "Ukraine Conflict",
    topic: "Ukraine frontline combat",
    tags: ["ukraine", "frontline", "infantry"],
    cores: [
      "Ukrainian soldiers trench war",
      "Ukraine infantry combat photo",
      "Ukrainian troops Donbas front",
      "Ukraine armored vehicle advance",
      "Ukrainian soldiers urban combat",
    ],
  },
  {
    group: "Ukraine Conflict",
    topic: "Ukraine air defense",
    tags: ["ukraine", "air-defense", "patriot"],
    cores: [
      "Ukrainian Patriot air defense",
      "Ukraine IRIS-T air defense",
      "Ukrainian NASAMS launcher",
      "Ukraine shoot down missile",
      "Ukrainian air defense battery",
    ],
  },

  // —— Russia Military ——
  {
    group: "Russia Military",
    topic: "Russian warships",
    tags: ["russia", "navy", "ship"],
    cores: [
      "Russian Navy frigate Black Sea",
      "Russian warship Moskva class",
      "Russian Navy corvette at sea",
      "Russian Black Sea Fleet ship",
      "Russian Navy landing ship",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian fighter jets",
    tags: ["russia", "fighter-jet", "su-35"],
    cores: [
      "Russian Su-35 fighter jet",
      "Russian Su-34 bomber aircraft",
      "Russian MiG-31 fighter",
      "Russian Air Force fighter takeoff",
      "Russian jet afterburner photo",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian bombers",
    tags: ["russia", "bomber", "nuclear"],
    cores: [
      "Russian Tu-95 Bear bomber",
      "Russian Tu-160 Blackjack bomber",
      "Russian strategic bomber flight",
      "Tu-22M Backfire bomber",
      "Russian nuclear bomber takeoff",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian tanks and armor",
    tags: ["russia", "tank", "armor"],
    cores: [
      "Russian T-72 tank Ukraine",
      "Russian T-90 tank combat",
      "Russian armored column war",
      "destroyed Russian tank Ukraine",
      "Russian BMP infantry fighting vehicle",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian trains and logistics",
    tags: ["russia", "logistics", "train"],
    cores: [
      "Russian military train rail",
      "Russian ammunition train",
      "Russian rail logistics military",
      "freight train Russia war supplies",
      "Russian railway military transport",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian oil and industry targets",
    tags: ["russia", "oil", "refinery", "industry"],
    cores: [
      "Russian oil refinery fire",
      "Russia fuel depot explosion",
      "Russian oil storage tanks blaze",
      "Russian industrial plant smoke",
      "Russian port oil terminal",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian military bases",
    tags: ["russia", "base", "airfield"],
    cores: [
      "Russian airbase fighter parked",
      "Russian military base compound",
      "Russian ammo depot warehouse",
      "Russian radar installation",
      "Russian drone factory building",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian helicopters",
    tags: ["russia", "helicopter"],
    cores: [
      "Russian Ka-52 alligator helicopter",
      "Russian Mi-28 attack helicopter",
      "Russian Mi-8 transport helicopter",
      "Russian attack helicopter flight",
      "destroyed Russian helicopter wreck",
    ],
  },

  // —— Israel & IDF ——
  {
    group: "Israel & IDF",
    topic: "Israeli Air Force jets",
    tags: ["israel", "idf", "fighter-jet", "f-15", "f-16"],
    cores: [
      "Israeli Air Force F-15 fighter",
      "Israeli F-16I Sufa jet",
      "IAF fighter jet takeoff",
      "Israeli Air Force strike aircraft",
      "Israel F-35I Adir fighter",
    ],
  },
  {
    group: "Israel & IDF",
    topic: "Israel Iron Dome and air defense",
    tags: ["israel", "iron-dome", "air-defense"],
    cores: [
      "Iron Dome intercept Israel",
      "Iron Dome missile launch night",
      "Israel David's Sling air defense",
      "Israel Iron Beam laser defense",
      "Israeli air defense intercept trails",
    ],
  },
  {
    group: "Israel & IDF",
    topic: "IDF ground forces",
    tags: ["israel", "idf", "infantry", "armor"],
    cores: [
      "IDF soldiers urban combat",
      "Israeli Merkava tank",
      "IDF infantry Gaza operation",
      "Israeli D9 Caterpillar bulldozer",
      "IDF special forces photo",
    ],
  },
  {
    group: "Israel & IDF",
    topic: "Israel airstrikes",
    tags: ["israel", "airstrike", "explosion"],
    cores: [
      "Israeli airstrike explosion night",
      "IDF air strike smoke plume",
      "Israel fighter jet bombing run",
      "Israeli munition impact explosion",
      "Israel military strike aftermath",
    ],
  },
  {
    group: "Israel & IDF",
    topic: "Israel Navy",
    tags: ["israel", "navy", "ship"],
    cores: [
      "Israeli Navy Sa'ar corvette",
      "Israel Navy missile boat",
      "Israeli Dolphin submarine",
      "Israel Navy ship Mediterranean",
      "Israeli Navy destroyer patrol",
    ],
  },
  {
    group: "Israel & IDF",
    topic: "Hamas and Hezbollah targets",
    tags: ["israel", "hamas", "hezbollah", "tunnel"],
    cores: [
      "Hamas tunnel Gaza entrance",
      "Hezbollah rocket launcher Lebanon",
      "weapons cache Gaza tunnel",
      "Hamas arsenal seizure photo",
      "anti-tunnel military operation Israel",
    ],
  },

  // —— Weapons & Systems ——
  {
    group: "Weapons & Systems",
    topic: "Tomahawk cruise missile",
    tags: ["missile", "tomahawk", "us-navy"],
    cores: [
      "Tomahawk cruise missile launch",
      "US Navy Tomahawk VLS fire",
      "Tomahawk missile in flight",
      "cruise missile destroyer launch",
      "BGM-109 Tomahawk photo",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "Hypersonic missiles",
    tags: ["missile", "hypersonic"],
    cores: [
      "US hypersonic missile test",
      "hypersonic glide vehicle launch",
      "AGM-183 ARRW missile",
      "hypersonic weapon test photo",
      "US Air Force hypersonic missile",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "Naval laser weapons",
    tags: ["laser", "us-navy", "directed-energy"],
    cores: [
      "US Navy laser weapon HELIOS",
      "naval laser shooting drone",
      "US Navy directed energy weapon",
      "shipboard laser defense system",
      "LaWS laser weapon US Navy",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "QuickSink and anti-ship bombs",
    tags: ["bomb", "anti-ship", "quicksink"],
    cores: [
      "US Navy QuickSink bomb test",
      "anti-ship bomb ship explosion",
      "JDAM anti-ship weapon",
      "ship sinking bomb test",
      "QuickSink maritime strike",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "Vacuum bomb and heavy munitions",
    tags: ["bomb", "thermobaric", "munition"],
    cores: [
      "thermobaric bomb explosion",
      "vacuum bomb demolition building",
      "fuel air explosive blast",
      "large munition crater explosion",
      "heavy bomb blast aftermath",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "GAU gun systems",
    tags: ["gun", "gau-8", "gau-21"],
    cores: [
      "GAU-8 Avenger cannon A-10",
      "GAU-21 helicopter door gun",
      "aircraft gatling gun firing",
      "30mm cannon shell casings",
      "helicopter door gunner firing",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "Patriot and SAM systems",
    tags: ["air-defense", "patriot", "sam"],
    cores: [
      "Patriot missile launch night",
      "PAC-3 Patriot interceptor",
      "surface to air missile launch",
      "SAM battery radar truck",
      "air defense missile streak sky",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "Naval mines and torpedoes",
    tags: ["torpedo", "mine", "naval"],
    cores: [
      "US Navy torpedo launch",
      "naval mine warfare photo",
      "Mk-48 torpedo submarine",
      "mine countermeasures ship",
      "underwater explosion naval mine",
    ],
  },

  // —— Submarines ——
  {
    group: "Submarines",
    topic: "US Navy attack submarine",
    tags: ["us-navy", "submarine", "virginia-class"],
    cores: [
      "US Navy Virginia class submarine",
      "US attack submarine surfaced",
      "Los Angeles class submarine",
      "US Navy submarine underway Pacific",
      "nuclear attack submarine photo",
    ],
  },
  {
    group: "Submarines",
    topic: "US ballistic missile submarine",
    tags: ["us-navy", "submarine", "ohio-class"],
    cores: [
      "Ohio class ballistic missile submarine",
      "US Navy SSBN submarine",
      "Trident submarine US Navy",
      "ballistic missile submarine surfaced",
      "US Navy strategic submarine",
    ],
  },
  {
    group: "Submarines",
    topic: "Submarine airdrop resupply",
    tags: ["us-navy", "submarine", "logistics"],
    cores: [
      "US Navy submarine airdrop supply",
      "submarine special airdrop ocean",
      "parachute drop to submarine",
      "US Navy submarine replenishment",
      "submarine mid ocean resupply",
    ],
  },

  // —— Pirates & Maritime Security ——
  {
    group: "Pirates & Maritime",
    topic: "Pirate skiffs and attacks",
    tags: ["pirates", "somalia", "maritime"],
    cores: [
      "Somali pirate skiff Indian Ocean",
      "pirate attack cargo ship",
      "armed pirates boarding vessel",
      "Gulf of Aden pirate boats",
      "maritime piracy confrontation",
    ],
  },
  {
    group: "Pirates & Maritime",
    topic: "Anti-piracy operations",
    tags: ["pirates", "us-navy", "boarding"],
    cores: [
      "US Navy anti-piracy operation",
      "Navy SEALs pirate rescue",
      "coalition anti-piracy boarding",
      "warship intercept pirate skiff",
      "captured pirates US Navy",
    ],
  },

  // —— NATO & Allies ——
  {
    group: "NATO & Allies",
    topic: "NATO fighter intercepts",
    tags: ["nato", "fighter-jet", "intercept"],
    cores: [
      "NATO fighter intercept Russian bomber",
      "RAF Typhoon intercept",
      "NATO Quick Reaction Alert scramble",
      "allied fighter escort bomber",
      "NATO jet intercept Baltic",
    ],
  },
  {
    group: "NATO & Allies",
    topic: "Australian military aircraft",
    tags: ["australia", "fighter-jet", "raaf"],
    cores: [
      "RAAF F-35 fighter jet",
      "Australian Super Hornet flight",
      "RAAF P-8 Poseidon patrol",
      "Australian fighter intercept",
      "RAAF Wedgetail AWACS",
    ],
  },
  {
    group: "NATO & Allies",
    topic: "British military drones and ships",
    tags: ["uk", "drone", "navy"],
    cores: [
      "British Royal Navy warship",
      "UK military drone UAV",
      "Royal Navy Type 45 destroyer",
      "British Army Watchkeeper drone",
      "HMS aircraft carrier Queen Elizabeth",
    ],
  },
  {
    group: "NATO & Allies",
    topic: "German tanks and armor",
    tags: ["germany", "tank", "leopard"],
    cores: [
      "German Leopard 2 tank",
      "Leopard 2A7 tank firing",
      "Bundeswehr armored vehicle",
      "German tank Ukraine delivery",
      "Leopard tank combat photo",
    ],
  },
  {
    group: "NATO & Allies",
    topic: "Japanese fighter jets",
    tags: ["japan", "fighter-jet", "jsdf"],
    cores: [
      "Japan F-15J fighter jet",
      "JASDF F-35 fighter",
      "Japanese fighter intercept Chinese",
      "Japan Air Self Defense Force jet",
      "JASDF F-2 fighter aircraft",
    ],
  },

  // —— Special / Future Systems ——
  {
    group: "Special Systems",
    topic: "SR-72 and hypersonic recon",
    tags: ["usaf", "sr-72", "hypersonic", "recon"],
    cores: [
      "SR-72 Darkstar concept aircraft",
      "hypersonic reconnaissance aircraft",
      "Lockheed SR-72 artist rendering",
      "US Air Force hypersonic spy plane",
      "Darkstar aircraft concept photo",
    ],
  },
  {
    group: "Special Systems",
    topic: "Next-gen FA-XX fighter",
    tags: ["us-navy", "fighter-jet", "ngad", "fa-xx"],
    cores: [
      "US Navy FA-XX fighter concept",
      "next generation air dominance fighter",
      "NGAD fighter jet concept",
      "sixth generation fighter aircraft",
      "US Navy future fighter design",
    ],
  },
  {
    group: "Special Systems",
    topic: "Pacific missile defense",
    tags: ["us-military", "pacific", "missile-defense"],
    cores: [
      "US Pacific missile defense radar",
      "Aegis Ashore Pacific",
      "THAAD missile defense system",
      "US Indo-Pacific defense exercise",
      "Guam missile defense battery",
    ],
  },
  {
    group: "Special Systems",
    topic: "Venezuelan military aircraft",
    tags: ["venezuela", "fighter-jet", "confrontation"],
    cores: [
      "Venezuelan Su-30 fighter jet",
      "Venezuela Air Force fighter",
      "Venezuelan jet near US Navy",
      "Venezuela military aircraft flyby",
      "Venezuelan fighter intercept photo",
    ],
  },
  {
    group: "Special Systems",
    topic: "Syria US forces",
    tags: ["syria", "us-military", "special-ops"],
    cores: [
      "US forces Syria base",
      "US troops Syria desert",
      "US military convoy Syria",
      "US special forces Middle East",
      "US soldiers Middle East patrol",
    ],
  },

  // —— Generic war documentary B-roll ——
  {
    group: "War Documentary B-roll",
    topic: "Aircraft carrier flight ops",
    tags: ["carrier", "flight-ops", "us-navy"],
    cores: [
      "aircraft carrier flight deck operations",
      "jet catapult launch carrier",
      "carrier arrested landing night",
      "flight deck crew yellow shirts",
      "carrier island bridge photo",
    ],
  },
  {
    group: "War Documentary B-roll",
    topic: "Explosion and fireball",
    tags: ["explosion", "fireball", "strike"],
    cores: [
      "military explosion fireball night",
      "airstrike blast smoke plume",
      "munition impact explosion photo",
      "warhead detonation fireball",
      "battlefield explosion documentary",
    ],
  },
  {
    group: "War Documentary B-roll",
    topic: "Military maps and command",
    tags: ["map", "command", "briefing"],
    cores: [
      "military situation map briefing",
      "war room command center screens",
      "naval chart operations map",
      "officers studying battle map",
      "military headquarters command post",
    ],
  },
  {
    group: "War Documentary B-roll",
    topic: "Radar and sensors",
    tags: ["radar", "sensors", "ew"],
    cores: [
      "military radar rotating antenna",
      "naval radar mast closeup",
      "air defense radar truck",
      "phased array radar warship",
      "electronic warfare antenna array",
    ],
  },
  {
    group: "War Documentary B-roll",
    topic: "Night combat operations",
    tags: ["night", "combat", "infrared"],
    cores: [
      "night vision military combat",
      "infrared drone strike night",
      "night airstrike tracer fire",
      "warship night operations",
      "soldiers night raid infrared",
    ],
  },
  {
    group: "War Documentary B-roll",
    topic: "Military ports and docks",
    tags: ["port", "harbor", "dock"],
    cores: [
      "naval base harbor warships",
      "military port docked destroyer",
      "warship pier side photo",
      "naval shipyard dry dock",
      "fleet anchored military harbor",
    ],
  },
  {
    group: "War Documentary B-roll",
    topic: "Uniforms and equipment closeups",
    tags: ["uniform", "equipment", "gear"],
    cores: [
      "soldier helmet and rifle closeup",
      "naval officer bridge uniform",
      "military body armor gear",
      "pilot flight helmet cockpit",
      "combat boots mud trench",
    ],
  },
  {
    group: "War Documentary B-roll",
    topic: "Satellite and ISR imagery style",
    tags: ["satellite", "isr", "recon"],
    cores: [
      "military satellite image facility",
      "reconnaissance aerial photo base",
      "ISR drone overhead view",
      "satellite imagery explosion site",
      "aerial reconnaissance military target",
    ],
  },

  // —— Extra coverage to reach 100 topics / 1000 queries ——
  {
    group: "US Navy & Ships",
    topic: "US Navy replenishment ship",
    tags: ["us-navy", "logistics", "ship"],
    cores: [
      "US Navy replenishment oiler",
      "USNS supply ship underway",
      "connected replenishment UNREP",
      "US Navy logistics ship",
      "fleet oiler refueling warship",
    ],
  },
  {
    group: "US Navy & Ships",
    topic: "US Navy hospital ship",
    tags: ["us-navy", "hospital-ship"],
    cores: [
      "USNS Comfort hospital ship",
      "USNS Mercy hospital ship",
      "US Navy hospital ship docked",
      "white hospital ship US Navy",
      "military hospital ship deployment",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "MQ-9 Reaper drone",
    tags: ["usaf", "drone", "mq-9"],
    cores: [
      "MQ-9 Reaper drone flight",
      "US Air Force Reaper UAV",
      "Predator Reaper armed drone",
      "MQ-9 Reaper takeoff runway",
      "Reaper drone Hellfire missile",
    ],
  },
  {
    group: "US Air Force & Jets",
    topic: "AC-130 gunship",
    tags: ["usaf", "gunship", "ac-130"],
    cores: [
      "AC-130 gunship night fire",
      "US Air Force Spectre gunship",
      "AC-130 side firing cannons",
      "gunship tracer fire night",
      "AC-130 combat aircraft photo",
    ],
  },
  {
    group: "Iran Military",
    topic: "Strait of Hormuz shipping",
    tags: ["iran", "hormuz", "shipping"],
    cores: [
      "oil tanker Strait of Hormuz",
      "Persian Gulf shipping lane",
      "tanker traffic Strait Hormuz",
      "commercial ship Persian Gulf",
      "Hormuz chokepoint tanker photo",
    ],
  },
  {
    group: "Ukraine Conflict",
    topic: "Ukrainian armor and Bradleys",
    tags: ["ukraine", "armor", "bradley"],
    cores: [
      "Ukrainian Bradley fighting vehicle",
      "Ukraine Leopard tank combat",
      "Ukrainian armored vehicle advance",
      "Ukraine M113 APC war",
      "Ukrainian tank crew photo",
    ],
  },
  {
    group: "Russia Military",
    topic: "Russian Black Sea Fleet",
    tags: ["russia", "black-sea", "navy"],
    cores: [
      "Russian Black Sea Fleet Sevastopol",
      "Russian Navy Black Sea base",
      "Russian warship Sevastopol harbor",
      "Black Sea Fleet Russian ships",
      "Russian naval base Crimea",
    ],
  },
  {
    group: "Israel & IDF",
    topic: "Israel border and Gaza ops",
    tags: ["israel", "gaza", "border"],
    cores: [
      "IDF Gaza border fence",
      "Israeli military Gaza operation",
      "Israel Egypt border security",
      "IDF armored column Gaza",
      "Israeli soldiers Gaza Strip",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "Javelin and ATGMs",
    tags: ["missile", "javelin", "atgm"],
    cores: [
      "Javelin anti tank missile launch",
      "soldier firing Javelin missile",
      "ATGM anti tank guided missile",
      "NLAW anti tank weapon",
      "Ukrainian Javelin missile team",
    ],
  },
  {
    group: "Weapons & Systems",
    topic: "Naval CIWS Phalanx",
    tags: ["ciws", "phalanx", "air-defense"],
    cores: [
      "Phalanx CIWS firing",
      "US Navy close in weapon system",
      "CIWS gatling gun warship",
      "Phalanx block 1B photo",
      "ship self defense CIWS",
    ],
  },
  {
    group: "Houthis & Red Sea",
    topic: "US carrier vs Houthis",
    tags: ["houthis", "carrier", "us-navy"],
    cores: [
      "US aircraft carrier Red Sea Houthis",
      "carrier strike group Red Sea",
      "US Navy jets Yemen operations",
      "F-18 launch Red Sea carrier",
      "USS carrier Gulf of Aden",
    ],
  },
  {
    group: "China Military",
    topic: "Chinese aircraft carrier ops",
    tags: ["china", "carrier", "navy"],
    cores: [
      "Chinese aircraft carrier Liaoning",
      "PLA Navy carrier Shandong",
      "Chinese carrier flight deck",
      "PLA Navy carrier Fujian",
      "Chinese J-15 carrier takeoff",
    ],
  },
  {
    group: "NATO & Allies",
    topic: "French and European fighters",
    tags: ["france", "rafale", "europe", "fighter-jet"],
    cores: [
      "French Rafale fighter jet",
      "Dassault Rafale takeoff",
      "Eurofighter Typhoon flight",
      "European fighter jet formation",
      "Rafale combat aircraft photo",
    ],
  },
];

function expandQueries(seed: WarSeed): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const clean = q.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  // Pair each core with tails until we have 10 unique queries
  for (let i = 0; out.length < 10 && i < QUERY_TAILS.length * 3; i++) {
    const core = seed.cores[i % seed.cores.length];
    const tail = QUERY_TAILS[i % QUERY_TAILS.length];
    push(`${core} ${tail}`);
  }
  // Absolute fallbacks if somehow short
  let n = 0;
  while (out.length < 10) {
    push(`${seed.topic} military documentary photo ${n++}`);
  }
  return out.slice(0, 10);
}

function buildWarTopics(): WarTopic[] {
  const topics = WAR_SEEDS.map((seed) => ({
    group: seed.group,
    topic: seed.topic,
    tags: seed.tags,
    queries: expandQueries(seed),
  }));
  if (topics.length !== 100) {
    throw new Error(`Expected 100 war topics, got ${topics.length}`);
  }
  const allQueries = topics.flatMap((t) => t.queries);
  if (allQueries.length !== 1000) {
    throw new Error(`Expected 1000 queries, got ${allQueries.length}`);
  }
  const unique = new Set(allQueries.map((q) => q.toLowerCase()));
  if (unique.size < 980) {
    throw new Error(`Too many duplicate queries: unique=${unique.size}/1000`);
  }
  return topics;
}

export const WAR_TOPICS: WarTopic[] = buildWarTopics();

function assertSearchBudget() {
  const topics = WAR_TOPICS.length;
  const searches = WAR_TOPICS.reduce((n, t) => n + Math.min(10, t.queries.length), 0);
  if (topics > 100) throw new Error(`Too many topics: ${topics}`);
  if (searches > 1000) throw new Error(`Search budget exceeded: ${searches}`);
  return { topics, searches, uniqueQueries: new Set(WAR_TOPICS.flatMap((t) => t.queries)).size };
}

async function googleImageSearch(query: string, num = 50): Promise<GoogleImageItem[]> {
  const key = getSearchApiKey();
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("safe", "active");
  url.searchParams.set("size", "large");
  url.searchParams.set("aspect_ratio", "wide");
  url.searchParams.set("num", String(Math.min(100, Math.max(10, num))));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SearchAPI ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const data = (await res.json()) as { images?: GoogleImageItem[]; images_results?: GoogleImageItem[] };
  return (data.images || data.images_results || []).slice(0, num);
}

function looksClean(item: GoogleImageItem): boolean {
  const link = item.original?.link || "";
  const title = (item.title || "").toLowerCase();
  const page = (item.source?.link || "").toLowerCase();
  const hay = `${link} ${title} ${page}`;
  if (!/^https?:\/\//i.test(link)) return false;
  if (BAD_HOSTS.some((h) => hay.includes(h))) return false;
  if (BAD_TITLE.some((t) => title.includes(t))) return false;
  const w = item.original?.width || 0;
  const h = item.original?.height || 0;
  if (w && h) {
    // Slightly looser so we keep more usable stills
    if (w < 700 || h < 400) return false;
    if (w / h < 1.05) return false;
  }
  return true;
}

async function downloadImage(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DocumentaryVideoFactory/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 18_000 || ab.byteLength > 16_000_000) return null;
    return { buf: Buffer.from(ab), contentType };
  } catch {
    return null;
  }
}

/** Fast free description from Google title + classification (no vision). */
export function warImageDescription(params: {
  topic: string;
  group: string;
  tags: string[];
  query: string;
  item: GoogleImageItem;
}): string {
  const title = (params.item.title || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const source = params.item.source?.name ? ` Source: ${params.item.source.name}.` : "";
  const tags = params.tags.length ? ` Tags: ${params.tags.join(", ")}.` : "";
  const titlePart = title ? ` Title: ${title}.` : "";
  const useFor = ` Use for: ${params.topic} documentary B-roll in ${params.group} — establishing shots, cutaways, and narration matches for ${params.tags.slice(0, 3).join(", ") || params.topic}.`;
  return `${params.topic} (${params.group}) war documentary still.${tags}${source}${titlePart}${useFor} Query: ${params.query}`;
}

export async function collectWarTopic(params: {
  topic: WarTopic;
  /** Max images to keep per Google query (default 16 → ~12–16k across 1000 queries) */
  perQueryKeep?: number;
  onProgress?: (msg: string) => void;
}): Promise<PersonLibraryIndex> {
  const niche = "War";
  const nicheSlug = "war";
  const person = params.topic.topic;
  const personSlug = slugify(person);
  const group = params.topic.group;
  const tags = params.topic.tags;
  const log = params.onProgress || console.log;
  const queries = params.topic.queries.slice(0, 10);
  const perQueryKeep = Math.max(1, Math.min(24, params.perQueryKeep ?? 16));

  const existing =
    (await r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`)) ||
    ({
      niche,
      nicheSlug,
      person,
      personSlug,
      group,
      updatedAt: new Date().toISOString(),
      counts: { images: 0, raw_footage: 0, byCategory: {} },
      assets: [],
    } satisfies PersonLibraryIndex);

  const seen = new Set(
    existing.assets.filter((a) => a.mediaType === "image").map((a) => a.sourceUrl).filter(Boolean) as string[]
  );
  const assets = [...existing.assets];
  let nextNum = Math.max(0, ...assets.filter((a) => a.mediaType === "image").map((a) => a.number), 0) + 1;

  for (const query of queries) {
    log(`[war] ${group} / ${person}: ${query}`);
    let results: GoogleImageItem[] = [];
    try {
      // Pull a fat page from SearchAPI so we can keep more after filters/download fails
      results = await googleImageSearch(query, 50);
    } catch (err) {
      log(`[war] search fail: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const candidates = results
      .filter((item) => {
        if (!looksClean(item)) return false;
        const url = item.original?.link;
        if (!url || seen.has(url)) return false;
        return true;
      })
      .slice(0, perQueryKeep + 10);

    for (const item of candidates) seen.add(item.original!.link!);

    const downloadedBatch = await Promise.all(
      candidates.map(async (item) => {
        const url = item.original!.link!;
        const downloaded = await downloadImage(url);
        return downloaded ? { item, downloaded, url } : null;
      })
    );

    let kept = 0;
    for (const row of downloadedBatch) {
      if (!row || kept >= perQueryKeep) continue;
      const { item, downloaded, url } = row;
      const ext = downloaded.contentType.includes("png")
        ? "png"
        : downloaded.contentType.includes("webp")
          ? "webp"
          : "jpg";
      const assetId = `${nicheSlug}-${personSlug}-img-${String(nextNum).padStart(4, "0")}`;
      const r2Key = `library/${nicheSlug}/${personSlug}/images/${assetId}.${ext}`;
      const category = slugify(tags[0] || query.split(" ").slice(0, 3).join(" "));
      const description = warImageDescription({ topic: person, group, tags, query, item });
      await r2PutObject({
        key: r2Key,
        body: downloaded.buf,
        contentType: downloaded.contentType,
        metadata: { group: slugify(group), topic: personSlug, number: String(nextNum) },
      });
      const asset: LibraryAsset = {
        assetId,
        number: nextNum,
        niche,
        nicheSlug,
        person,
        personSlug,
        group,
        mediaType: "image",
        category,
        categories: [...new Set([category, slugify(group), ...tags.map(slugify)])],
        r2Key,
        width: item.original?.width,
        height: item.original?.height,
        sourceUrl: url,
        sourcePageUrl: item.source?.link,
        queryUsed: query,
        title: item.title,
        description,
        createdAt: new Date().toISOString(),
      };
      assets.push(asset);
      nextNum += 1;
      kept += 1;
    }
    log(
      `[war] ${person} after query → ${assets.filter((a) => a.mediaType === "image").length} images (+${kept})`
    );
  }

  const images = assets.filter((a) => a.mediaType === "image");
  const byCategory: Record<string, number> = {};
  for (const a of images) byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  const index: PersonLibraryIndex = {
    niche,
    nicheSlug,
    person,
    personSlug,
    group,
    updatedAt: new Date().toISOString(),
    counts: {
      images: images.length,
      raw_footage: assets.filter((a) => a.mediaType === "raw_footage").length,
      byCategory,
    },
    assets: assets.sort((a, b) => a.number - b.number),
  };
  await r2PutJson(`library/${nicheSlug}/${personSlug}/index.json`, index);
  await r2PutJson(`library/${nicheSlug}/${personSlug}/manifest.json`, {
    person,
    personSlug,
    niche,
    nicheSlug,
    group,
    tags,
    imageCount: index.counts.images,
    assets: images.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      category: a.category,
      categories: a.categories,
      r2Key: a.r2Key,
      description: a.description,
    })),
  });
  return index;
}

export async function rebuildWarNicheIndex(): Promise<void> {
  const niche = "War";
  const nicheSlug = "war";
  const people: NicheLibraryIndex["people"] = [];
  for (const t of WAR_TOPICS) {
    const personSlug = slugify(t.topic);
    const idx = await r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`);
    if (!idx) continue;
    people.push({
      person: idx.person,
      personSlug: idx.personSlug,
      images: idx.counts.images,
      raw_footage: idx.counts.raw_footage,
      group: idx.group || t.group,
    });
  }
  const nicheIdx: NicheLibraryIndex = {
    niche,
    nicheSlug,
    updatedAt: new Date().toISOString(),
    people: people.sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.person.localeCompare(b.person)),
  };
  await r2PutJson(`library/${nicheSlug}/index.json`, nicheIdx);

  const root =
    (await r2GetJson<RootLibraryIndex>(`library/index.json`)) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);
  const map = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  map.set("war", {
    niche,
    nicheSlug,
    peopleCount: people.length,
    images: people.reduce((n, p) => n + p.images, 0),
    raw_footage: people.reduce((n, p) => n + p.raw_footage, 0),
  });
  await r2PutJson(`library/index.json`, {
    updatedAt: new Date().toISOString(),
    niches: [...map.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  });
}

export function warBudget() {
  return assertSearchBudget();
}

export function listWarQueryCatalog(): Array<{
  group: string;
  topic: string;
  tags: string[];
  queries: string[];
}> {
  return WAR_TOPICS.map((t) => ({
    group: t.group,
    topic: t.topic,
    tags: t.tags,
    queries: t.queries,
  }));
}
