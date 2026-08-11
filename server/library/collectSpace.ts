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

const BAD_TITLE = ["meme", "thumbnail", "clickbait", "watermark", "stock photo", "cartoon", "ai generated"];

interface GoogleImageItem {
  title?: string;
  original?: { link?: string; width?: number; height?: number };
  source?: { name?: string; link?: string };
}

export type SpaceTopic = {
  group: string;
  topic: string;
  /** Exactly <= 10 search queries */
  queries: string[];
};

/** 12 parent groups · 60 topics · 10 searches each = 600 SearchAPI calls max */
export const SPACE_TOPICS: SpaceTopic[] = [
  // 1 Mars & Rovers (6)
  {
    group: "Mars & Rovers",
    topic: "Mars",
    queries: [
      "Mars planet NASA landscape photo",
      "Mars surface horizontal photograph",
      "Mars orbital view landscape",
      "Mars red planet wide image",
      "Mars topography landscape photo",
      "Mars dust storm landscape NASA",
      "Mars polar ice cap landscape",
      "Mars canyon valley landscape",
      "Mars atmosphere haze landscape",
      "Mars planet documentary photo horizontal",
    ],
  },
  {
    group: "Mars & Rovers",
    topic: "Mars surface",
    queries: [
      "Mars surface rocks landscape NASA",
      "Martian desert landscape photo",
      "Mars ground level panorama",
      "Mars soil horizon landscape",
      "Mars rocky terrain landscape",
      "Mars dune field landscape",
      "Mars crater floor landscape",
      "Mars surface sunrise landscape",
      "Mars plains landscape photo",
      "Mars geology landscape NASA",
    ],
  },
  {
    group: "Mars & Rovers",
    topic: "Perseverance rover",
    queries: [
      "Perseverance rover Mars landscape NASA",
      "Perseverance rover selfie landscape",
      "Perseverance Jezero crater landscape",
      "NASA Perseverance rover photo horizontal",
      "Perseverance rover driving Mars landscape",
      "Perseverance sample collection landscape",
      "Perseverance rover Ingenuity landscape",
      "Perseverance Mars rock landscape",
      "Perseverance rover wide photo",
      "Perseverance mission landscape image",
    ],
  },
  {
    group: "Mars & Rovers",
    topic: "Curiosity rover",
    queries: [
      "Curiosity rover Mars landscape NASA",
      "Curiosity rover selfie landscape",
      "Curiosity Mount Sharp landscape",
      "Curiosity rover Gale crater landscape",
      "NASA Curiosity rover photo horizontal",
      "Curiosity rover driving landscape",
      "Curiosity Mars mountain landscape",
      "Curiosity rover sunset landscape",
      "Curiosity rover wide image",
      "Curiosity mission landscape photo",
    ],
  },
  {
    group: "Mars & Rovers",
    topic: "Opportunity rover",
    queries: [
      "Opportunity rover Mars landscape NASA",
      "Opportunity rover Meridiani landscape",
      "Opportunity rover panorama landscape",
      "NASA Opportunity rover photo horizontal",
      "Opportunity rover tracks landscape",
      "Opportunity rover rock landscape",
      "Opportunity Mars exploration landscape",
      "Opportunity rover wide photo",
      "Opportunity mission landscape image",
      "Opportunity rover documentary photo",
    ],
  },
  {
    group: "Mars & Rovers",
    topic: "Spirit rover",
    queries: [
      "Spirit rover Mars landscape NASA",
      "Spirit rover Gusev crater landscape",
      "Spirit rover panorama landscape",
      "NASA Spirit rover photo horizontal",
      "Spirit rover Columbia Hills landscape",
      "Spirit rover tracks landscape",
      "Spirit Mars exploration landscape",
      "Spirit rover wide photo",
      "Spirit mission landscape image",
      "Spirit rover documentary photo",
    ],
  },

  // 2 Moon & Lunar (3)
  {
    group: "Moon & Lunar",
    topic: "The Moon",
    queries: [
      "Moon surface NASA landscape photo",
      "Full Moon landscape photograph",
      "Moon craters landscape horizontal",
      "Lunar landscape wide photo",
      "Moon from Earth landscape photo",
      "Moon maria landscape NASA",
      "Moon closeup landscape photo",
      "Crescent Moon landscape photograph",
      "Moon terrain landscape image",
      "Moon documentary photo horizontal",
    ],
  },
  {
    group: "Moon & Lunar",
    topic: "Lunar surface",
    queries: [
      "Lunar surface astronaut landscape NASA",
      "Moon ground landscape photo",
      "Apollo lunar surface landscape",
      "Lunar dust landscape photograph",
      "Moon horizon landscape NASA",
      "Lunar rocks landscape photo",
      "Moon landing site landscape",
      "Lunar highland landscape photo",
      "Moon surface panorama landscape",
      "Lunar terrain documentary photo",
    ],
  },
  {
    group: "Moon & Lunar",
    topic: "Lunar missions",
    queries: [
      "Apollo Moon mission landscape NASA",
      "Lunar module Moon landscape",
      "Artemis lunar mission landscape",
      "Apollo astronaut Moon landscape",
      "Moon landing mission photo horizontal",
      "Lunar rover Moon landscape",
      "Apollo 11 Moon landscape photo",
      "NASA lunar mission wide image",
      "Moon mission spacecraft landscape",
      "Lunar exploration documentary photo",
    ],
  },

  // 3 Sun & Solar System (4)
  {
    group: "Sun & Solar System",
    topic: "The Sun",
    queries: [
      "Sun solar surface NASA landscape",
      "Sun flare landscape photograph",
      "Solar disk wide photo NASA",
      "Sun corona landscape image",
      "Sunspots landscape photo",
      "Solar prominence landscape NASA",
      "Sun extreme ultraviolet landscape",
      "Sun closeup landscape photo",
      "Solar atmosphere landscape image",
      "Sun documentary photo horizontal",
    ],
  },
  {
    group: "Sun & Solar System",
    topic: "Solar System",
    queries: [
      "Solar System planets landscape illustration NASA",
      "Solar System diagram landscape photo",
      "Planets of Solar System wide image",
      "Solar System orbital landscape NASA",
      "Solar System scale landscape photo",
      "Inner Solar System landscape image",
      "Outer Solar System landscape photo",
      "Solar System planets lineup landscape",
      "NASA Solar System wide image",
      "Solar System documentary photo horizontal",
    ],
  },
  {
    group: "Sun & Solar System",
    topic: "Solar storms",
    queries: [
      "Solar storm NASA landscape photo",
      "Coronal mass ejection landscape",
      "Solar flare eruption landscape NASA",
      "Geomagnetic storm aurora landscape",
      "Solar wind storm landscape photo",
      "Sun storm activity landscape",
      "Solar storm Earth impact landscape",
      "CME solar storm wide image",
      "Solar storm documentary photo",
      "Space weather solar storm landscape",
    ],
  },
  {
    group: "Sun & Solar System",
    topic: "Parker Solar Probe",
    queries: [
      "Parker Solar Probe NASA landscape",
      "Parker Solar Probe Sun landscape photo",
      "Parker Solar Probe spacecraft landscape",
      "Parker Solar Probe mission wide image",
      "Parker probe approaching Sun landscape",
      "Parker Solar Probe corona landscape",
      "NASA Parker probe photo horizontal",
      "Parker Solar Probe artwork landscape",
      "Parker Solar Probe documentary photo",
      "Parker Solar Probe close Sun image",
    ],
  },

  // 4 Jupiter System (6)
  {
    group: "Jupiter System",
    topic: "Jupiter",
    queries: [
      "Jupiter planet NASA landscape photo",
      "Jupiter Great Red Spot landscape",
      "Jupiter atmosphere bands landscape",
      "Jupiter closeup landscape NASA",
      "Jupiter planet wide image",
      "Jupiter storms landscape photo",
      "Jupiter from space landscape",
      "Jupiter gas giant landscape image",
      "Jupiter documentary photo horizontal",
      "Jupiter NASA Juno landscape",
    ],
  },
  {
    group: "Jupiter System",
    topic: "Jupiter moons",
    queries: [
      "Jupiter moons lineup landscape NASA",
      "Galilean moons landscape photo",
      "Jupiter and moons wide image",
      "Jupiter moons comparison landscape",
      "Jupiter satellite moons landscape",
      "Galilean moons documentary photo",
      "Jupiter moons NASA landscape image",
      "Jupiter system moons wide photo",
      "Jupiter moons orbit landscape",
      "Jupiter moons space photo horizontal",
    ],
  },
  {
    group: "Jupiter System",
    topic: "Europa",
    queries: [
      "Europa moon ice surface landscape NASA",
      "Europa Jupiter moon landscape photo",
      "Europa icy crust landscape",
      "Europa ocean moon landscape NASA",
      "Europa surface cracks landscape",
      "Europa moon wide image",
      "Europa NASA documentary photo",
      "Europa ice ridges landscape",
      "Europa Jupiter landscape photo",
      "Europa moon horizontal photograph",
    ],
  },
  {
    group: "Jupiter System",
    topic: "Io",
    queries: [
      "Io moon volcano landscape NASA",
      "Io Jupiter volcanic landscape",
      "Io moon surface landscape photo",
      "Io lava landscape NASA",
      "Io moon wide image",
      "Io volcanic plume landscape",
      "Io Jupiter moon documentary photo",
      "Io sulfur surface landscape",
      "Io moon horizontal photograph",
      "NASA Io moon landscape image",
    ],
  },
  {
    group: "Jupiter System",
    topic: "Ganymede",
    queries: [
      "Ganymede moon landscape NASA",
      "Ganymede Jupiter moon surface landscape",
      "Ganymede ice landscape photo",
      "Ganymede moon wide image",
      "Ganymede crater landscape NASA",
      "Ganymede documentary photo horizontal",
      "Ganymede largest moon landscape",
      "Ganymede surface terrain landscape",
      "NASA Ganymede moon landscape",
      "Ganymede Jupiter landscape image",
    ],
  },
  {
    group: "Jupiter System",
    topic: "Juno mission",
    queries: [
      "Juno spacecraft Jupiter landscape NASA",
      "Juno mission Jupiter photo landscape",
      "Juno Jupiter polar landscape",
      "Juno probe Jupiter wide image",
      "NASA Juno mission landscape photo",
      "Juno Jupiter clouds landscape",
      "Juno spacecraft artwork landscape",
      "Juno Jupiter documentary photo",
      "Juno mission horizontal photograph",
      "Juno Jupiter closeup landscape",
    ],
  },

  // 5 Saturn System (5)
  {
    group: "Saturn System",
    topic: "Saturn",
    queries: [
      "Saturn planet rings landscape NASA",
      "Saturn planet wide photo",
      "Saturn rings landscape photograph",
      "Saturn from space landscape",
      "Saturn gas giant landscape NASA",
      "Saturn planet documentary photo",
      "Saturn closeup landscape image",
      "Saturn Cassini landscape photo",
      "Saturn horizontal photograph",
      "Saturn planet space photo landscape",
    ],
  },
  {
    group: "Saturn System",
    topic: "Saturn rings",
    queries: [
      "Saturn rings closeup landscape NASA",
      "Saturn ring system landscape photo",
      "Saturn rings detail landscape",
      "Saturn rings Cassini landscape",
      "Saturn rings wide image",
      "Saturn rings documentary photo",
      "Saturn icy rings landscape",
      "Saturn rings horizontal photograph",
      "NASA Saturn rings landscape",
      "Saturn ring spokes landscape photo",
    ],
  },
  {
    group: "Saturn System",
    topic: "Titan",
    queries: [
      "Titan moon landscape NASA",
      "Titan Saturn moon surface landscape",
      "Titan lakes landscape photo",
      "Titan atmosphere landscape NASA",
      "Titan moon wide image",
      "Titan Huygens landscape photo",
      "Titan methane lakes landscape",
      "Titan documentary photo horizontal",
      "NASA Titan moon landscape",
      "Titan orange haze landscape",
    ],
  },
  {
    group: "Saturn System",
    topic: "Enceladus",
    queries: [
      "Enceladus moon plumes landscape NASA",
      "Enceladus ice geysers landscape",
      "Enceladus Saturn moon landscape photo",
      "Enceladus tiger stripes landscape",
      "Enceladus moon wide image",
      "Enceladus water plumes landscape",
      "Enceladus documentary photo horizontal",
      "NASA Enceladus moon landscape",
      "Enceladus icy surface landscape",
      "Enceladus Saturn landscape image",
    ],
  },
  {
    group: "Saturn System",
    topic: "Cassini mission",
    queries: [
      "Cassini spacecraft Saturn landscape NASA",
      "Cassini mission Saturn photo landscape",
      "Cassini Saturn rings landscape",
      "Cassini probe wide image",
      "NASA Cassini mission landscape",
      "Cassini Grand Finale landscape",
      "Cassini Saturn documentary photo",
      "Cassini spacecraft artwork landscape",
      "Cassini Titan flyby landscape",
      "Cassini mission horizontal photograph",
    ],
  },

  // 6 Earth & Inner Planets (3)
  {
    group: "Earth & Inner Planets",
    topic: "Earth from space",
    queries: [
      "Earth from space NASA landscape photo",
      "Blue Marble Earth landscape",
      "Earth atmosphere from space landscape",
      "Earth night lights from space landscape",
      "Earth globe from ISS landscape",
      "Earth horizon from space landscape",
      "Earth from Moon landscape photo",
      "Earth documentary space photo horizontal",
      "Planet Earth from orbit landscape",
      "NASA Earth from space wide image",
    ],
  },
  {
    group: "Earth & Inner Planets",
    topic: "Venus",
    queries: [
      "Venus planet NASA landscape photo",
      "Venus atmosphere landscape",
      "Venus surface radar landscape",
      "Venus planet wide image",
      "Venus clouds landscape NASA",
      "Venus documentary photo horizontal",
      "Venus planet from space landscape",
      "NASA Venus landscape image",
      "Venus greenhouse planet landscape",
      "Venus closeup landscape photo",
    ],
  },
  {
    group: "Earth & Inner Planets",
    topic: "Mercury",
    queries: [
      "Mercury planet NASA landscape photo",
      "Mercury surface craters landscape",
      "Mercury planet wide image",
      "Mercury Messenger landscape NASA",
      "Mercury documentary photo horizontal",
      "Mercury closeup landscape photo",
      "Mercury terrain landscape image",
      "NASA Mercury planet landscape",
      "Mercury from space landscape",
      "Mercury rocky planet landscape photo",
    ],
  },

  // 7 Outer Worlds (5)
  {
    group: "Outer Worlds",
    topic: "Uranus",
    queries: [
      "Uranus planet NASA landscape photo",
      "Uranus ice giant landscape",
      "Uranus rings landscape photo",
      "Uranus planet wide image",
      "Uranus Voyager landscape NASA",
      "Uranus documentary photo horizontal",
      "Uranus blue planet landscape",
      "NASA Uranus landscape image",
      "Uranus from space landscape",
      "Uranus planet horizontal photograph",
    ],
  },
  {
    group: "Outer Worlds",
    topic: "Neptune",
    queries: [
      "Neptune planet NASA landscape photo",
      "Neptune blue planet landscape",
      "Neptune storm landscape photo",
      "Neptune planet wide image",
      "Neptune Voyager landscape NASA",
      "Neptune documentary photo horizontal",
      "Neptune ice giant landscape",
      "NASA Neptune landscape image",
      "Neptune from space landscape",
      "Neptune planet horizontal photograph",
    ],
  },
  {
    group: "Outer Worlds",
    topic: "Pluto",
    queries: [
      "Pluto New Horizons landscape NASA",
      "Pluto heart landscape photo",
      "Pluto surface landscape",
      "Pluto planet wide image",
      "Pluto mountains landscape NASA",
      "Pluto documentary photo horizontal",
      "Pluto dwarf planet landscape",
      "NASA Pluto landscape image",
      "Pluto Tombaugh Regio landscape",
      "Pluto closeup landscape photo",
    ],
  },
  {
    group: "Outer Worlds",
    topic: "Dwarf planets",
    queries: [
      "Dwarf planets Solar System landscape NASA",
      "Ceres dwarf planet landscape",
      "Eris dwarf planet landscape photo",
      "Dwarf planets comparison landscape",
      "Haumea Makemake landscape image",
      "Dwarf planet documentary photo",
      "NASA dwarf planets wide image",
      "Ceres surface landscape NASA",
      "Dwarf planets lineup landscape",
      "Dwarf planet horizontal photograph",
    ],
  },
  {
    group: "Outer Worlds",
    topic: "Kuiper Belt",
    queries: [
      "Kuiper Belt illustration landscape NASA",
      "Kuiper Belt objects landscape photo",
      "Kuiper Belt Solar System landscape",
      "Kuiper Belt documentary image",
      "Trans-Neptunian objects landscape",
      "Kuiper Belt wide image NASA",
      "Kuiper Belt icy bodies landscape",
      "NASA Kuiper Belt landscape photo",
      "Kuiper Belt region landscape",
      "Kuiper Belt horizontal photograph",
    ],
  },

  // 8 Black Holes & Extreme (5)
  {
    group: "Black Holes & Extreme",
    topic: "Black holes",
    queries: [
      "Black hole illustration NASA landscape",
      "Black hole accretion disk landscape",
      "Supermassive black hole landscape photo",
      "Black hole Event Horizon landscape",
      "Black hole space image horizontal",
      "Black hole documentary photo",
      "Black hole jet landscape NASA",
      "Black hole visualization landscape",
      "NASA black hole wide image",
      "Black hole universe landscape photo",
    ],
  },
  {
    group: "Black Holes & Extreme",
    topic: "Sagittarius A*",
    queries: [
      "Sagittarius A* black hole landscape",
      "Sagittarius A star black hole photo",
      "Milky Way center black hole landscape",
      "Sagittarius A* Event Horizon Telescope",
      "Sagittarius A* documentary image",
      "Galactic center black hole landscape",
      "Sagittarius A* wide image",
      "NASA Sagittarius A landscape photo",
      "Sagittarius A* horizontal photograph",
      "Milky Way black hole landscape image",
    ],
  },
  {
    group: "Black Holes & Extreme",
    topic: "Neutron stars",
    queries: [
      "Neutron star illustration landscape NASA",
      "Neutron star space photo landscape",
      "Neutron star documentary image",
      "Neutron star magnetic field landscape",
      "Neutron star wide image",
      "NASA neutron star landscape photo",
      "Neutron star remnant landscape",
      "Neutron star horizontal photograph",
      "Pulsar neutron star landscape",
      "Neutron star universe landscape image",
    ],
  },
  {
    group: "Black Holes & Extreme",
    topic: "Pulsars",
    queries: [
      "Pulsar star landscape NASA illustration",
      "Pulsar beams landscape photo",
      "Pulsar space documentary image",
      "Pulsar neutron star landscape",
      "Pulsar wide image NASA",
      "Pulsar lighthouse beams landscape",
      "NASA pulsar landscape photo",
      "Pulsar horizontal photograph",
      "Pulsar astronomy landscape image",
      "Pulsar universe landscape photo",
    ],
  },
  {
    group: "Black Holes & Extreme",
    topic: "Quasars",
    queries: [
      "Quasar galaxy landscape NASA",
      "Quasar jet landscape photo",
      "Quasar space documentary image",
      "Quasar active galaxy landscape",
      "Quasar wide image NASA",
      "Bright quasar landscape photo",
      "NASA quasar landscape image",
      "Quasar horizontal photograph",
      "Quasar universe landscape",
      "Quasar accretion landscape photo",
    ],
  },

  // 9 Stars & Death (5)
  {
    group: "Stars & Stellar Death",
    topic: "Stars",
    queries: [
      "Stars night sky landscape photo",
      "Star field astronomy landscape",
      "Stars galaxy landscape NASA",
      "Bright stars landscape photograph",
      "Star cluster landscape photo",
      "Stars documentary space image",
      "Milky Way stars landscape",
      "NASA stars wide image",
      "Stars universe landscape photo",
      "Starry sky horizontal photograph",
    ],
  },
  {
    group: "Stars & Stellar Death",
    topic: "Supernovae",
    queries: [
      "Supernova explosion landscape NASA",
      "Supernova remnant landscape photo",
      "Supernova Crab Nebula landscape",
      "Supernova documentary image",
      "Supernova wide image NASA",
      "Stellar explosion landscape photo",
      "NASA supernova landscape image",
      "Supernova horizontal photograph",
      "Supernova remnant space landscape",
      "Supernova astronomy landscape photo",
    ],
  },
  {
    group: "Stars & Stellar Death",
    topic: "Red giant stars",
    queries: [
      "Red giant star landscape NASA",
      "Red giant star illustration landscape",
      "Red giant star documentary photo",
      "Red giant star wide image",
      "Aging red giant landscape photo",
      "NASA red giant landscape image",
      "Red giant star horizontal photograph",
      "Red giant sun-like star landscape",
      "Red giant astronomy landscape",
      "Red giant star space photo",
    ],
  },
  {
    group: "Stars & Stellar Death",
    topic: "Nebulae",
    queries: [
      "Nebula space landscape NASA photo",
      "Colorful nebula landscape photograph",
      "Emission nebula landscape wide",
      "Planetary nebula landscape NASA",
      "Nebula documentary space image",
      "Orion Nebula landscape photo",
      "NASA nebula wide image",
      "Nebula horizontal photograph",
      "Cosmic nebula landscape image",
      "Hubble nebula landscape photo",
    ],
  },
  {
    group: "Stars & Stellar Death",
    topic: "Betelgeuse",
    queries: [
      "Betelgeuse star landscape photo",
      "Betelgeuse red giant landscape NASA",
      "Betelgeuse Orion star landscape",
      "Betelgeuse documentary image",
      "Betelgeuse wide astronomy photo",
      "Betelgeuse surface landscape",
      "NASA Betelgeuse landscape image",
      "Betelgeuse horizontal photograph",
      "Betelgeuse star dimming landscape",
      "Betelgeuse space photo landscape",
    ],
  },

  // 10 Galaxies & Cosmos (6)
  {
    group: "Galaxies & Cosmos",
    topic: "The Milky Way",
    queries: [
      "Milky Way galaxy night landscape photo",
      "Milky Way arch landscape photograph",
      "Milky Way center landscape NASA",
      "Milky Way documentary image",
      "Milky Way wide night sky photo",
      "Milky Way over mountains landscape",
      "NASA Milky Way landscape image",
      "Milky Way horizontal photograph",
      "Milky Way galactic plane landscape",
      "Milky Way stars landscape photo",
    ],
  },
  {
    group: "Galaxies & Cosmos",
    topic: "Galaxies",
    queries: [
      "Spiral galaxy landscape NASA photo",
      "Distant galaxies landscape image",
      "Galaxy cluster landscape NASA",
      "Galaxies Hubble landscape photo",
      "Galaxy documentary space image",
      "Spiral galaxy wide image",
      "NASA galaxies landscape photo",
      "Galaxy horizontal photograph",
      "Deep field galaxies landscape",
      "Beautiful galaxy landscape image",
    ],
  },
  {
    group: "Galaxies & Cosmos",
    topic: "Andromeda Galaxy",
    queries: [
      "Andromeda Galaxy landscape photo",
      "Andromeda Galaxy wide image NASA",
      "Andromeda Galaxy night sky landscape",
      "Andromeda Galaxy documentary photo",
      "M31 Andromeda landscape image",
      "Andromeda Galaxy Hubble landscape",
      "NASA Andromeda landscape photo",
      "Andromeda Galaxy horizontal photograph",
      "Andromeda Galaxy closeup landscape",
      "Andromeda Galaxy space photo",
    ],
  },
  {
    group: "Galaxies & Cosmos",
    topic: "The universe",
    queries: [
      "Universe cosmos landscape NASA photo",
      "Deep universe landscape image",
      "Cosmic web universe landscape",
      "Universe expansion illustration landscape",
      "Universe documentary space photo",
      "Observable universe landscape image",
      "NASA universe wide photo",
      "Universe horizontal photograph",
      "Cosmos stars galaxies landscape",
      "Universe deep space landscape photo",
    ],
  },
  {
    group: "Galaxies & Cosmos",
    topic: "Dark matter",
    queries: [
      "Dark matter illustration landscape NASA",
      "Dark matter cosmic web landscape",
      "Dark matter galaxy landscape image",
      "Dark matter documentary photo",
      "Dark matter universe landscape",
      "NASA dark matter wide image",
      "Dark matter astronomy landscape",
      "Dark matter horizontal photograph",
      "Dark matter map landscape photo",
      "Dark matter space science image",
    ],
  },
  {
    group: "Galaxies & Cosmos",
    topic: "Space mysteries",
    queries: [
      "Space mystery cosmos landscape photo",
      "Unexplained space phenomenon landscape",
      "Mysterious universe landscape NASA",
      "Space anomaly documentary image",
      "Cosmic mystery landscape photo",
      "Deep space mystery wide image",
      "NASA space mystery landscape",
      "Space mysteries horizontal photograph",
      "Mysterious galaxy landscape photo",
      "Universe mysteries space image",
    ],
  },

  // 11 NASA & Telescopes (5)
  {
    group: "NASA & Telescopes",
    topic: "NASA",
    queries: [
      "NASA logo mission landscape photo",
      "NASA control room landscape",
      "NASA headquarters landscape photo",
      "NASA launch landscape photograph",
      "NASA scientists mission landscape",
      "NASA space center landscape",
      "NASA documentary photo horizontal",
      "NASA mission patch landscape",
      "NASA operations landscape image",
      "NASA agency wide photo",
    ],
  },
  {
    group: "NASA & Telescopes",
    topic: "James Webb Space Telescope",
    queries: [
      "James Webb Space Telescope image landscape",
      "JWST deep field landscape NASA",
      "James Webb telescope photo landscape",
      "JWST nebula landscape image",
      "James Webb galaxy landscape photo",
      "JWST infrared landscape NASA",
      "James Webb documentary image",
      "JWST space telescope wide photo",
      "James Webb horizontal photograph",
      "JWST cosmic landscape image",
    ],
  },
  {
    group: "NASA & Telescopes",
    topic: "Hubble Space Telescope",
    queries: [
      "Hubble Space Telescope image landscape",
      "Hubble deep field landscape NASA",
      "Hubble nebula landscape photo",
      "Hubble galaxy landscape image",
      "Hubble Space Telescope photo landscape",
      "Hubble documentary space image",
      "Hubble iconic landscape photograph",
      "NASA Hubble wide image",
      "Hubble horizontal photograph",
      "Hubble cosmos landscape photo",
    ],
  },
  {
    group: "NASA & Telescopes",
    topic: "Space telescopes",
    queries: [
      "Space telescope orbit landscape NASA",
      "Orbiting space telescope landscape photo",
      "Space telescopes astronomy landscape",
      "Space telescope documentary image",
      "Astronomical space telescope wide photo",
      "NASA space telescope landscape",
      "Space telescope horizontal photograph",
      "Telescope in space landscape image",
      "Space observatory landscape photo",
      "Orbital telescope documentary photo",
    ],
  },
  {
    group: "NASA & Telescopes",
    topic: "NASA discoveries",
    queries: [
      "NASA discovery announcement landscape",
      "NASA science discovery landscape photo",
      "NASA exoplanet discovery landscape",
      "NASA breakthrough discovery image",
      "NASA research discovery landscape",
      "NASA discovery documentary photo",
      "NASA new discovery wide image",
      "NASA discovery horizontal photograph",
      "NASA findings space landscape",
      "NASA science result landscape photo",
    ],
  },

  // 12 Missions, Small Bodies & Life (7) → 60 total
  {
    group: "Missions & Deep Space",
    topic: "Voyager missions",
    queries: [
      "Voyager spacecraft landscape NASA",
      "Voyager 1 pale blue dot landscape",
      "Voyager 2 Neptune landscape photo",
      "Voyager mission deep space landscape",
      "Voyager golden record landscape",
      "Voyager probe documentary image",
      "NASA Voyager wide photo",
      "Voyager interstellar landscape image",
      "Voyager spacecraft horizontal photograph",
      "Voyager 1 2 mission landscape photo",
    ],
  },
  {
    group: "Missions & Deep Space",
    topic: "Space missions",
    queries: [
      "Space mission launch landscape NASA",
      "Crewed space mission landscape photo",
      "Space mission control landscape",
      "Historic space mission landscape",
      "Space mission spacecraft landscape",
      "Space mission documentary image",
      "NASA space mission wide photo",
      "Space mission horizontal photograph",
      "International space mission landscape",
      "Space exploration mission landscape photo",
    ],
  },
  {
    group: "Missions & Deep Space",
    topic: "Asteroids",
    queries: [
      "Asteroid space landscape NASA photo",
      "Asteroid belt landscape illustration",
      "Near Earth asteroid landscape",
      "Asteroid surface landscape photo",
      "Asteroid closeup landscape NASA",
      "Asteroid documentary space image",
      "NASA asteroid wide photo",
      "Asteroid horizontal photograph",
      "Asteroid rocky body landscape",
      "Asteroid exploration landscape photo",
    ],
  },
  {
    group: "Missions & Deep Space",
    topic: "Comets",
    queries: [
      "Comet sky landscape photo",
      "Comet tail landscape photograph",
      "Comet nucleus landscape NASA",
      "Bright comet landscape image",
      "Comet documentary space photo",
      "Comet over horizon landscape",
      "NASA comet wide image",
      "Comet horizontal photograph",
      "Comet astronomy landscape photo",
      "Halley comet landscape image",
    ],
  },
  {
    group: "Missions & Deep Space",
    topic: "Exoplanets",
    queries: [
      "Exoplanet illustration landscape NASA",
      "Exoplanet artist concept landscape",
      "Habitable exoplanet landscape image",
      "Exoplanet system landscape photo",
      "Exoplanet documentary space image",
      "NASA exoplanet wide photo",
      "Exoplanet horizontal photograph",
      "Alien planet exoplanet landscape",
      "Exoplanet discovery landscape image",
      "Exoplanet atmosphere landscape photo",
    ],
  },
  {
    group: "Missions & Deep Space",
    topic: "Extraterrestrial life",
    queries: [
      "Extraterrestrial life concept landscape",
      "Search for alien life landscape NASA",
      "Habitable world life landscape illustration",
      "Astrobiology alien life landscape",
      "Extraterrestrial life documentary image",
      "Possible alien life landscape photo",
      "NASA astrobiology wide image",
      "Extraterrestrial life horizontal photograph",
      "Life beyond Earth landscape concept",
      "Alien biosignature landscape illustration",
    ],
  },
  {
    group: "Missions & Deep Space",
    topic: "SpaceX missions",
    queries: [
      "SpaceX Falcon launch landscape photo",
      "SpaceX Starship landscape photograph",
      "SpaceX rocket landing landscape",
      "SpaceX mission launch wide image",
      "SpaceX Crew Dragon landscape photo",
      "SpaceX documentary launch image",
      "SpaceX rocket landscape horizontal",
      "SpaceX pad launch landscape photo",
      "SpaceX mission control landscape",
      "SpaceX spacecraft landscape photograph",
    ],
  },
];

function assertSearchBudget() {
  const topics = SPACE_TOPICS.length;
  const searches = SPACE_TOPICS.reduce((n, t) => n + Math.min(10, t.queries.length), 0);
  if (topics > 60) throw new Error(`Too many topics: ${topics}`);
  if (searches > 600) throw new Error(`Search budget exceeded: ${searches}`);
  return { topics, searches };
}

async function googleImageSearch(query: string, num = 20): Promise<GoogleImageItem[]> {
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
    if (w < 800 || h < 450) return false;
    if (w / h < 1.2) return false;
  }
  return true;
}

async function downloadImage(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DocumentaryVideoFactory/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 30_000 || ab.byteLength > 14_000_000) return null;
    return { buf: Buffer.from(ab), contentType };
  } catch {
    return null;
  }
}

export async function collectSpaceTopic(params: {
  topic: SpaceTopic;
  onProgress?: (msg: string) => void;
}): Promise<PersonLibraryIndex> {
  const niche = "Space";
  const nicheSlug = "space";
  const person = params.topic.topic;
  const personSlug = slugify(person);
  const group = params.topic.group;
  const log = params.onProgress || console.log;
  const queries = params.topic.queries.slice(0, 10);

  const existing =
    (await r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`)) ||
    ({
      niche,
      nicheSlug,
      person,
      personSlug,
      group,
      updatedAt: new Date().toISOString(),
      counts: { images: 0, raw_footage: 0, trusted_clips: 0, raw_clips: 0, byCategory: {} },
      assets: [],
    } satisfies PersonLibraryIndex);

  const seen = new Set(
    existing.assets.filter((a) => a.mediaType === "image").map((a) => a.sourceUrl).filter(Boolean) as string[]
  );
  const assets = [...existing.assets];
  let nextNum = Math.max(0, ...assets.filter((a) => a.mediaType === "image").map((a) => a.number), 0) + 1;

  for (const query of queries) {
    log(`[space] ${group} / ${person}: ${query}`);
    let results: GoogleImageItem[] = [];
    try {
      results = await googleImageSearch(query, 12);
    } catch (err) {
      log(`[space] search fail: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const candidates = results.filter((item) => {
      if (!looksClean(item)) return false;
      const url = item.original?.link;
      if (!url || seen.has(url)) return false;
      return true;
    }).slice(0, 6);

    for (const item of candidates) seen.add(item.original!.link!);

    const downloadedBatch = await Promise.all(
      candidates.map(async (item) => {
        const url = item.original!.link!;
        const downloaded = await downloadImage(url);
        return downloaded ? { item, downloaded, url } : null;
      })
    );

    for (const row of downloadedBatch) {
      if (!row) continue;
      const { item, downloaded, url } = row;
      const ext = downloaded.contentType.includes("png")
        ? "png"
        : downloaded.contentType.includes("webp")
          ? "webp"
          : "jpg";
      const assetId = `${nicheSlug}-${personSlug}-img-${String(nextNum).padStart(4, "0")}`;
      const r2Key = `library/${nicheSlug}/${personSlug}/images/${assetId}.${ext}`;
      const category = slugify(query.split(" ").slice(0, 3).join(" "));
      await r2PutObject({
        key: r2Key,
        body: downloaded.buf,
        contentType: downloaded.contentType,
        metadata: { group: slugify(group), topic: personSlug, number: String(nextNum) },
      });
      assets.push({
        assetId,
        number: nextNum,
        niche,
        nicheSlug,
        person,
        personSlug,
        group,
        mediaType: "image",
        category,
        categories: [category, slugify(group)],
        r2Key,
        width: item.original?.width,
        height: item.original?.height,
        sourceUrl: url,
        sourcePageUrl: item.source?.link,
        queryUsed: query,
        title: item.title,
        createdAt: new Date().toISOString(),
      });
      nextNum += 1;
    }
    log(
      `[space] ${person} after query → ${assets.filter((a) => a.mediaType === "image").length} images`
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
      trusted_clips: assets.filter((a) => a.mediaType === "trusted_clip").length,
      raw_clips: assets.filter(
        (a) => a.mediaType === "raw_footage" || a.mediaType === "trusted_clip"
      ).length,
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
    imageCount: index.counts.images,
    assets: images.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      category: a.category,
      r2Key: a.r2Key,
    })),
  });
  return index;
}

export async function rebuildSpaceNicheIndex(): Promise<void> {
  const niche = "Space";
  const nicheSlug = "space";
  const people: NicheLibraryIndex["people"] = [];
  for (const t of SPACE_TOPICS) {
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
  // preserve royal-v1 if present
  map.set("space", {
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

export function spaceBudget() {
  return assertSearchBudget();
}
