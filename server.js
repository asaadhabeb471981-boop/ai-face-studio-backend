require("dotenv").config()

const express = require("express")
const cors = require("cors")
const axios = require("axios")
const FormData = require("form-data")
const crypto = require("crypto")

function optionalRequire(moduleName, fallback) {
    try {
        return require(moduleName)
    } catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") {
            throw error
        }

        console.warn(`Optional dependency "${moduleName}" is not installed. Using fallback middleware.`)
        return fallback
    }
}

const noopMiddleware = (req, res, next) => next()
const compression = optionalRequire("compression", () => noopMiddleware)
const helmet = optionalRequire("helmet", () => noopMiddleware)
const rateLimit = optionalRequire("express-rate-limit", () => noopMiddleware)

const app = express()

const PORT = process.env.PORT || 3000
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN
const APP_VERSION = "2.0.0"
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 12 * 1024 * 1024)
const JSON_LIMIT = process.env.JSON_LIMIT || "60mb"
const REPLICATE_TIMEOUT_MS = Number(process.env.REPLICATE_TIMEOUT_MS || 60000)
const PREDICTION_POLL_INTERVAL_MS = Number(process.env.PREDICTION_POLL_INTERVAL_MS || 2000)
const PREDICTION_MAX_ATTEMPTS = Number(process.env.PREDICTION_MAX_ATTEMPTS || 60)
const GENERATION_MODEL = process.env.REPLICATE_GENERATION_MODEL || "black-forest-labs/flux-kontext-pro"
const AGE_GENERATION_MODEL = process.env.REPLICATE_AGE_GENERATION_MODEL || "black-forest-labs/flux-kontext-max"
const UPSCALE_MODEL = process.env.REPLICATE_UPSCALE_MODEL || "nightmareai/real-esrgan"
const UNIVERSAL_MOODS = ["Natural", "Serious", "Luxury"]
const UNIVERSAL_STRENGTHS = ["Accurate", "Balanced", "Extreme"]
const UNIVERSAL_VARIATIONS = ["Random", "Variation 1", "Variation 2", "Variation 3"]
const UNIVERSAL_GENDER_MODES = ["Auto", "Female", "Male"]
const AGE_TARGETS = ["Younger Adult", "30s", "40s", "50s", "60s", "Senior Adult"]
const STYLE_NAMES = {
    AI_AVATAR: "AI Avatar",
    HEADSHOT: "Headshot",
    PROFESSIONAL: "Professional",
    SUPERHERO: "Superhero",
    FANTASY: "Fantasy",
    CYBERPUNK: "Cyberpunk",
    ANIME: "Anime",
    CARTOON: "Cartoon",
    AGE_STUDIO: "Age Studio"
}
const UNIVERSAL_STYLES = [
    STYLE_NAMES.AI_AVATAR,
    STYLE_NAMES.HEADSHOT,
    STYLE_NAMES.PROFESSIONAL,
    STYLE_NAMES.SUPERHERO,
    STYLE_NAMES.FANTASY,
    STYLE_NAMES.CYBERPUNK,
    STYLE_NAMES.ANIME,
    STYLE_NAMES.CARTOON,
    STYLE_NAMES.AGE_STUDIO
]
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "*")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)

const studioOptions = {
    styles: UNIVERSAL_STYLES,
    moods: UNIVERSAL_MOODS,
    strengths: UNIVERSAL_STRENGTHS,
    variations: UNIVERSAL_VARIATIONS,
    genderModes: UNIVERSAL_GENDER_MODES,
    ageTargets: AGE_TARGETS,
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9", "match_input_image"],
    backgroundStyles: ["Studio", "Beach", "Cyberpunk", "Office", "Fantasy"]
}

const replicateClient = axios.create({
    baseURL: "https://api.replicate.com/v1",
    timeout: REPLICATE_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: {
        Authorization: `Token ${REPLICATE_TOKEN}`
    }
})

app.disable("x-powered-by")
app.set("trust proxy", 1)

app.use((req, res, next) => {
    req.requestId = req.headers["x-request-id"] || crypto.randomUUID()
    res.setHeader("X-Request-Id", req.requestId)
    next()
})

app.use(helmet())
app.use(compression())
app.use(cors({
    origin(origin, callback) {
        if (ALLOWED_ORIGINS.includes("*") || !origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true)
            return
        }

        callback(new Error("Origin not allowed"))
    }
}))
app.use(express.json({ limit: JSON_LIMIT }))

const generationLimiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    limit: Number(process.env.RATE_LIMIT_MAX || 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        imageUrl: null,
        error: "Too many AI requests. Please wait a moment and try again."
    }
})

if (!REPLICATE_TOKEN) {
    console.error("Missing REPLICATE_API_TOKEN in .env")
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        name: "AI Face Studio Backend",
        version: APP_VERSION,
        status: "running",
        endpoints: ["/health", "/studio/options", "/generate", "/background"],
        requestId: req.requestId
    })
})

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: REPLICATE_TOKEN ? "ready" : "missing_replicate_token",
        version: APP_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        provider: "replicate",
        generationModel: GENERATION_MODEL,
        ageGenerationModel: AGE_GENERATION_MODEL,
        requestId: req.requestId
    })
})

app.get("/studio/options", (req, res) => {
    res.json({
        success: true,
        options: studioOptions,
        requestId: req.requestId
    })
})

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)]
}

function createHttpError(message, statusCode = 400, code = "BAD_REQUEST") {
    const error = new Error(message)
    error.statusCode = statusCode
    error.code = code
    return error
}

function sanitizeText(value, fallback = "", maxLength = 800) {
    if (typeof value !== "string") return fallback

    return value
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength) || fallback
}

function pickAllowed(value, allowedValues, fallback) {
    const normalizedValue = sanitizeText(value, fallback, 80).toLowerCase()
    return allowedValues.find(item => item.toLowerCase() === normalizedValue) || fallback
}

const studioDirectionExpansions = [
    {
        patterns: [/\b(spider[\s-]?man|spiderman|spider hero|web hero|wall crawler)\b/],
        direction: "Create an original spider-inspired cinematic superhero look. The design must be instantly readable as a spider-powered hero: saturated red torso, deep blue side panels and legs, black web-pattern grid across the chest, arms, and shoulders, sleek athletic bodysuit, abstract spider-like chest mark that is not an exact logo, wrist web-shooter details, web strands or web motion effects, agile crouching or wall-crawling energy, dramatic city skyline, dynamic comic-book movie lighting. Keep the real face visible by using an open-face cowl, lifted mask, or white eye-lens shapes as a face-framing hood detail rather than covering the identity."
    },
    {
        patterns: [/\b(bat[\s-]?man|batman|dark knight|bat hero|gotham)\b/],
        direction: "Create an original dark knight-inspired superhero look: black armored suit, elegant cape silhouette, nocturnal city atmosphere, dramatic shadows, premium tactical-but-heroic design, powerful rooftop composition."
    },
    {
        patterns: [/\b(iron[\s-]?man|ironman|tech hero|armored hero|arc reactor)\b/],
        direction: "Create an original armored tech-hero look: premium red and gold futuristic armor, glowing chest energy core, polished metal panels, cinematic flight-ready posture, advanced high-tech atmosphere."
    },
    {
        patterns: [/\b(super[\s-]?man|superman|kryptonian|flying hero|cape hero)\b/],
        direction: "Create an original noble flying superhero look: bold blue suit, red cape-inspired heroic silhouette, powerful upright posture, glowing sunlight, epic sky and city atmosphere, hopeful cinematic color grading."
    },
    {
        patterns: [/\b(wonder[\s-]?woman|amazon warrior|warrior princess)\b/],
        direction: "Create an original mythic warrior superhero look: elegant armor, premium gold accents, heroic regal posture, cinematic battlefield or palace atmosphere, powerful graceful confidence."
    },
    {
        patterns: [/\b(flash|speedster|lightning runner|fast hero)\b/],
        direction: "Create an original speedster superhero look: sleek red suit, glowing lightning energy trails, dynamic motion blur, athletic running pose, cinematic city action scene."
    },
    {
        patterns: [/\b(thor|thunder god|lightning warrior|storm hero)\b/],
        direction: "Create an original storm-powered warrior hero look: premium armored costume, dramatic cape, lightning energy, mythic cinematic sky, powerful heroic stance, epic fantasy-superhero atmosphere."
    },
    {
        patterns: [/\b(hulk|green giant|gamma hero|strong green hero)\b/],
        direction: "Create an original super-strength hero look: powerful muscular heroic silhouette, green energy mood, torn premium battle outfit, dramatic impact lighting, cinematic destruction in the background."
    },
    {
        patterns: [/\b(captain america|patriotic hero|shield hero|super soldier)\b/],
        direction: "Create an original patriotic super-soldier hero look: premium blue tactical superhero suit, heroic shield-inspired composition, strong leadership posture, cinematic battlefield lighting, polished blockbuster realism."
    },
    {
        patterns: [/\b(black panther|panther hero|vibranium|sleek black hero)\b/],
        direction: "Create an original sleek black armored hero look: elegant dark suit, subtle silver energy lines, premium futuristic royal design, powerful agile stance, cinematic advanced-city atmosphere."
    },
    {
        patterns: [/\b(deadpool|red mercenary|masked mercenary)\b/],
        direction: "Create an original red-and-black antihero look: premium stylized combat suit, expressive mask design, cinematic action pose, bold comic-book movie lighting, playful high-energy atmosphere."
    },
    {
        patterns: [/\b(wolverine|claw hero|yellow suit hero)\b/],
        direction: "Create an original rugged clawed hero look: yellow and dark premium superhero suit, intense expression, cinematic battle atmosphere, sharp metallic claw-like energy accents without copying exact costume details."
    },
    {
        patterns: [/\b(doctor strange|dr strange|strange|mystic doctor|portal hero)\b/],
        direction: "Create an original mystic superhero look: elegant sorcerer-inspired cloak shapes, glowing circular portal energy, ancient symbols as abstract light patterns, cinematic temple or city background, premium magical realism, no exact protected costume or logo."
    },
    {
        patterns: [/\b(scarlet witch|wanda|chaos magic|red magic)\b/],
        direction: "Create an original chaos-magic superhero look: deep red energy aura, elegant cinematic outfit, floating ember-like magical particles, powerful graceful pose, dramatic red lighting, no exact protected costume or headpiece."
    },
    {
        patterns: [/\b(vision|synthezoid|android hero|mind stone)\b/],
        direction: "Create an original synthetic superhero look: sleek elegant humanoid tech suit, subtle gold and green energy accents, refined futuristic materials, calm intelligent pose, premium sci-fi portrait realism, face still recognizable."
    },
    {
        patterns: [/\b(black widow|widow|spy hero|assassin hero)\b/],
        direction: "Create an original elite spy superhero look: sleek tactical-but-premium suit, subtle red accents, cinematic stealth lighting, agile confident pose, modern city or mission background, face visible and identity preserved."
    },
    {
        patterns: [/\b(hawkeye|archer hero|bow hero|marksman)\b/],
        direction: "Create an original archer superhero look: premium tactical archer suit, bow-inspired composition, purple or dark accent lighting, rooftop or battlefield atmosphere, focused heroic pose, no exact protected costume."
    },
    {
        patterns: [/\b(captain marvel|marvel hero|cosmic hero|photon hero)\b/],
        direction: "Create an original cosmic energy superhero look: premium red, blue, and gold-inspired suit accents, glowing photon energy, powerful flight-ready pose, starfield or sky atmosphere, no exact protected emblem or costume."
    },
    {
        patterns: [/\b(ant[\s-]?man|antman|shrinking hero|quantum hero)\b/],
        direction: "Create an original size-shifting tech superhero look: sleek red and black micro-tech suit, quantum particle glow, futuristic helmet kept open or face visible, cinematic laboratory or city-scale perspective."
    },
    {
        patterns: [/\b(wasp|winged tech hero|insect hero)\b/],
        direction: "Create an original winged tech superhero look: elegant yellow and black micro-tech suit, translucent energy-wing motifs, agile airborne pose, premium futuristic lighting, face visible and recognizable."
    },
    {
        patterns: [/\b(moon knight|moon hero|white knight)\b/],
        direction: "Create an original moonlit vigilante hero look: premium white and silver layered suit, crescent-inspired abstract shapes, desert or rooftop night atmosphere, dramatic moonlight, no exact protected costume."
    },
    {
        patterns: [/\b(blade|vampire hunter)\b/],
        direction: "Create an original vampire-hunter superhero look: black premium tactical coat, silver accents, cinematic night city lighting, confident action pose, stylish dark fantasy atmosphere, face visible."
    },
    {
        patterns: [/\b(daredevil|devil hero|blind hero)\b/],
        direction: "Create an original red urban vigilante hero look: sleek red armored suit, subtle horn-like abstract silhouette only if face remains visible, gritty rooftop lighting, athletic martial-arts posture, no exact protected costume."
    },
    {
        patterns: [/\b(punisher|skull vigilante|vigilante)\b/],
        direction: "Create an original gritty vigilante antihero look: dark tactical premium outfit, abstract chest mark that is not a skull logo, urban night lighting, intense cinematic pose, face visible and recognizable."
    },
    {
        patterns: [/\b(fantastic four|mr fantastic|mister fantastic|elastic hero|stretch hero)\b/],
        direction: "Create an original elastic science-hero look: sleek blue-and-white futuristic explorer suit, dynamic stretching-inspired motion composition, clean sci-fi lab or city background, no exact protected logo."
    },
    {
        patterns: [/\b(invisible woman|force field hero|invisible hero)\b/],
        direction: "Create an original force-field superhero look: elegant blue-white futuristic suit, translucent shield-like energy around the person, clean cinematic sci-fi lighting, graceful powerful pose."
    },
    {
        patterns: [/\b(human torch|flame hero|fire hero)\b/],
        direction: "Create an original flame-powered superhero look: sleek suit with controlled orange fire aura, ember particles, glowing heat light, dramatic sky or city background, keep face safe, visible, and recognizable."
    },
    {
        patterns: [/\b(the thing|rock hero|stone hero)\b/],
        direction: "Create an original stone-strength hero look: premium rocky armor texture or stone energy accents, powerful but human-recognizable face, dramatic impact lighting, heroic city or canyon background."
    },
    {
        patterns: [/\b(silver surfer|surfing hero|cosmic surfer)\b/],
        direction: "Create an original silver cosmic traveler look: reflective silver suit, cosmic board-inspired composition, starfield energy trails, elegant space lighting, face visible and identity preserved."
    },
    {
        patterns: [/\b(star lord|starlord|space outlaw|guardian hero)\b/],
        direction: "Create an original space-outlaw hero look: premium red-brown sci-fi jacket or armor, glowing space blaster-inspired accents without weapons pointed at camera, cosmic city background, adventurous cinematic mood."
    },
    {
        patterns: [/\b(gamora|green warrior|space warrior)\b/],
        direction: "Create an original space-warrior hero look: sleek armored sci-fi outfit, emerald or cosmic accent lighting, alien-city or starship atmosphere, strong graceful action pose, identity preserved."
    },
    {
        patterns: [/\b(groot|tree hero|plant hero|nature guardian)\b/],
        direction: "Create an original nature-guardian hero look: organic wood-like armor motifs over a human-recognizable portrait, glowing green nature energy, forest or cosmic garden atmosphere, do not replace the person with a tree creature."
    },
    {
        patterns: [/\b(venom|symbiote|black suit hero)\b/],
        direction: "Create an original symbiote-inspired dark hero look: glossy black organic suit texture, white abstract chest/eye motifs as costume accents only, intense cinematic lighting, keep the real face visible and do not create a monster face."
    },
    {
        patterns: [/\b(storm|weather hero|weather goddess)\b/],
        direction: "Create an original weather-commanding superhero look: elegant suit, white or silver energy accents, lightning and wind atmosphere, dramatic sky, powerful graceful pose, face visible and recognizable."
    },
    {
        patterns: [/\b(cyclops|optic blast|laser eyes)\b/],
        direction: "Create an original optic-energy superhero look: sleek tactical suit, visor-inspired face-framing design without hiding identity, red energy beam accents, cinematic training-room or city background."
    },
    {
        patterns: [/\b(jean grey|phoenix hero|telekinetic hero)\b/],
        direction: "Create an original telekinetic firebird-energy superhero look: elegant green/gold or red/gold-inspired suit accents, glowing aura, floating particles, cosmic fire atmosphere, no exact protected costume."
    },
    {
        patterns: [/\b(rogue|gambit|nightcrawler|mutant hero|x men|x-men)\b/],
        direction: "Create an original mutant superhero look: premium team-style suit, unique power aura, cinematic academy or city background, expressive heroic pose, no exact protected logos, face visible and recognizable."
    },
    {
        patterns: [/\b(joker|chaos villain|clown villain)\b/],
        direction: "Create an original cinematic chaos-villain portrait: dramatic tailored outfit, unsettling theatrical color grading, moody urban background, expressive face, high-end movie-poster lighting."
    },
    {
        patterns: [/\b(harley|harlequin|punk villain)\b/],
        direction: "Create an original punk antihero portrait: bold fashionable outfit, high-energy editorial styling, colorful cinematic lighting, urban comic-book atmosphere, polished movie-poster finish."
    },
    {
        patterns: [/\b(jedi|star wars|space knight|lightsaber)\b/],
        direction: "Create an original space-knight portrait: elegant robe-like futuristic outfit, glowing energy blade-inspired light, cinematic starship or desert-planet atmosphere, epic sci-fi lighting."
    },
    {
        patterns: [/\b(sith|dark space knight|dark jedi)\b/],
        direction: "Create an original dark space-knight portrait: black futuristic robes, red energy glow, smoky cinematic atmosphere, dramatic shadows, powerful sci-fi villain composition."
    },
    {
        patterns: [/\b(ninja|shinobi|assassin)\b/],
        direction: "Create an original cinematic ninja portrait: sleek dark outfit, subtle armor textures, dramatic low-key lighting, misty night rooftop, agile stealth atmosphere, face still visible and recognizable."
    },
    {
        patterns: [/\b(samurai|ronin)\b/],
        direction: "Create an original cinematic samurai portrait: premium layered armor or robe, elegant sword-inspired composition, warm dramatic lighting, historical-meets-luxury atmosphere, strong dignified posture."
    },
    {
        patterns: [/\b(cyber samurai|tech samurai|neon samurai)\b/],
        direction: "Create an original cyber-samurai portrait: futuristic armor, neon city reflections, elegant blade-inspired silhouette, premium sci-fi textures, cinematic night atmosphere."
    },
    {
        patterns: [/\b(wizard|sorcerer|magic user|mage)\b/],
        direction: "Create an original cinematic sorcerer portrait: elegant mystical wardrobe, subtle glowing energy, ancient library or portal atmosphere, premium fantasy movie lighting, realistic skin and face detail."
    },
    {
        patterns: [/\b(vampire|gothic prince|gothic queen)\b/],
        direction: "Create an original gothic royal portrait: elegant dark formal clothing, moody castle or candlelit background, refined supernatural atmosphere, cinematic shadows, realistic premium finish."
    },
    {
        patterns: [/\b(king|queen|royal|prince|princess)\b/],
        direction: "Create a luxury royal portrait: elegant crown-inspired styling, premium embroidered fabrics, palace atmosphere, warm cinematic light, noble confident posture, realistic high-end fantasy photography."
    },
    {
        patterns: [/\b(astronaut|space explorer|nasa|cosmonaut)\b/],
        direction: "Create an original premium space explorer portrait: futuristic suit, reflective helmet kept open or face visible, cinematic spacecraft or planetary background, cool sci-fi lighting, realistic detail."
    },
    {
        patterns: [/\b(ceo|executive|business|linkedin|corporate)\b/],
        direction: "Create a premium executive portrait: refined formal clothing, modern office or studio background, confident posture, warm professional lighting, realistic skin texture, sharp business profile finish."
    },
    {
        patterns: [/\b(model|fashion|editorial|magazine)\b/],
        direction: "Create a luxury fashion editorial portrait: refined wardrobe, premium camera depth of field, tasteful dramatic lighting, clean high-end composition, polished magazine-cover atmosphere."
    },
    {
        patterns: [/\b(anime|manga)\b/],
        direction: "Create premium anime movie styling: expressive illustrated eyes, clean detailed shading, cinematic animated lighting, polished character design, recognizable identity translated into anime form."
    },
    {
        patterns: [/\b(cartoon|pixar|disney|animated)\b/],
        direction: "Create a premium 3D animated character style: expressive face, polished stylized textures, cinematic animated lighting, friendly high-end animated movie finish, recognizable identity preserved."
    },
    {
        patterns: [/\b(luxury|premium|expensive|high end|high-end|vip)\b/],
        direction: "Use a luxury premium visual finish: elegant wardrobe, refined materials, tasteful color grading, clean composition, high-end lighting, polished commercial photography quality."
    },
    {
        patterns: [/\b(cinematic|movie|film|blockbuster|poster)\b/],
        direction: "Use cinematic movie-poster styling: dramatic key light, rim light, atmospheric depth, strong composition, realistic shadows, premium color grading, blockbuster scale."
    },
    {
        patterns: [/\b(neon|cyber|future|futuristic|sci fi|sci-fi|techwear)\b/],
        direction: "Use futuristic neon visual language: sleek techwear, reflective materials, blue/cyan/magenta lighting, night-city atmosphere, subtle holographic or high-tech background details."
    },
    {
        patterns: [/\b(royal|king|queen|prince|princess|castle|noble)\b/],
        direction: "Use royal fantasy visual language: noble wardrobe, embroidered fabric, cloak or jewelry details, palace/castle atmosphere, warm cinematic light, dignified regal posture."
    },
    {
        patterns: [/\b(ceo|executive|linkedin|business|professional|corporate|founder)\b/],
        direction: "Use executive business portrait language: formal or smart wardrobe, modern office or studio background, confident posture, warm professional lighting, clean premium profile finish."
    },
    {
        patterns: [/\b(studio|headshot|passport|profile photo|profile picture)\b/],
        direction: "Use professional studio portrait language: clean background, shoulder-up framing, soft key light, sharp eyes, natural skin texture, realistic camera depth, polished profile-photo quality."
    },
    {
        patterns: [/\b(armor|armour|metal|mecha|robot suit|power suit)\b/],
        direction: "Use premium armored design language: layered panels, sculpted chest structure, polished metal or composite materials, glowing accents, heroic or futuristic silhouette."
    },
    {
        patterns: [/\b(fire|flame|inferno|lava)\b/],
        direction: "Use fire-powered visual effects: warm orange glow, ember particles, controlled flames, dramatic heat-lit atmosphere, cinematic contrast, without burning or damaging the face."
    },
    {
        patterns: [/\b(ice|frost|snow|frozen)\b/],
        direction: "Use ice-powered visual effects: cool blue-white light, frost textures, crystalline particles, snowy atmosphere, elegant cold cinematic mood, natural skin preserved."
    },
    {
        patterns: [/\b(lightning|electric|thunder|storm)\b/],
        direction: "Use lightning-powered visual effects: electric arcs, stormy atmosphere, blue-white energy trails, dramatic clouds, heroic high-contrast lighting."
    },
    {
        patterns: [/\b(beach|sunset|ocean|vacation)\b/],
        direction: "Use premium beach portrait language: warm sunset light, ocean background, soft golden atmosphere, natural glow, vacation editorial finish."
    },
    {
        patterns: [/\b(red|blue|gold|silver|black|white|green|purple|pink)\b/],
        direction: "Respect the user's color words as visible palette direction for wardrobe, lighting accents, background mood, and style details."
    }
]

function expandStudioDirection(styleName, customPrompt) {
    const safePrompt = sanitizeText(customPrompt, "", 700)

    if (!safePrompt) {
        return ""
    }

    const normalizedPrompt = safePrompt.toLowerCase()
    const normalizedStyle = sanitizeText(styleName, "", 80).toLowerCase()
    const expandedDirections = []

    studioDirectionExpansions.forEach(expansion => {
        if (expansion.patterns.some(pattern => pattern.test(normalizedPrompt))) {
            expandedDirections.push(expansion.direction)
        }
    })

    if (normalizedStyle === "superhero" && /\b(web|spider|red and blue|wall crawler)\b/.test(normalizedPrompt)) {
        expandedDirections.push(
            "Prioritize a spider-powered superhero concept with visible web-pattern suit detailing, expressive white eye lenses, energetic city action mood, and a heroic red-blue color palette."
        )
    }

    if (normalizedStyle === "superhero" && expandedDirections.length === 0) {
        expandedDirections.push(
            "Interpret the user direction as an original premium superhero design. Convert short names, colors, powers, materials, or mood words into visible costume details, lighting, pose, background, and cinematic action styling."
        )
    }

    if (expandedDirections.length > 0) {
        expandedDirections.push(
            "Important: use these as original inspired visual traits only. Do not copy protected logos, exact costumes, actor likenesses, studio trademarks, or branded symbols."
        )
    }

    return [
        `User studio shorthand: ${safePrompt}.`,
        ...expandedDirections,
        "Always convert shorthand into concrete visual details the image model can render: outfit, colors, materials, pose, lighting, background, camera style, atmosphere, and finish."
    ].join(" ")
}

function hasSpiderHeroDirection(direction) {
    return /\b(spider[\s-]?man|spiderman|spider hero|web hero|wall crawler|web pattern|web-pattern)\b/i
        .test(direction || "")
}

const styleAccuracyBoosts = {
    "ai avatar": `
AI AVATAR ACCURACY BOOST:

The result must look like a premium realistic AI avatar, not a plain filtered selfie.

Make these elements obvious:
- luxury profile-photo composition
- refined modern outfit
- clean premium background
- warm cinematic portrait lighting
- natural skin texture and sharp facial detail
- social-media avatar polish
- subtle depth of field

Avoid fantasy, superhero, cyberpunk, anime, cartoon, fake model face, and heavy skin smoothing.
`,

    headshot: `
HEADSHOT ACCURACY BOOST:

The result must look like a real professional studio headshot.

Make these elements obvious:
- chest-up or shoulders-up professional framing
- clean studio, office, or neutral background
- realistic formal or smart business clothing
- soft key light, catchlights in eyes, natural shadows
- high-resolution professional camera finish
- natural skin texture, realistic age, believable expression

Avoid fantasy, superhero, cyberpunk, cartoon/anime rendering, dramatic movie poster styling, and fake stock-photo face.
`,

    professional: `
PROFESSIONAL ACCURACY BOOST:

The result must look like a premium executive/business portrait.

Make these elements obvious:
- polished executive wardrobe or smart-casual business styling
- modern office, boardroom, studio, or luxury workspace background
- confident posture
- warm professional lighting
- premium LinkedIn or CEO portrait quality
- realistic camera depth and clean corporate atmosphere

Avoid costume looks, fantasy elements, superhero armor, cyberpunk neon, fake stock-photo face, and excessive beauty retouching.
`,

    fantasy: `
FANTASY ACCURACY BOOST:

The result must look like a live-action fantasy movie portrait, not a generic portrait.

Make these elements obvious:
- royal, noble, warrior, mage, or fantasy kingdom wardrobe
- premium embroidered fabric, leather, metal, cloak, jewelry, or crown-inspired details when suitable
- castle, throne room, ancient library, kingdom balcony, forest, or epic landscape background
- warm torchlight, magical atmosphere, cinematic shadows
- realistic live-action texture and skin

Avoid cartoon fantasy, anime, plastic skin, excessive glow on the face, random monster transformation, and changing the person's identity.
`,

    cyberpunk: `
CYBERPUNK ACCURACY BOOST:

The result must look like a realistic futuristic city portrait.

Make these elements obvious:
- futuristic jacket, techwear, sleek dark clothing, or premium sci-fi styling
- neon city lights, rainy reflections, holographic atmosphere, or advanced urban background
- blue, cyan, magenta, red, or violet light accents
- cinematic night mood and realistic skin reflections
- subtle high-tech details around outfit/background, not robotic face replacement

Avoid generic dark portrait, fantasy, anime/cartoon rendering, helmets/masks hiding identity, and extreme cybernetic face changes.
`,

    anime: `
ANIME ACCURACY BOOST:

The result must clearly become premium anime artwork.

Make these elements obvious:
- anime movie illustration style
- expressive anime eyes adapted from the person's real features
- clean linework or polished painterly anime shading
- cinematic animated lighting
- stylized hair/face while preserving recognizable identity
- elegant anime background or atmosphere

Avoid photorealistic portrait output, generic anime character replacement, child-like age changes, and losing the person's core facial structure.
`,

    cartoon: `
CARTOON ACCURACY BOOST:

The result must clearly become a premium 3D animated character.

Make these elements obvious:
- stylized animated face that still resembles the person
- expressive larger eyes and friendly proportions without becoming a caricature
- polished 3D materials and smooth cinematic cartoon lighting
- animated movie background or clean studio setting
- high-end character-render finish

Avoid photorealistic portrait output, cheap filter look, random cartoon character replacement, child-like age changes, and exaggerated distortions.
`
}

function getStudioDirectionPriorityRules(styleName, studioDirection) {
    const normalizedStyle = sanitizeText(styleName, "", 80).toLowerCase()
    const hasStudioDirection = Boolean(
        typeof studioDirection === "string" &&
        studioDirection.trim()
    )

    const creativeOverrideRule = hasStudioDirection
        ? `
USER STUDIO DIRECTION OVERRIDE:

The user's typed Studio Direction is the highest creative instruction after identity and safety.
If the selected style's default rules conflict with the user's Studio Direction, follow the user's Studio Direction.
Use the selected style only as a starting point.

The typed direction may override:
- outfit or costume
- background or scene
- lighting and mood
- colors and materials
- pose and camera style
- genre, such as superhero, royal, fantasy, cyberpunk, business, anime, cartoon, beach, office, fire, ice, or luxury

Do not let default style avoid-lists block the user's requested concept.
Only refuse or ignore parts that would hide the face, replace identity, conflict with the selected Gender Mode, create underage/sexual content, add text/logos/watermarks, or violate safety.
`
        : ""

    if (hasSpiderHeroDirection(studioDirection)) {
        return `
SPIDER-HERO ACCURACY BOOST:

The user specifically wants a spider-powered superhero result.

This must NOT become a generic superhero, soldier, cape hero, fantasy warrior, biker, or tactical armor portrait.

Make these details visually obvious:
- red and deep blue superhero bodysuit
- black web-pattern grid on torso, arms, and shoulders
- athletic agile silhouette, not bulky armor
- abstract spider-like chest mark without copying an exact protected logo
- wrist web-shooter details or visible web strands
- dynamic city action background
- crouching, leaping, wall-crawler, or rooftop superhero energy
- white eye-lens shapes may appear as a lifted mask, open-face cowl, hood detail, or suit motif while the real face stays visible

Keep the uploaded person's real face recognizable. If a full mask would hide the face, use a face-visible spider-hero adaptation instead.
${creativeOverrideRule}
`
    }

    if (normalizedStyle === "superhero" && studioDirection) {
        return `
CUSTOM SUPERHERO ACCURACY BOOST:

The user studio direction must visibly control the superhero design.
Translate short words, colors, powers, materials, and character archetypes into costume, pose, lighting, background, and effects.
Avoid generic tactical armor unless the user explicitly asks for it.
${creativeOverrideRule}
`
    }

    if (normalizedStyle === "superhero") {
        return `
BLOCKBUSTER SUPERHERO ACCURACY BOOST:

The default Superhero style must feel close to a premium modern comic-book movie universe.

${superheroVarietyRule}

Make these elements obvious:
- original face-visible superhero suit, not normal clothing
- sculpted chest armor or textured heroic fabric
- clear chest emblem, glowing core, or power symbol that is original and not a protected logo
- bold original color design, not plain black tactical gear
- premium suit seams, layered panels, shoulder structure, and cinematic materials
- visible superpower effect such as energy aura, lightning, cosmic glow, web-like motion, elemental effects, or advanced tech glow
- dramatic city, skyline, battle, rooftop, portal, or cinematic environment
- movie-poster lighting with strong rim light, sparks, smoke, and high-end color grading
- confident action posture adapted to the uploaded person's original gender presentation, not a simple passport/headshot pose

Do not create:
- soldier, SWAT, biker, police, leather jacket, casual jacket, gym outfit, or generic tactical vest
- cheap cosplay
- exact protected logos, exact named costumes, or actor likenesses
- Superman-style red cape, S logo, Kryptonian blue suit, or generic male cape hero unless directly requested by the user

Keep the uploaded person's real face, original gender presentation, age impression, and recognizable identity while changing the suit, power, background, and lighting.
`
    }

    const baseBoost = styleAccuracyBoosts[normalizedStyle] || ""

    if (baseBoost && studioDirection) {
        return `${baseBoost}

CUSTOM STYLE DIRECTION BOOST:

The user's Studio Direction must visibly affect this ${styleName} result.
Convert shorthand into concrete visible details for wardrobe, colors, materials, background, lighting, pose, camera style, mood, and final finish.
Do not ignore the Studio Direction unless it conflicts with identity preservation, face visibility, adult-only age rules, or safety.
${creativeOverrideRule}
`
    }

    return `${baseBoost}
${creativeOverrideRule}`.trim()
}

function cleanBase64(imageBase64) {
    if (!imageBase64 || typeof imageBase64 !== "string") {
        throw createHttpError("Missing or invalid imageBase64", 400, "INVALID_IMAGE")
    }

    const match = imageBase64.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i)
    const rawBase64 = match ? match[2] : imageBase64
    const normalized = rawBase64.replace(/\s/g, "")

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        throw createHttpError("imageBase64 is not valid base64 image data", 400, "INVALID_IMAGE")
    }

    const estimatedBytes = Math.floor((normalized.length * 3) / 4)

    if (estimatedBytes > MAX_IMAGE_BYTES) {
        throw createHttpError(
            `Image is too large. Maximum size is ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB.`,
            413,
            "IMAGE_TOO_LARGE"
        )
    }

    return normalized
}

async function uploadBase64Image(imageBase64, filename = "photo.jpg") {
    const imageBuffer = Buffer.from(cleanBase64(imageBase64), "base64")

    const form = new FormData()

    form.append("content", imageBuffer, {
        filename,
        contentType: "image/jpeg"
    })

    const response = await replicateClient.post(
        "/files",
        form,
        {
            headers: {
                ...form.getHeaders()
            }
        }
    )

    return response.data.urls.get
}

async function startPrediction(model, input) {
    if (!REPLICATE_TOKEN) {
        throw createHttpError("AI provider token is not configured", 503, "MISSING_PROVIDER_TOKEN")
    }

    const response = await replicateClient.post(
        `/models/${model}/predictions`,
        { input },
        {
            headers: {
                "Content-Type": "application/json"
            }
        }
    )

    return response.data.id
}

async function waitForPrediction(predictionId, label = "Prediction") {
    for (let i = 0; i < PREDICTION_MAX_ATTEMPTS; i++) {
        await new Promise(resolve => setTimeout(resolve, PREDICTION_POLL_INTERVAL_MS))

        const response = await replicateClient.get(`/predictions/${predictionId}`)

        const prediction = response.data

        console.log(`${label} status:`, prediction.status)

        if (prediction.status === "succeeded") {
            return Array.isArray(prediction.output)
                ? prediction.output[0]
                : prediction.output
        }

        if (prediction.status === "failed" || prediction.status === "canceled") {
            console.log(prediction)
            throw createHttpError(`${label} failed`, 502, "PROVIDER_FAILED")
        }
    }

    throw createHttpError(`${label} timeout`, 504, "PROVIDER_TIMEOUT")
}

function sendSuccess(res, req, payload = {}) {
    return res.json({
        success: true,
        error: null,
        requestId: req.requestId,
        ...payload
    })
}

function sendError(res, req, error, fallback = "AI request failed") {
    const statusCode = error.statusCode || error.response?.status || 500
    const providerError = error.response?.data?.detail || error.response?.data?.error
    const message = providerError || error.message || fallback

    console.log("Request error:", {
        requestId: req.requestId,
        statusCode,
        code: error.code,
        message,
        provider: error.response?.data
    })

    return res.status(statusCode).json({
        success: false,
        imageUrl: null,
        error: message,
        code: error.code || "AI_ERROR",
        requestId: req.requestId
    })
}

function getGenderRule(genderMode) {
    if (genderMode === "Female") {
        return `
GENDER MODE - FEMALE:
The requested output gender presentation is female.
Make the final portrait clearly female-presenting while preserving the uploaded person's recognizable identity.
Use natural feminine presentation through wardrobe, styling, grooming, hair styling when appropriate, softer presentation, and feminine portrait polish.
Do not add masculine beard, mustache, heavy masculine jaw styling, or male-presenting wardrobe unless the user specifically requests it.
Do not replace the person with a different woman, celebrity, model, or generic AI face.
`
    }

    if (genderMode === "Male") {
        return `
GENDER MODE - MALE:
The requested output gender presentation is male.
Make the final portrait clearly male-presenting while preserving the uploaded person's recognizable identity.
Use natural masculine presentation through wardrobe, styling, grooming, hair styling when appropriate, stronger masculine portrait polish, and believable facial presentation.
Facial hair may be kept, refined, reduced, or subtly added only when it looks natural and does not break identity.
Do not replace the person with a different man, celebrity, model, or generic AI face.
`
    }

    return `
GENDER MODE - AUTO:
Preserve the person's original gender presentation exactly as shown in the input image.
Do not feminize, masculinize, or change gender presentation unless the user's Studio Direction explicitly asks for compatible styling that does not replace identity.
`
}

const identityRule = `
Preserve the exact facial identity from the uploaded image.
Do not replace the person with another actor, celebrity, younger version, or generic AI face.
Keep the same gender, age, face shape, forehead, wrinkles, skin texture, eyes, nose, lips, cheeks, jawline, ears, hairstyle or baldness, beard if present, glasses if present, skin tone, and natural expression.
The final image must still look clearly like the same real person.
`

function getIdentityRuleForGenderMode(genderMode) {
    if (genderMode === "Female" || genderMode === "Male") {
        return `
Preserve the exact facial identity from the uploaded image while applying the selected ${genderMode} gender presentation.
Do not replace the person with another actor, celebrity, younger version, model, or generic AI face.
Keep the same core identity: age, face shape, forehead, wrinkles or skin texture, eyes, nose, lips, cheeks, jawline structure, ears, glasses if present, skin tone, and natural expression.
Allow only the gender-presentation changes needed for the selected ${genderMode} mode, such as wardrobe, grooming, hair styling, subtle facial presentation, and overall styling.
The final image must still look clearly like the same real person with the selected ${genderMode} presentation.
`
    }

    return identityRule
}

const ageStudioIdentityRule = `
Preserve the exact facial identity from the uploaded image while changing only visible adult age cues.
Do not replace the person with another actor, celebrity, generic AI face, or different identity.
Keep the same gender presentation, face shape, eyes, nose, lips, cheeks, jawline, ears, hairstyle or baldness pattern, beard pattern if present, glasses if present, skin tone, pose, and natural expression.
Do not preserve the original apparent age when an Age Target is selected. Change the visible adult age cues to match the requested target age.
The final image must still look clearly like the same real person at the requested adult age.
`

const superheroPrompts = [
`
Transform the same person into an original premium cinematic comic-book superhero, with the polish and scale of a modern blockbuster superhero universe.

The result must look like a real blockbuster superhero movie still.
The person must wear a premium superhero suit, not tactical military clothing, not casual clothing, not a street vigilante outfit.
Preserve the uploaded person's original gender presentation exactly. Do not masculinize a female-presenting person or feminize a male-presenting person.
The face must be fully visible and recognizable. No full mask, no helmet, no visor, no sunglasses, no hidden face.

Suit design:
Advanced cinematic superhero armor and fabric, original heroic silhouette, layered futuristic panels, abstract original chest emblem, detailed suit seams, premium textured materials, bold color language when suitable, original high-end comic-book movie costume realism.

Powers:
Cinematic energy aura, controlled glowing particles, realistic VFX, visible superpower identity, powerful heroic presence, dramatic environmental reflections.

Environment:
Epic futuristic city skyline, atmospheric smoke, dramatic sky, blockbuster movie scale, cinematic destruction in the distance.

Lighting:
Premium cinematic lighting, strong key light, realistic shadows, heroic glow, IMAX-style movie color grading.

Face rule:
The face and gender presentation must remain extremely close to the uploaded person. Change the suit, power, and environment more than the face.
Use an open-face superhero design, face-framing cowl, lifted mask, or no mask.
Avoid Superman-style output unless the user explicitly requested it: no red cape, no S shield, no Kryptonian blue suit, no Clark Kent/actor likeness.
`,

`
Reimagine the same person as an iconic original cinematic superhero standing in a large-scale comic-book movie battle scene.

The outfit must look like a real superhero costume from a premium comic-book movie:
sleek armored chest plate, original shoulder structure, abstract chest emblem or power symbol, glowing energy details, luxury textured materials, sharp cinematic silhouette, high-end superhero design.

Do not make the outfit look like a soldier, police, SWAT, biker, or tactical vest.
It must feel superhuman, powerful, and iconic.

Preserve the real face strongly.
Keep the same gender presentation, age, wrinkles, forehead, nose, eyes, lips, jawline, beard or baldness if present.
The final result must look like the same person wearing a superhero suit.
The face must be uncovered, well-lit, and readable. Do not use a full mask, helmet, visor, or sunglasses.
Avoid default Superman styling unless directly requested: no red cape, no S chest symbol, no exact blue-and-red Kryptonian costume, no actor likeness.
`,

`
Create a premium live-action superhero movie poster of the same person.

The person should look like a central original comic-book blockbuster hero:
heroic armored suit, clear original power-themed emblem, glowing energy reactor or power source if suitable, advanced suit panels, cinematic energy effects, premium blockbuster composition.

Make the scene visually spectacular:
futuristic city, smoke, sparks, energy waves, dramatic sky, strong movie lighting.

Identity lock:
Do not make the person younger.
Do not beautify the face heavily.
Do not change facial proportions.
Do not replace the face with a fake actor face.
Keep the original person's real facial identity and gender presentation highly recognizable.
The superhero portrait must show the full face clearly. No full mask, no helmet, no visor, no face-covering cowl.
Do not turn the result into Superman unless the user explicitly requested Superman: no red cape, no S logo, no Kryptonian suit, no celebrity superhero face.
`
]

const aiAvatarPrompts = [
`
Using the uploaded image as the identity reference, transform the same person into a realistic premium AI avatar portrait.

IMPORTANT: ${identityRule}
Preserve the exact same face, age, wrinkles, skin texture, baldness or hairstyle, beard if present, eyes, nose, lips, jawline, cheeks, forehead, facial proportions, and natural expression.

Style:
Premium realistic AI avatar, luxury social-media portrait, elegant modern outfit, clean high-end background, warm cinematic lighting, soft depth of field, natural skin texture, professional camera realism.

Rules:
No purple neon.
No cyberpunk.
No fantasy glow.
No superhero suit.
No fake actor face.
No younger version.
No heavy beauty smoothing.
The final image must look like the same real person, upgraded into a premium realistic avatar.
`,

`
Create a high-end realistic AI portrait of the same person from the uploaded image.

IMPORTANT: ${identityRule}
Keep the face highly recognizable. Preserve age, skin texture, wrinkles, forehead lines, eye bags, hairstyle or baldness, beard if present, facial structure, nose shape, lips, cheeks, jawline, and expression.

Style:
Luxury personal-brand portrait, refined modern clothing, realistic warm lighting, clean elegant background, premium camera depth of field, natural skin tones, sharp professional detail.

Rules:
Do not change the person into a model.
Do not make the person younger.
Do not over-smooth the skin.
Do not change hairline or beard.
Do not add sci-fi, cyberpunk, superhero, fantasy, or neon effects.
Only upgrade lighting, outfit, background, and overall premium quality.
`,

`
Transform this person into a luxury realistic social-media AI avatar.

IMPORTANT: ${identityRule}
The uploaded person must remain clearly the same real person. Preserve natural face shape, real age, wrinkles, skin pores, baldness or hairstyle, beard if present, eyes, nose, lips, jawline, cheeks, and natural expression.

Style:
Premium lifestyle avatar, elegant outfit, realistic cinematic photography, warm natural light, soft blurred background, clean luxury atmosphere, high-end portrait finish, social-media profile quality.

Rules:
Keep the identity strong.
Keep the face realistic.
Keep natural imperfections.
Avoid fake beauty enhancement.
Avoid actor-like replacement.
Avoid purple neon, cyberpunk, fantasy glow, superhero costume, cartoon style, or anime style.
`
]

const headshotPrompts = [
`
Using the uploaded image as the identity reference, create a realistic premium studio headshot of the same person.

IMPORTANT: ${identityRule}
Preserve the exact same real face, age, wrinkles, skin texture, forehead, eye bags, baldness or hairstyle, beard if present, jawline, cheeks, eyes, nose, lips, facial proportions, and natural expression.

Style:
Luxury studio headshot, clean professional background, premium camera realism, soft cinematic studio lighting, elegant formal clothing, natural skin texture, realistic depth of field, LinkedIn-quality photography.

Rules:
Do not make the person younger.
Do not heavily beautify the face.
Do not over-smooth skin.
Do not change facial structure.
Do not create a fake actor or model face.
The final image must look like the same real person captured in a premium professional studio.
`,

`
Create a luxury executive headshot of the same person from the uploaded image.

IMPORTANT: ${identityRule}
Keep the face highly recognizable. Preserve natural aging, wrinkles, skin texture, hairstyle or baldness, beard if present, forehead shape, nose, lips, cheeks, jawline, and expression.

Style:
High-end executive portrait, elegant business clothing, realistic office or studio background blur, warm professional lighting, premium portrait photography, cinematic camera depth, realistic skin tones.

Rules:
No unrealistic beauty enhancement.
No face replacement.
No artificial symmetry.
No fantasy effects.
No cyberpunk lighting.
No superhero styling.
Upgrade only the lighting, outfit, background, and overall premium photography quality.
`,

`
Transform the uploaded person into a premium high-end business profile portrait.

IMPORTANT: ${identityRule}
Preserve exact facial identity, age, wrinkles, skin detail, baldness or hairstyle, beard if present, face shape, eyes, nose, lips, cheeks, jawline, and natural expression.

Style:
Refined corporate portrait, premium studio lighting, elegant formal styling, clean luxury background, realistic professional photography, sharp portrait detail, believable executive atmosphere.

Rules:
Keep the face realistic and natural.
Do not make the person look like a different actor.
Do not heavily retouch the skin.
Do not dramatically change facial proportions.
The final image should feel like a real premium business photoshoot of the same person.
`
]

const professionalPrompts = [
`
Using the uploaded image as the identity reference, transform the same person into a premium executive portrait.

IMPORTANT: ${identityRule}
Preserve the exact same real face, age, wrinkles, skin texture, forehead, eye bags, hairstyle or baldness, beard if present, cheeks, jawline, eyes, nose, lips, facial proportions, and natural expression.

Style:
Luxury executive business portrait, elegant business suit or polished executive wardrobe, premium office or glass-boardroom background blur, cinematic professional lighting, realistic skin tones, refined corporate atmosphere, high-end LinkedIn-quality photography, premium camera depth of field.

Rules:
The result must clearly read as a premium business portrait.
Do not make it a casual lifestyle portrait or generic social-media portrait.
Do not make the person younger.
Do not heavily beautify the face.
Do not over-smooth skin.
Do not change facial structure.
Do not replace the person with a fake actor or model.
The final image must clearly look like the same real person in a premium executive photoshoot.
`,

`
Create a luxury CEO-style portrait of the uploaded person.

IMPORTANT: ${identityRule}
Keep the face highly recognizable. Preserve natural aging, wrinkles, skin texture, hairstyle or baldness, beard if present, forehead shape, eyes, nose, lips, cheeks, jawline, and natural expression.

Style:
High-end CEO portrait, refined formal clothing, elegant executive office atmosphere, glass walls, desk or boardroom depth, warm professional lighting, premium camera realism, cinematic depth of field, luxury business environment, believable executive photography.

Rules:
The result must look like a premium executive/business photoshoot.
Include clear business wardrobe and corporate environment cues.
No fake actor face.
No unrealistic beauty enhancement.
No artificial symmetry.
No fantasy effects.
No superhero styling.
No cyberpunk lighting.
Upgrade only the outfit, lighting, environment, and premium visual quality while preserving the real identity.
`,

`
Transform the uploaded person into a premium modern entrepreneur portrait.

IMPORTANT: ${identityRule}
Preserve exact facial identity, age, wrinkles, skin texture, baldness or hairstyle, beard if present, facial structure, jawline, cheeks, eyes, nose, lips, and natural expression.

Style:
Modern entrepreneur business aesthetic, elegant smart-casual business styling, blazer, tailored shirt, refined executive wardrobe, luxury minimal office or studio background, realistic cinematic lighting, premium personal-brand photography quality, warm natural tones, clean high-end business portrait atmosphere.

Rules:
The result must still look professional and business-focused.
Do not make it casual, fantasy, fashion-only, cyberpunk, superhero, anime, or cartoon.
Keep the face realistic and natural.
Do not heavily retouch the skin.
Do not make the person look younger.
Do not dramatically change facial proportions.
Do not replace the face with a different attractive AI person.
The final result should feel like a real premium entrepreneur photoshoot of the same person.
`
]

const fantasyPrompts = [
`
Using the uploaded image as the identity reference, transform the same person into a realistic magical fantasy movie portrait.

IMPORTANT: ${identityRule}
Preserve the exact same real face, age, wrinkles, skin texture, forehead, eye bags, hairstyle or baldness, beard if present, jawline, cheeks, eyes, nose, lips, facial proportions, and natural expression.

Style:
Elegant magical fantasy portrait, luxurious medieval-inspired clothing, noble ruler, royal mage, enchanted warrior, or fantasy kingdom aesthetic, premium embroidered fabrics, subtle magical jewelry or cloak details, cinematic castle environment, warm golden lighting, realistic shadows, atmospheric depth, high-end fantasy movie photography.

Environment:
Luxury royal hall, elegant throne room, cinematic castle interior, candles, warm ambient glow, enchanted particles, magical window light, premium fantasy atmosphere.

Rules:
Do not turn the person into a different fantasy character.
Do not make the person younger.
Do not heavily beautify the face.
Do not create glowing magical skin, but do include visible magical atmosphere around the person.
Do not create cartoon or anime style.
Keep the portrait realistic, cinematic, and highly recognizable as the same real person.
`,

`
Create a grounded cinematic magical noble portrait of the uploaded person.

IMPORTANT: ${identityRule}
Keep the face highly recognizable. Preserve natural aging, wrinkles, skin texture, hairstyle or baldness, beard if present, facial structure, jawline, cheeks, eyes, nose, lips, and natural expression.

Style:
Classic noble fantasy aesthetic, elegant royal or mage clothing, luxury fabrics, subtle runes or enchanted accessories, cinematic warm lighting, realistic medieval-inspired environment, premium fantasy movie photography, natural shadows, realistic skin detail, believable magical realism.

Environment:
Elegant palace interior, ancient magical library, noble hall, warm firelight atmosphere, floating dust or subtle glowing particles, luxury architectural details, cinematic depth of field.

Rules:
No fake actor face.
No unrealistic beauty enhancement.
Use visible but controlled fantasy magic. Avoid only excessive glow on the face.
No superhero styling.
No cyberpunk lighting.
No cartoon rendering.
Upgrade only the clothing, environment, and cinematic atmosphere while preserving the same real identity.
`,

`
Transform the uploaded person into a premium fantasy kingdom portrait.

IMPORTANT: ${identityRule}
Preserve exact facial identity, age, wrinkles, skin detail, baldness or hairstyle, beard if present, face shape, jawline, cheeks, eyes, nose, lips, and natural expression.

Style:
Epic fantasy movie realism, royal warrior, noble ruler, battle mage, or enchanted guardian aesthetic, luxurious fantasy clothing or elegant armor, magical aura around hands or background, cinematic dramatic lighting, realistic textures, premium blockbuster fantasy photography, elegant atmosphere, believable medieval realism.

Environment:
Grand fantasy castle balcony, misty royal kingdom background, cinematic sky, magical clouds or portal glow, elegant architectural details, atmospheric lighting.

Rules:
Keep the face realistic and natural.
Do not dramatically change facial proportions.
Do not replace the person with a younger or more attractive AI character.
Avoid cartoon fantasy styling.
Use magical effects clearly, but keep them tasteful and away from changing the face.
The final image should feel like a real live-action fantasy movie portrait of the same person.
`
]

const cyberpunkPrompts = [
`
Using the uploaded image as the identity reference, transform the same person into a realistic futuristic cyberpunk city portrait.

IMPORTANT: ${identityRule}
Preserve the exact same real face, age, wrinkles, skin texture, forehead, eye bags, hairstyle or baldness, beard if present, jawline, cheeks, eyes, nose, lips, facial proportions, and natural expression.

Style:
Premium neon cyberpunk portrait, futuristic techwear clothing, cinematic night city background, strong cyan and magenta neon reflections, holographic signs, high-tech urban atmosphere, rain-slick streets, wet pavement reflections, glowing rim light, premium camera depth of field, realistic skin tones.

Rules:
The result must clearly show a neon cyberpunk city mood.
Do not make it a normal dark portrait.
Do not replace the face.
Do not make the person younger.
Do not over-smooth skin.
Do not add robotic face parts.
Do not cover the face with masks or helmets.
Keep the final image realistic, cinematic, and clearly recognizable.
`,

`
Create a believable modern tech-style AI portrait of the uploaded person.

IMPORTANT: ${identityRule}
Keep the face highly recognizable. Preserve natural aging, wrinkles, skin texture, hairstyle or baldness, beard if present, face shape, jawline, eyes, nose, lips, cheeks, and natural expression.

Style:
Sleek futuristic outfit, premium neon urban background, visible cyan/magenta city lights, holographic panels, realistic cinematic photography, clear high-tech atmosphere, reflective materials, elegant dark styling with colored neon rim light, natural skin texture, professional portrait realism.

Rules:
The neon futuristic environment must be obvious.
Do not make the scene plain, neutral, or only slightly futuristic.
No fake actor face.
No heavy beauty enhancement.
No extreme cybernetic changes.
No anime or cartoon style.
No superhero suit.
Upgrade only the clothing, lighting, background, and futuristic mood while preserving the same real identity.
`,

`
Transform the uploaded person into a premium futuristic night-city portrait.

IMPORTANT: ${identityRule}
Preserve exact facial identity, age, wrinkles, skin detail, baldness or hairstyle, beard if present, cheeks, jawline, eyes, nose, lips, and expression.

Style:
Luxury cyberpunk realism, cinematic neon skyline, elegant futuristic jacket, bright cyan and magenta rim lights, realistic rain reflections, holographic billboards, moody urban lighting, premium sci-fi atmosphere, sharp professional portrait detail, high-end movie color grading.

Rules:
The result must clearly read as neon cyberpunk.
Keep the person human and realistic.
Do not create a robot face.
Do not change facial proportions.
Do not replace the person with a younger attractive AI model.
Do not hide the face behind goggles, helmets, or heavy shadows.
The result should feel like a real cinematic photo of the same person in a futuristic city.
`
]

const animePrompts = [
`
Using the uploaded image as the identity reference, transform the same person into a premium cinematic anime character.

IMPORTANT: ${identityRule}
Preserve the same recognizable identity, age, face shape, hairstyle or baldness, beard if present, skin tone, eyes, nose, lips, jawline, cheeks, and natural expression while converting the person into polished anime style.

Style:
Premium anime movie portrait rendering.
The output must look like polished anime artwork, not a realistic photo filter.
Use clean linework or painterly anime line definition, expressive anime eyes adapted from the real eyes, stylized anime nose and mouth, refined anime hair shapes, smooth cel-shading plus soft cinematic gradients, elegant background atmosphere, and high-end animated film quality.

Rules:
The result must be unmistakably anime.
Do not leave the output photorealistic.
Do not create a 3D cartoon, western cartoon, sketch, comic filter, or cheap app filter.
Do not turn the person into a completely different anime character.
Do not make the person much younger.
Do not change gender.
Do not remove baldness or beard if present.
Do not create a generic anime face.
The final result must look like an anime version of the same real person.
`,

`
Create a high-end anime hero portrait of the uploaded person.

IMPORTANT: ${identityRule}
Keep the same real identity strongly visible. Preserve age, facial proportions, face shape, hairstyle or baldness, beard if present, skin tone, eyes, nose, lips, jawline, cheeks, and expression.

Style:
Premium anime hero portrait, cinematic anime lighting, polished illustration quality, clean anime linework, detailed animated facial features, expressive anime eyes, elegant heroic outfit, soft atmospheric background, modern anime film realism.

Rules:
The image must read as high-end anime artwork immediately.
Do not leave realistic skin/photo texture as the main rendering style.
Do not create 3D cartoon, photorealistic portrait, or western animation style.
Keep the person recognizable.
Avoid generic anime beauty face.
Avoid changing facial structure too much.
Avoid making the person look like a teenager.
Avoid replacing the person with a fictional anime character.
`,

`
Transform the uploaded person into a luxury anime avatar portrait.

IMPORTANT: ${identityRule}
Preserve the original person's identity while anime-stylizing the face. Keep the same age impression, hairstyle or baldness, beard if present, face shape, eyes, nose, lips, jawline, cheeks, skin tone, and natural expression.

Style:
High-end anime avatar, clean cinematic shading, expressive anime eyes, premium anime artwork, refined linework, stylized hair and facial features, elegant lighting, refined outfit styling, soft depth background, polished animated portrait quality.

Rules:
The result must be clearly anime.
Do not leave the image photorealistic or only slightly stylized.
Do not create 3D cartoon, comic sketch, oil painting, or cheap filter-art.
The result must still resemble the uploaded person.
Do not over-beautify.
Do not create a random anime model.
Do not erase important identity features.
`
]

const cartoonPrompts = [
`
Using the uploaded image as the identity reference, transform the same person into a premium 3D animated movie character.

IMPORTANT: ${identityRule}
Preserve the same recognizable identity, age, face shape, hairstyle or baldness, beard if present, eyes, nose, lips, jawline, cheeks, skin tone, and natural expression while converting the person into polished animated style.

Style:
Premium 3D animated feature-film character rendering.
The output must look like a fully modeled 3D character, not a photo filter.
Use rounded stylized 3D facial forms, expressive animated eyes adapted from the real eyes, soft subsurface animated skin material, sculpted hair or stylized hair strands, clean geometry, smooth premium shaders, cinematic global illumination, rim light, depth of field, and blockbuster animation quality.

Rules:
The result must clearly look like a premium 3D animated character.
Do not leave the result photorealistic.
Do not create a flat 2D drawing, sketch, comic filter, oil painting, anime, or cheap cartoon filter.
Do not create a completely different cartoon character.
Do not remove important identity features.
Do not make the person look much younger.
Do not exaggerate facial proportions too much.
The final image should feel like a premium animated movie version of the same real person.
`,

`
Create a luxury modern cartoon avatar of the uploaded person.

IMPORTANT: ${identityRule}
Keep the face highly recognizable. Preserve natural age impression, hairstyle or baldness, beard if present, face structure, eyes, nose, lips, cheeks, jawline, and expression.

Style:
Premium 3D cartoon avatar with visible 3D shape and depth.
Use polished animated skin, stylized but recognizable face anatomy, expressive larger eyes, clean sculpted cheeks and jawline, stylized hair, soft studio-quality 3D lighting, smooth materials, and modern animated movie realism.

Rules:
The output must look rendered in 3D with premium animated materials.
Do not leave it as a realistic portrait with slight smoothing.
Do not create 2D anime, flat illustration, sketch, or filter-art.
Avoid generic cartoon faces.
Avoid turning the person into a child-like character.
Avoid extreme caricature distortion.
Avoid changing gender or identity.
The result should feel like a believable luxury animated version of the same person.
`,

`
Transform the uploaded person into a premium cinematic animated portrait.

IMPORTANT: ${identityRule}
Preserve the exact facial identity while applying stylized cartoon rendering. Keep the same age, face shape, hairstyle or baldness, beard if present, eyes, nose, lips, jawline, cheeks, and natural expression.

Style:
Blockbuster 3D animated film aesthetic, premium cartoon realism, elegant cinematic lighting, expressive animated features, polished textures, stylized 3D hair, soft animated skin shading, luxury color grading, and modern animation studio quality.

Rules:
The final image must be obviously 3D animated, with depth, shaders, and sculpted character forms.
Keep the character recognizable as the uploaded person.
Do not over-simplify the face.
Do not create unrealistic cartoon proportions.
Do not replace the identity with a random animated character.
Do not output a photorealistic portrait, 2D illustration, anime image, cheap app filter, or plastic-looking face.
The final image should look like a high-budget animated adaptation of the same real person.
`
]

const ageStudioPrompts = [
`
Create a premium realistic age-transformation portrait of the uploaded person.

IMPORTANT: ${ageStudioIdentityRule}

Style:
Clean high-end portrait photography, natural studio lighting, visible face detail, realistic skin texture, balanced color grading, tasteful wardrobe, and a clear premium background.

Rules:
Change only adult age cues such as skin texture, facial maturity, subtle lines, hair tone, and overall age impression.
Do not change identity, gender presentation, pose, expression, body shape, or clothing style more than necessary.
Do not make the person a child, teenager, minor, or under 18.
`,

`
Generate a realistic before-after style age edit as a single polished portrait of the same person at the requested adult age.

IMPORTANT: ${ageStudioIdentityRule}

Style:
Premium editorial portrait, clear well-lit face, realistic aging details, natural hair and skin changes, clean background, sharp eyes, and professional camera depth.

Rules:
The result must feel believable and natural, not a caricature.
Do not exaggerate wrinkles, facial sagging, hair loss, or age marks.
Do not beautify into a different person.
Do not make the person younger than an adult.
`,

`
Transform the uploaded person into a believable adult age-adjusted portrait while keeping the same identity.

IMPORTANT: ${ageStudioIdentityRule}

Style:
Modern studio portrait with bright premium lighting, realistic skin pores, natural shadows, clean wardrobe, soft depth of field, and subtle color warmth.

Rules:
Age adjustment should be visible but respectful and realistic.
Keep the face recognizable.
Avoid fantasy styling, anime/cartoon rendering, masks, sunglasses, text, logos, and heavy dark lighting.
Never create a child-like or underage version.
`
]

const superheroVarietyRule = `
SUPERHERO VARIETY SYSTEM:

Do not default to one generic cape hero.
Choose one original cinematic hero archetype that fits the uploaded person and selected variation, then build a premium face-visible design around it.

Allowed original archetype directions include:
- spider-powered agile web hero
- armored tech hero
- thunder or storm warrior
- super-strength hero
- patriotic shield-inspired leader
- sleek panther-inspired agile hero
- mystic portal sorcerer
- chaos-magic energy hero
- synthetic android tech hero
- elite spy hero
- archer or marksman hero
- cosmic photon hero
- size-shifting quantum tech hero
- winged micro-tech hero
- moonlit vigilante
- vampire-hunter antihero
- red urban vigilante
- elastic science hero
- force-field hero
- flame-powered hero
- stone-strength hero
- silver cosmic traveler
- space-outlaw guardian
- space-warrior guardian
- nature guardian
- symbiote-inspired dark hero with real face visible
- weather-commanding hero
- optic-energy hero
- telekinetic cosmic-energy hero
- mutant team hero

The design must be original. Do not copy exact Marvel, DC, or other protected costumes, logos, chest symbols, masks, actor likenesses, or character faces.
Keep the uploaded person's real face visible, identity recognizable, and original gender presentation unless the user selected another Gender Mode.
`

function getPromptSet(styleName) {

    if (!styleName || typeof styleName !== "string") {
        return aiAvatarPrompts
    }

    const normalizedStyle = styleName
        .trim()
        .toLowerCase()

    const promptMap = {

        superhero: superheroPrompts,

        "ai avatar": aiAvatarPrompts,
        aiavatar: aiAvatarPrompts,
        avatar: aiAvatarPrompts,

        headshot: headshotPrompts,

        professional: professionalPrompts,
        business: professionalPrompts,
        executive: professionalPrompts,

        fantasy: fantasyPrompts,

        cyberpunk: cyberpunkPrompts,
        futuristic: cyberpunkPrompts,

        anime: animePrompts,

        cartoon: cartoonPrompts,
        animated: cartoonPrompts,

        "age studio": ageStudioPrompts,
        age: ageStudioPrompts,
        aging: ageStudioPrompts
    }

    const selectedPrompts =
        promptMap[normalizedStyle]

    if (
        Array.isArray(selectedPrompts) &&
        selectedPrompts.length > 0
    ) {
        return selectedPrompts
    }

    console.log(
        `Unknown styleName "${styleName}", using AI Avatar fallback`
    )

    return aiAvatarPrompts
}

function getPromptByVariation(styleName, variation) {

    const prompts = getPromptSet(styleName)

    if (
        !Array.isArray(prompts) ||
        prompts.length === 0
    ) {
        console.warn(
            `No prompts found for style "${styleName}". Falling back to AI Avatar prompts.`
        )

        return pickRandom(aiAvatarPrompts)
    }

    const normalizedVariation =
        typeof variation === "string"
            ? variation.trim().toLowerCase()
            : ""

    const variationMap = {
        "variation 1": 0,
        "variation 2": 1,
        "variation 3": 2,
        "variation 4": 3,
        "variation 5": 4
    }

    const selectedIndex =
        variationMap[normalizedVariation]

    if (
        selectedIndex !== undefined &&
        prompts[selectedIndex]
    ) {
        return prompts[selectedIndex]
    }

    if (
        normalizedVariation === "random" ||
        normalizedVariation === "" ||
        normalizedVariation === "auto"
    ) {
        return pickRandom(prompts)
    }

    console.warn(
        `Unknown variation "${variation}" for style "${styleName}". Using random prompt.`
    )

    return pickRandom(prompts)
}

function getVariationText(variation) {
    const normalizedVariation =
        typeof variation === "string"
            ? variation.trim().toLowerCase()
            : "random"

    const variationMap = {
        "variation 1": `
PACK VARIATION - 1:
Use the clean hero portrait version of this style.
Favor a centered face-visible composition, polished studio-quality lighting, balanced background detail, and a clear premium app-result finish.
Keep the result direct, readable, and identity-focused.
`,

        "variation 2": `
PACK VARIATION - 2:
Use the editorial environment version of this style.
Favor a more designed outfit, richer location or background depth, tasteful camera angle, and magazine-quality visual polish.
Keep the face visible and recognizable while making the scene feel more produced.
`,

        "variation 3": `
PACK VARIATION - 3:
Use the cinematic dramatic version of this style.
Favor stronger lighting, more atmosphere, deeper depth of field, bolder color grading, and a more expressive premium composition.
Keep identity and face clarity stronger than the drama.
`
    }

    if (variationMap[normalizedVariation]) {
        return variationMap[normalizedVariation]
    }

    return `
PACK VARIATION - RANDOM:
Use one coherent variation from the selected style pack.
Make the result feel intentionally chosen, not generic: vary composition, outfit polish, background depth, lighting shape, and camera feel while preserving identity.
`
}

function getSuperheroVariationText(variation) {
    const normalizedVariation =
        typeof variation === "string"
            ? variation.trim().toLowerCase()
            : "random"

    const variationMap = {
        "variation 1": `
SUPERHERO PACK VARIATION - AGILE / TECH:
Prefer an original spider-powered, armored tech, archer, spy, quantum, winged micro-tech, red vigilante, or optic-energy hero direction.
Use a face-visible suit with athletic movement, detailed materials, and modern city action energy.
`,

        "variation 2": `
SUPERHERO PACK VARIATION - POWER / COSMIC:
Prefer an original thunder, storm, super-strength, cosmic photon, flame, stone-strength, silver cosmic traveler, or telekinetic energy hero direction.
Use dramatic power effects, sky or space atmosphere, and blockbuster scale while keeping the face recognizable.
`,

        "variation 3": `
SUPERHERO PACK VARIATION - MYSTIC / TEAM HERO:
Prefer an original mystic portal, chaos-magic, synthetic android, panther-inspired, patriotic shield, moonlit vigilante, vampire-hunter, nature guardian, space guardian, or mutant team hero direction.
Use a distinctive costume language, cinematic environment, and clear original power identity.
`
    }

    return variationMap[normalizedVariation] || `
SUPERHERO PACK VARIATION - RANDOM HERO TYPE:
Randomly choose one original hero archetype from the full superhero variety system.
Avoid repeating the same default cape hero look. Make the chosen power identity obvious through suit design, lighting, pose, and background.
`
}

function getStyleVariationText(styleName, variation) {
    const normalizedStyle = sanitizeText(styleName, "", 80).toLowerCase()
    const normalizedVariation =
        typeof variation === "string"
            ? variation.trim().toLowerCase()
            : "random"

    const styleVariationMap = {
        "ai avatar": {
            "variation 1": "AI Avatar Variation 1 must be a clean premium studio avatar: close portrait framing, elegant modern outfit, bright studio depth, soft polished light, minimal background clutter.",
            "variation 2": "AI Avatar Variation 2 must be a luxury lifestyle avatar: richer environment, designed wardrobe, editorial camera depth, premium interior or city background.",
            "variation 3": "AI Avatar Variation 3 must be a futuristic premium avatar: sleek high-end styling, subtle tech atmosphere, reflective materials, bolder color accents, still realistic."
        },
        headshot: {
            "variation 1": "Headshot Variation 1 must be a classic professional studio headshot: clean neutral background, shoulder-up framing, crisp business profile look.",
            "variation 2": "Headshot Variation 2 must be an office/environmental headshot: modern workplace depth, natural professional posture, realistic business setting.",
            "variation 3": "Headshot Variation 3 must be an executive editorial headshot: more premium lighting, stronger camera depth, refined wardrobe, polished leadership presence."
        },
        professional: {
            "variation 1": "Professional Variation 1 must be a clean executive portrait: formal wardrobe, neutral premium studio or office background, confident direct posture.",
            "variation 2": "Professional Variation 2 must be a corporate lifestyle portrait: modern office, glass, city, desk, or boardroom depth with business atmosphere.",
            "variation 3": "Professional Variation 3 must be a luxury business editorial: high-end wardrobe, dramatic but bright lighting, premium magazine-style corporate finish."
        },
        fantasy: {
            "variation 1": "Fantasy Variation 1 must be royal palace fantasy: noble wardrobe, palace or castle interior, warm regal lighting, elegant royal atmosphere.",
            "variation 2": "Fantasy Variation 2 must be enchanted nature fantasy: forest, magical garden, ancient ruins, soft glowing atmosphere, live-action fantasy realism.",
            "variation 3": "Fantasy Variation 3 must be epic battle-mage fantasy: dramatic sky, armor or robe details, magical energy, cinematic adventure-poster composition."
        },
        cyberpunk: {
            "variation 1": "Cyberpunk Variation 1 must be neon street portrait: rainy city reflections, cyan and magenta signs, futuristic jacket, face clearly lit.",
            "variation 2": "Cyberpunk Variation 2 must be high-tech interior portrait: holographic panels, sleek lab or lounge, refined sci-fi wardrobe, controlled lighting.",
            "variation 3": "Cyberpunk Variation 3 must be rooftop action cyberpunk: skyline, rain, stronger neon rim light, dynamic pose, cinematic sci-fi atmosphere."
        },
        anime: {
            "variation 1": "Anime Variation 1 must be a clean anime portrait: polished face-focused anime rendering, simple elegant background, recognizable features.",
            "variation 2": "Anime Variation 2 must be an anime scene portrait: city, school, fantasy, or cinematic environment behind the person with richer atmosphere.",
            "variation 3": "Anime Variation 3 must be an anime movie poster: dramatic lighting, stronger stylized effects, expressive composition, premium action-poster finish."
        },
        cartoon: {
            "variation 1": "Cartoon Variation 1 must be a clean premium 3D character portrait: simple studio setting, friendly expression, polished animated materials.",
            "variation 2": "Cartoon Variation 2 must be an animated adventure scene: richer environment, playful cinematic background, character-story atmosphere.",
            "variation 3": "Cartoon Variation 3 must be a high-energy animated movie poster: expressive pose, bolder lighting, colorful scene depth, premium character finish."
        },
        superhero: {
            "variation 1": "Superhero Variation 1 must use the agile or tech hero family: spider-powered, armored tech, archer, spy, quantum, winged micro-tech, or optic-energy direction.",
            "variation 2": "Superhero Variation 2 must use the power or cosmic hero family: thunder, storm, super-strength, cosmic photon, flame, stone-strength, silver cosmic traveler, or telekinetic energy direction.",
            "variation 3": "Superhero Variation 3 must use the mystic or team hero family: mystic portal, chaos magic, synthetic android, panther-inspired, shield leader, moonlit vigilante, nature guardian, space guardian, or mutant team direction."
        },
        "age studio": {
            "variation 1": "Age Studio Variation 1 must keep a clean realistic portrait format while applying the selected age target.",
            "variation 2": "Age Studio Variation 2 must use a natural lifestyle portrait format while applying the selected age target.",
            "variation 3": "Age Studio Variation 3 must use a polished editorial portrait format while applying the selected age target."
        }
    }

    const styleMap = styleVariationMap[normalizedStyle] || {}
    const selected = styleMap[normalizedVariation]

    if (selected) {
        return `
STYLE-SPECIFIC PACK VARIATION:
${selected}
This variation choice is mandatory and must visibly change composition, environment, wardrobe feel, lighting, or hero/style archetype from the other variations.
`
    }

    return `
STYLE-SPECIFIC PACK VARIATION:
Random must choose one clear variation direction for "${styleName}" and commit to it visibly.
Do not make Random look identical to Variation 1, Variation 2, and Variation 3.
`
}

function getControlPriorityText({ styleName, mood, strength, variation }) {
    const normalizedMood = sanitizeText(mood, "Natural", 80).toLowerCase()
    const normalizedStrength = sanitizeText(strength, "Balanced", 80).toLowerCase()
    const normalizedVariation = sanitizeText(variation, "Random", 80).toLowerCase()

    const moodDirective = {
        natural: "Prompt Intelligence Natural: bright, clean, open, realistic, clear face light, fresh color, not dramatic or dark.",
        serious: "Prompt Intelligence Serious: confident, focused, mature, controlled contrast, less smiling, more professional intensity.",
        luxury: "Prompt Intelligence Luxury: expensive wardrobe/materials, refined background, warm premium lighting, high-end editorial polish."
    }[normalizedMood] || "Prompt Intelligence Natural: bright, clean, open, realistic, clear face light, fresh color."

    const strengthDirective = {
        accurate: "AI Strength Accurate Face: preserve the uploaded face and identity first; change mainly outfit, background, lighting, and finish.",
        balanced: "AI Strength Balanced: preserve identity while allowing clear style, outfit, lighting, and environment transformation.",
        extreme: "AI Strength Extreme Style: make the selected style visibly stronger with bolder wardrobe, environment, effects, and composition while keeping the face recognizable."
    }[normalizedStrength] || "AI Strength Balanced: preserve identity while allowing clear style transformation."

    const variationDirective = {
        "variation 1": "Pack Variation 1: use the first pack concept and make it visibly distinct.",
        "variation 2": "Pack Variation 2: use the second pack concept and make it visibly distinct.",
        "variation 3": "Pack Variation 3: use the third pack concept and make it visibly distinct.",
        random: "Pack Variation Random: choose one pack concept randomly and commit to a visibly distinct result."
    }[normalizedVariation] || "Pack Variation Random: choose one pack concept randomly and commit to it."

    return `
USER SELECTED CONTROLS - MUST BE VISIBLE:
Style: ${styleName}
${moodDirective}
${strengthDirective}
${variationDirective}
These controls are not labels. They must visibly change the final image.
If two generations use different Prompt Intelligence, AI Strength, or Pack Variation choices, the outputs should not look identical.
`
}

function getMoodText(mood) {

    if (!mood || typeof mood !== "string") {
        return `
Use premium cinematic portrait lighting.
Use natural realistic shadows.
Use elegant color grading.
Maintain believable realism and high-end photography quality.
`
    }

    const normalizedMood =
        mood.trim().toLowerCase()

    const moodMap = {

        serious: `
PROMPT INTELLIGENCE - SERIOUS:
The result must feel serious, focused, confident, and mature.
Use a composed expression, direct gaze, controlled posture, deeper contrast, sharper shadows, refined professional intensity, and less playful color.
Avoid cheerful, casual, soft lifestyle, or overly glamorous mood.
Maintain realistic skin tones and believable realism.
`,

        luxury: `
PROMPT INTELLIGENCE - LUXURY:
The result must feel expensive, refined, premium, and high-end.
Use elegant wardrobe materials, polished grooming, upscale background, warm premium lighting, tasteful shine, refined color grading, and editorial luxury atmosphere.
Avoid plain studio, cheap costume, casual clothing, or basic profile-photo styling.
Create a sophisticated luxury result that is visibly different from Natural and Serious.
`,

        cinematic: `
Use cinematic but well-lit portrait lighting.
Use movie-style atmosphere without making the whole image dark.
Use realistic depth, visible facial light, balanced shadows, and premium color grading.
Create high-end cinematic portrait realism with clear background detail.
`,

        soft: `
Use soft natural lighting.
Use gentle realistic shadows.
Use calm elegant portrait atmosphere.
Maintain natural skin tones and soft premium realism.
`,

        dark: `
Use moody cinematic lighting.
Use darker realistic atmosphere with controlled shadows.
Use premium dramatic contrast and elegant color grading.
Maintain realistic skin texture and believable realism.
`,

        vibrant: `
Use rich premium colors and cinematic lighting.
Use energetic portrait atmosphere.
Use realistic vibrant tones without oversaturation.
Maintain high-end professional photography quality.
`,

        heroic: `
Use powerful cinematic hero lighting.
Use dramatic shadows and premium blockbuster atmosphere.
Create a strong confident mood while preserving realism.
`,

        futuristic: `
Use elegant futuristic cinematic lighting.
Use subtle high-tech atmosphere and premium sci-fi realism.
Maintain realistic skin tones and believable lighting.
`,

        fantasy: `
Use warm fantasy-inspired cinematic lighting.
Use magical atmospheric depth while keeping realistic skin detail.
Create premium fantasy movie mood and elegant realism.
`,

        natural: `
PROMPT INTELLIGENCE - NATURAL:
The result must feel bright, clean, realistic, open, and natural.
Use clear face light, soft realistic shadows, fresh color grading, simple believable wardrobe, healthy natural skin tones, and a modern uncluttered background.
Avoid dark drama, heavy luxury styling, intense expression, neon, fantasy mood, or overproduced editorial atmosphere.
Create a polished result that is visibly lighter and cleaner than Serious or Luxury.
`
    }

    return (
        moodMap[normalizedMood] ||
        `
Use realistic cinematic lighting.
Use natural premium color grading.
Use elegant realistic shadows.
Maintain high-end portrait quality and believable realism.
`
    )
}

function getBrightnessAndWardrobeRule(styleName, customPrompt = "") {
    const normalizedStyle = sanitizeText(styleName, "", 80).toLowerCase()
    const normalizedPrompt = sanitizeText(customPrompt, "", 700).toLowerCase()
    const userAskedForDark =
        /\b(black|dark|night|gothic|shadow|moody|low[-\s]?key|cyberpunk|noir)\b/.test(normalizedPrompt)

    if (normalizedStyle === "cyberpunk" || userAskedForDark) {
        return `
BRIGHTNESS AND WARDROBE BALANCE:
The scene may use night, neon, or darker cinematic atmosphere when appropriate, but do not make the result mostly black.
Keep the face clearly lit.
Use visible colored highlights, reflective materials, and wardrobe accents such as teal, silver, deep blue, burgundy, white, or metallic details.
Avoid plain black clothing blending into a black background unless the user specifically requested an all-black look.
`
    }

    return `
BRIGHTNESS AND WARDROBE BALANCE:
Do not default to black backgrounds, black clothing, black leather jackets, or overly dark scenes.
Use bright, premium, varied wardrobe colors such as ivory, cream, navy, blue, burgundy, emerald, silver, gold, tan, or soft neutrals.
Use visible backgrounds with depth and detail: studio, office, warm interior, city daylight, elegant architecture, fantasy hall, or softly lit environment depending on the selected style.
Keep the face clearly lit with natural skin tones and avoid heavy shadows covering the identity.
The final image should feel polished and premium, not gloomy or underexposed.
`
}

function getAgeTransformationRule(styleName, ageTarget) {
    const normalizedStyle = sanitizeText(styleName, "", 80).toLowerCase()

    if (normalizedStyle !== "age studio") {
        return ""
    }

    const normalizedAgeTarget = sanitizeText(ageTarget, "50s", 80).toLowerCase()

    const ageMap = {
        "younger adult": `
TARGET AGE:
Mandatory result: make the person visibly look like a younger adult, approximately 25-35 years old.
Keep the result clearly adult. Do not make the person look like a child, teenager, minor, or under 18.
Use smoother adult skin and slightly fresher facial fullness while preserving the same facial structure and identity.
`,

        "30s": `
TARGET AGE:
Mandatory result: make the person visibly look like they are in their 30s.
Use natural adult skin texture, mild maturity, and realistic facial detail while preserving identity.
`,

        "40s": `
TARGET AGE:
Mandatory result: make the person visibly look like they are in their 40s.
Use subtle mature facial structure, realistic skin texture, and mild expression lines while preserving identity.
`,

        "50s": `
TARGET AGE:
Mandatory result: make the person visibly look like they are in their 50s.
Use believable mature adult features: moderate expression lines, natural skin texture, subtle under-eye detail, and tasteful hair-tone changes if appropriate.
`,

        "60s": `
TARGET AGE:
Mandatory result: make the person visibly look like they are in their 60s.
Use realistic senior-adult cues: deeper expression lines, mature skin texture, subtle hair graying if appropriate, and natural age detail without caricature.
`,

        "senior adult": `
TARGET AGE:
Mandatory result: make the person visibly look like a senior adult, approximately 70+.
Use respectful realistic aging: mature skin texture, deeper wrinkles, natural facial softness, possible gray or white hair if appropriate, while preserving the same identity.
`
    }

    return `
AGE STUDIO RULES:
${ageMap[normalizedAgeTarget] || ageMap["50s"]}

The age target is not optional. The final image must clearly show the selected adult age target while preserving the uploaded person's identity.
Prioritize visible adult age cues over generic beauty retouching.

Adult-only safety:
Never create a child, teenager, minor, school-age version, baby face, or under-18 appearance.
Preserve the original person, pose, gaze, expression, gender presentation, and recognizable identity.
Do not change the person into a different family member, actor, celebrity, or generic AI face.
`.trim()
}

function getStylizedStrengthText(normalizedStrength, styleLabel) {
    if (
        normalizedStrength === "accurate" ||
        normalizedStrength === "identity lock" ||
        normalizedStrength === "realistic"
    ) {
        return `
STRENGTH SETTING - ACCURATE FACE:
Keep the ${styleLabel} conversion as close as possible to the uploaded person's real face and identity.
Use conservative stylization, preserve exact facial proportions, age impression, gender presentation, expression, hairstyle or baldness, glasses, beard pattern if present, and avoid exaggerated redesign.
Do not create a generic ${styleLabel} character.
`
    }

    if (
        normalizedStrength === "extreme" ||
        normalizedStrength === "cinematic" ||
        normalizedStrength === "high"
    ) {
        return `
STRENGTH SETTING - EXTREME STYLE:
Push the ${styleLabel} styling more boldly with stronger rendering language, more dramatic lighting, richer color, and higher visual transformation.
Still keep the uploaded person's identity recognizable.
`
    }

    return `
STRENGTH SETTING - BALANCED:
Balance recognizable identity with a clear premium ${styleLabel} transformation.
`
}

function getAccurateFaceLockRule(strength, styleName) {
    const normalizedStrength =
        typeof strength === "string"
            ? strength.trim().toLowerCase()
            : "balanced"

    if (
        normalizedStrength !== "accurate" &&
        normalizedStrength !== "identity lock" &&
        normalizedStrength !== "realistic"
    ) {
        return ""
    }

    const normalizedStyle = sanitizeText(styleName, "", 80).toLowerCase()
    const styleAllowance =
        normalizedStyle === "cartoon"
            ? "For Cartoon, still convert the person into a premium 3D animated character. Preserve the person's unique facial structure, expression, age impression, hairstyle or baldness, glasses, beard pattern if present, and recognizable identity while using clear 3D animated materials and stylized character geometry."
            : normalizedStyle === "anime"
                ? "For Anime, still convert the person into polished premium anime artwork. Preserve the person's unique facial structure, expression, age impression, hairstyle or baldness, glasses, beard pattern if present, and recognizable identity while using clean anime linework, expressive anime eyes, cel-shading, and animated film styling. Do not create a generic anime character."
                : "For realistic styles, keep the face as close as possible to the uploaded photo. The output should look like the same exact person after wardrobe, lighting, and background changes."

    return `
ACCURATE FACE LOCK - HIGHEST PRIORITY:
The uploaded face is the identity reference and must be preserved as exactly as the image model allows.
Do not replace the person with a different face, celebrity, model, younger version, more attractive version, or generic AI face.
Do not change face shape, eye shape, nose, lips, jawline structure, cheeks, forehead, ears, skin tone, age impression, wrinkles, facial hair pattern, glasses, hairstyle or baldness, natural expression, or original gender presentation.
Change mainly non-identity elements: outfit, background, lighting, color grading, atmosphere, and style finish.
${styleAllowance}
If any style instruction conflicts with exact face preservation, follow Accurate Face Lock first.
`
}

function getStrengthText(strength, styleName, genderMode = "Auto") {

    const normalizedStrength =
        typeof strength === "string"
            ? strength.trim().toLowerCase()
            : "balanced"

    const normalizedStyle =
        typeof styleName === "string"
            ? styleName.trim().toLowerCase()
            : ""

    const genderPresentationLine =
        genderMode === "Female"
            ? "selected female gender presentation"
            : genderMode === "Male"
                ? "selected male gender presentation"
                : "original gender presentation"

    if (normalizedStyle === "age studio") {

        return `
AGE STUDIO MODE:

Change visible adult age cues while preserving identity extremely closely.

Preserve:
- exact facial identity
- face shape
- eyes
- nose
- lips
- jawline
- skin tone
- hairstyle or baldness pattern
- beard pattern if present
- glasses if present
- gender presentation
- pose and expression

Allow:
- realistic adult age texture
- natural wrinkles or smoother adult skin depending on target age
- subtle hair graying or hair-tone changes when appropriate
- tasteful wardrobe/background polish

Rules:
Do not create a child, teenager, minor, or under-18 version.
Do not replace the person with a different identity.
Do not caricature aging.
`
    }

    // =========================
    // CARTOON MODE
    // =========================

    if (normalizedStyle === "cartoon") {

        return `
CARTOON MODE:

The final image must be clearly non-photorealistic and animated.

Create a premium 3D animated movie-style character using cinematic cartoon rendering, expressive animated eyes, polished stylized textures, smooth shading, elegant animated lighting, and blockbuster-quality cartoon realism.

Preserve the uploaded person's:
- identity
- ${genderPresentationLine}
- age impression
- hairstyle or baldness
- beard if present
- facial proportions
- expression
- recognizable face structure

Rules:
Do not create a completely different cartoon character.
Do not over-exaggerate proportions.
Do not turn the person into a child-like caricature.
The final result should look like a luxury animated adaptation of the same real person.

${getStylizedStrengthText(normalizedStrength, "cartoon")}
`
    }

    // =========================
    // ANIME MODE
    // =========================

    if (normalizedStyle === "anime") {

        return `
ANIME MODE:

Create a clearly anime-styled version of the uploaded person using premium cinematic anime rendering.

Use:
- polished anime illustration quality
- expressive anime eyes
- cinematic anime lighting
- elegant shading
- premium anime movie atmosphere
- modern high-end anime realism

Preserve:
- same identity
- ${genderPresentationLine}
- same age impression
- hairstyle or baldness
- beard if present
- face shape
- expression
- recognizable facial structure

Rules:
Do not create a generic anime face.
Do not replace the person with another anime character.
The final image must still clearly resemble the uploaded person.

${getStylizedStrengthText(normalizedStrength, "anime")}
`
    }

    // =========================
    // ACCURATE MODE
    // =========================

    if (
        normalizedStrength === "accurate" ||
        normalizedStrength === "identity lock" ||
        normalizedStrength === "realistic"
    ) {
        if (normalizedStyle === "superhero") {
            return `
ACCURATE FACE SUPERHERO MODE:

The uploaded person's face, gender presentation, age, skin texture, expression, hairstyle or baldness, beard if present, and facial proportions are the top priority.

Create a superhero result by changing mainly:
- suit
- background
- lighting
- cinematic power effects
- color grading

Do not change:
- gender presentation
- face shape
- eyes
- nose
- lips
- jawline structure
- age impression
- recognizable identity

Do not create a generic male superhero, Superman-style hero, celebrity superhero face, red cape, S logo, or exact protected costume.
If the uploaded person is female-presenting, keep the result clearly female-presenting.
The final image must look like the same person wearing a premium original superhero suit.
`
        }

        return `
ACCURATE MODE:

Preserve the uploaded person's real identity extremely closely.

Strongly preserve:
- age
- wrinkles
- forehead lines
- eye bags
- skin texture
- pores
- facial asymmetry
- face shape
- jawline
- cheeks
- eyes
- nose
- lips
- hairstyle or baldness
- beard if present
- natural expression
- natural imperfections

Rules:
Do not make the person younger.
Do not beautify heavily.
Do not smooth skin excessively.
Do not slim the face.
Do not sharpen the jawline.
Do not restore hair.
Do not replace the face with a fake attractive AI actor.

Allow:
- premium lighting
- outfit enhancement
- cinematic atmosphere
- environment upgrades
- professional color grading

The final image must still clearly look like the same real person.
`
    }

    // =========================
    // EXTREME MODE
    // =========================

    if (
        normalizedStrength === "extreme" ||
        normalizedStrength === "cinematic" ||
        normalizedStrength === "high"
    ) {

        return `
EXTREME MODE:

Apply a bold premium cinematic AI transformation while keeping the uploaded person recognizable.

Allow:
- stronger cinematic styling
- dramatic atmosphere
- premium outfit redesign
- advanced lighting effects
- blockbuster visual polish
- stronger environmental storytelling
- high-impact composition

Still preserve:
- same identity
- ${genderPresentationLine}
- same age impression
- same facial structure
- hairstyle or baldness
- beard if present
- skin tone
- facial proportions
- recognizable expression

Rules:
Do not fully replace the face.
Do not create a different person.
Do not destroy identity consistency.
The result should feel cinematic and powerful while remaining recognizable.
`
    }

    // =========================
    // BALANCED MODE
    // =========================

    return `
BALANCED MODE:

Apply premium AI portrait enhancement while keeping the uploaded person clearly recognizable.

Preserve:
- face identity
- age
- wrinkles
- skin texture
- hairstyle or baldness
- beard if present
- facial proportions
- eyes
- nose
- lips
- jawline
- natural expression

Allow:
- elegant cinematic lighting
- premium outfit styling
- luxury atmosphere
- realistic environment upgrades
- high-end photography enhancement
- refined color grading

Rules:
Avoid fake actor replacement.
Avoid excessive beauty enhancement.
Avoid unrealistic skin smoothing.
Avoid heavy face reconstruction.
Avoid dramatic identity changes.

The final result should feel premium, cinematic, stylish, and realistic while still looking like the same real person.
`
}

function buildGeneratePrompt({
    styleName,
    mood,
    strength,
    variation,
    genderMode,
    customPrompt,
    ageTarget
}) {

    const safeStyleName =
        typeof styleName === "string" && styleName.trim()
            ? styleName.trim()
            : STYLE_NAMES.AI_AVATAR

    const safeMood =
        typeof mood === "string" && mood.trim()
            ? mood.trim()
            : "Natural"

    const safeStrength =
        typeof strength === "string" && strength.trim()
            ? strength.trim()
            : "Balanced"

    const safeVariation =
        typeof variation === "string" && variation.trim()
            ? variation.trim()
            : "Random"

    const safeGenderMode =
        typeof genderMode === "string" && genderMode.trim()
            ? genderMode.trim()
            : "Auto"

    const safeAgeTarget =
        typeof ageTarget === "string" && ageTarget.trim()
            ? ageTarget.trim()
            : "50s"

    const safeCustomPrompt =
        expandStudioDirection(safeStyleName, customPrompt)

    const hasStudioDirection =
        Boolean(safeCustomPrompt && safeCustomPrompt.trim())

    const normalizedStyle =
        safeStyleName.toLowerCase()

    const genderRule =
        getGenderRule(safeGenderMode)

    const effectiveIdentityRule =
        normalizedStyle === "age studio"
            ? ageStudioIdentityRule
            : getIdentityRuleForGenderMode(safeGenderMode)

    const selectedPrompt =
        getPromptByVariation(safeStyleName, safeVariation)

    const moodText =
        getMoodText(safeMood)

    const variationText =
        getVariationText(safeVariation)

    const styleVariationText =
        getStyleVariationText(safeStyleName, safeVariation)

    const superheroVariationText =
        normalizedStyle === "superhero"
            ? getSuperheroVariationText(safeVariation)
            : ""

    const controlPriorityText =
        getControlPriorityText({
            styleName: safeStyleName,
            mood: safeMood,
            strength: safeStrength,
            variation: safeVariation
        })

    const strengthText =
        getStrengthText(safeStrength, safeStyleName, safeGenderMode)

    const accurateFaceLockRule =
        getAccurateFaceLockRule(safeStrength, safeStyleName)

    const studioDirectionPriorityRules =
        getStudioDirectionPriorityRules(safeStyleName, safeCustomPrompt)

    const brightnessAndWardrobeRule =
        getBrightnessAndWardrobeRule(safeStyleName, safeCustomPrompt)

    const ageTransformationRule =
        getAgeTransformationRule(safeStyleName, safeAgeTarget)

    let styleRules = ""

    if (normalizedStyle === "superhero") {

        styleRules = `
SUPERHERO RULES:

The result must clearly look like a real premium superhero movie scene.
It must not look like a normal portrait with ordinary clothes.

${superheroVarietyRule}

The outfit must be:
- a cinematic superhero suit
- powerful
- iconic
- advanced
- polished
- visually superhuman
- premium movie-quality
- clearly designed for a comic-book blockbuster universe
- built around an original emblem, glowing core, or power symbol
- made from premium textured fabric, armor panels, suit seams, and heroic materials
- adapted to the uploaded person's original gender presentation, body shape, hairstyle, and facial identity
- clearly visible in the frame as a superhero costume, not just a jacket or shirt

The scene must include:
- dramatic cinematic environment
- action-scale lighting
- sparks, smoke, energy, particles, reflections, or atmospheric VFX
- heroic movie-poster composition

The outfit must NOT be:
- tactical gear
- military clothing
- police armor
- normal clothes
- a leather jacket
- a biker outfit
- a SWAT vest
- a generic combat suit
- Superman-style red cape and blue suit unless the user specifically asked for that
- S logo, shield logo, exact protected costume, or celebrity superhero face
- full mask, helmet, visor, sunglasses, hidden eyes, or covered face

Gender and face:
Preserve the uploaded person's original gender presentation when Gender Mode is Auto.
If the uploaded person is female-presenting, the output must remain female-presenting.
If the uploaded person is male-presenting, the output must remain male-presenting.
Do not add masculine beard, masculine jaw styling, male body shape, or male-presenting costume to a female-presenting uploaded person.

Make the suit and environment dramatic, but keep the face highly recognizable.
Change the costume, background, lighting, and powers more than the face.
The final image must read instantly as a face-visible superhero portrait.
`
    }

    if (normalizedStyle === "ai avatar") {

        styleRules = `
AI AVATAR RULES:

Create a realistic premium avatar, not a fantasy character.

Upgrade:
- outfit
- lighting
- background
- camera quality
- luxury portrait atmosphere

Do not add:
- superhero suit
- cyberpunk neon
- fantasy glow
- anime style
- cartoon rendering
- robotic parts
- fake actor face

The final image must look like a premium realistic portrait of the same person.
`
    }

    if (normalizedStyle === "headshot") {

        styleRules = `
HEADSHOT RULES:

Create a clean professional headshot suitable for LinkedIn, CV, business profile, or company website.

Keep:
- realistic skin texture
- natural age
- professional framing
- clean background
- sharp eyes
- believable studio lighting

Avoid:
- heavy beauty retouching
- fake model face
- fantasy effects
- superhero styling
- cyberpunk colors
- cartoon/anime look
`
    }

    if (normalizedStyle === "professional") {

        styleRules = `
PROFESSIONAL RULES:

Create a premium business portrait with executive quality.
The result must clearly look like a business/professional portrait.

Use:
- elegant business clothing, blazer, suit, tailored shirt, or executive smart-casual wardrobe
- realistic executive office, boardroom, glass-wall workplace, city-office depth, or premium studio business background
- warm professional lighting
- premium camera depth of field
- refined corporate atmosphere
- confident posture and executive presence

Avoid:
- fake CEO stock-photo face
- unrealistic beauty edits
- casual social-media portrait
- party/fashion-only styling
- fantasy elements
- superhero costume
- cyberpunk effects
- cartoon/anime rendering
`
    }

    if (normalizedStyle === "fantasy") {

        styleRules = `
FANTASY RULES:

Create a realistic live-action magical fantasy portrait.

Use:
- royal or noble clothing
- mage robes, enchanted warrior wardrobe, embroidered cloak, crown-inspired detail, or fantasy armor when suitable
- cinematic castle or palace atmosphere
- magical library, enchanted forest, throne room, kingdom balcony, or misty fantasy landscape
- warm fantasy movie lighting
- visible magical particles, portal glow, aura, spell light, torchlight, or enchanted atmosphere away from the face
- realistic luxury textures
- believable human skin

Avoid:
- cartoon fantasy rendering
- excessive glowing magic directly on the face
- unrealistic fantasy skin
- changing the person into a different character
`
    }

    if (normalizedStyle === "cyberpunk") {

        styleRules = `
CYBERPUNK RULES:

Create a realistic neon cyberpunk futuristic city portrait.

Use:
- strong cyan and magenta neon reflections
- futuristic techwear or reflective clothing
- cinematic night city background with visible signs or holograms
- rainy street reflections, wet pavement glow, skyline lights, or high-tech panels
- colored rim light on hair, shoulders, and background
- realistic urban atmosphere
- premium sci-fi photography

Avoid:
- robotic face changes
- helmets or masks covering the face
- extreme cybernetic implants
- anime/cartoon rendering
- replacing the person with a different cyberpunk character
- plain dark portrait with no visible neon
`
    }

    if (normalizedStyle === "anime") {

        styleRules = `
ANIME RULES:

The result must clearly look like premium anime artwork, not a lightly edited photo.

Use:
- clean anime linework or painterly anime edge definition
- cinematic anime rendering
- expressive anime eyes
- stylized anime nose and mouth
- refined anime hair shapes
- polished illustration quality
- clean cel-shading with soft cinematic gradients
- elegant animated atmosphere

Preserve the uploaded person's identity features while converting them into anime style.
Do not create a generic anime character.
Do not output photorealism, western 3D cartoon, sketch, comic filter, or cheap anime filter.
`
    }

    if (normalizedStyle === "age studio") {

        styleRules = `
AGE STUDIO STYLE RULES:

Create a realistic age-edited portrait, not a costume style.
Keep the image bright, natural, premium, and believable.
Use realistic adult aging details while preserving the person's identity.
Do not make the person look under 18.
Do not create a fantasy, anime, cartoon, superhero, or cyberpunk version unless the user specifically asks for it in Studio Direction.
`
    }

    if (normalizedStyle === "cartoon") {

        styleRules = `
CARTOON RULES:

The result must clearly look like a premium 3D animated character, not a lightly edited photo.

Use:
- visible 3D character geometry
- cinematic cartoon lighting
- expressive animated eyes
- polished stylized textures
- smooth animated shading
- sculpted stylized hair
- soft animated skin material
- rounded feature-film character forms
- high-end animated movie quality

Preserve the uploaded person's recognizable identity.
Do not create a random cartoon character.
Do not output photorealism, anime, flat 2D drawing, sketch, comic filter, or cheap app filter.
`
    }

    const ageEditCommandSection =
        normalizedStyle === "age studio"
            ? `
AGE STUDIO EDIT COMMAND:
This is an image-edit request, not a request to copy the original photo.
Do not return the original person unchanged.
Change the uploaded person's visible adult age to: ${safeAgeTarget}.
The age change must be obvious in the final image while the identity remains recognizable.
Edit adult age cues directly: skin texture, expression lines, under-eye detail, facial maturity, hair tone, and overall adult age impression.
Preserve identity, gender presentation, pose, gaze, face shape, glasses, beard pattern, skin tone, and expression, but do not preserve the original apparent age.
Never make the person look under 18.
`
            : ""

    const cartoon3dCommandSection =
        normalizedStyle === "cartoon"
            ? `
CARTOON 3D CONVERSION COMMAND:
This must be a premium 3D animated movie character conversion.
The result must not remain photorealistic and must not look like a simple beauty filter.
Use clear 3D character geometry: stylized facial volumes, expressive animated eyes, sculpted hair, smooth premium shaders, soft subsurface animated skin, cinematic global illumination, rim light, and real depth of field.
Keep the uploaded person's identity recognizable through face shape, expression, hairstyle or baldness, skin tone, age impression, glasses, beard pattern if present, and original gender presentation.
Avoid flat 2D illustration, anime, sketch, oil painting, cheap cartoon filter, plastic face, random child-like character, or generic animated avatar.
`
            : ""

    const animeCommandSection =
        normalizedStyle === "anime"
            ? `
ANIME CONVERSION COMMAND:
This must be a polished anime portrait, not a photorealistic portrait and not a 3D cartoon.
Use unmistakable premium anime artwork: clean linework or painterly anime edge definition, expressive anime eyes adapted from the real eyes, stylized anime nose and mouth, refined anime hair shapes, smooth cel-shading, soft cinematic gradients, detailed anime outfit rendering, and elegant animated background atmosphere.
Preserve recognizable identity through face shape, expression, age impression, hairstyle or baldness, skin tone, glasses, beard pattern if present, and original gender presentation.
Avoid photorealism, western 3D cartoon, cheap anime filter, generic anime face, child-like redesign, or replacing the uploaded person with a fictional anime character.
`
            : ""

    const fantasyCommandSection =
        normalizedStyle === "fantasy"
            ? `
FANTASY MAGIC CONVERSION COMMAND:
This must be a magical live-action fantasy movie portrait, not a normal royal photoshoot.
The result must visibly include fantasy transformation through wardrobe, environment, atmosphere, and controlled magical details.
Use at least three of these fantasy cues: castle or palace architecture, enchanted forest or ancient library, noble robe or fantasy armor, embroidered cloak, crown or magical jewelry, floating glowing particles, magical aura around hands or background, portal light, candlelit throne room, misty kingdom landscape, dramatic fantasy sky, warm torchlight, realistic spell glow.
Keep the uploaded face realistic and recognizable. Do not put magical glow directly over the face. Do not turn the person into a monster, elf, child, cartoon, anime, or different character.
`
            : ""

    const cyberpunkCommandSection =
        normalizedStyle === "cyberpunk"
            ? `
CYBERPUNK NEON CONVERSION COMMAND:
This must be a neon cyberpunk portrait, not a normal dark city portrait.
The final image must visibly include futuristic city atmosphere and strong colored neon.
Use at least four of these cyberpunk cues: cyan neon rim light, magenta neon rim light, holographic signs, rainy street reflections, wet pavement glow, futuristic techwear, reflective jacket materials, high-tech panels, sci-fi skyline, night city depth, subtle facial neon reflections, blue/purple/pink color contrast, cinematic urban haze.
Keep the face clearly lit and recognizable. Do not hide the face in shadow, helmet, goggles, mask, or heavy cybernetic implants.
`
            : ""

    const superheroFaceCommandSection =
        normalizedStyle === "superhero"
            ? `
FACE-VISIBLE SUPERHERO PORTRAIT COMMAND:
This must be a superhero portrait with the uploaded person's real face clearly visible.
The output must show a premium original superhero suit, visible power identity, cinematic superhero environment, and uncovered recognizable face.
Do not use a full mask, helmet, visor, sunglasses, face-covering cowl, heavy shadow over the face, or any design that hides identity.
Allowed face-safe options: no mask, open-face cowl, lifted mask, face-framing hood, suit collar, cheek/temple costume accents, or eye-lens motifs placed around the face without covering the real eyes and facial identity.
The costume, background, power effects, and lighting should transform strongly, but the face must remain visible, well-lit, and recognizable.
`
            : ""

    const professionalCommandSection =
        normalizedStyle === "professional"
            ? `
PREMIUM BUSINESS PORTRAIT COMMAND:
This must be a premium professional business portrait, not a casual portrait or generic beauty photo.
The final image must visibly include business/executive cues: tailored blazer, suit, formal shirt, smart professional wardrobe, executive office, boardroom, glass-wall workplace, refined studio business backdrop, desk area, city-office depth, or corporate environment.
Use warm professional lighting, realistic camera depth, sharp eyes, refined grooming, polished but natural skin, confident posture, and executive presence.
Avoid casual T-shirt, party/fashion styling, fantasy, cyberpunk, superhero costume, anime, cartoon, fake stock-photo face, or over-smoothed beauty retouch.
`
            : ""

    const customDirectionSection = hasStudioDirection
        ? normalizedStyle === "age studio"
            ? `
AGE STUDIO USER DIRECTION OVERRIDE:
${safeCustomPrompt}

The user's typed Studio Direction must visibly control non-age creative details: outfit, background, lighting, camera style, pose, expression, atmosphere, colors, materials, and final finish.
The selected Age Target remains mandatory: ${safeAgeTarget}.
Do not let Studio Direction cancel, weaken, or replace the age transformation.
Apply both requirements together: the same uploaded person at the requested adult age, styled according to the user's Studio Direction.
If the Studio Direction asks for a different setting, outfit, mood, or concept, follow it while keeping identity, face visibility, adult-only rules, and the selected age target.
Do not ignore, soften, or replace the typed direction with the default Age Studio preset.
Do not follow any instruction that asks to replace the person, change real identity, hide the face, add text/logos/watermarks, make the person underage, or create sexualized content.
`
            : `
PRIMARY CREATIVE BRIEF FROM USER STUDIO DIRECTION:
${safeCustomPrompt}

The user's typed Studio Direction is the main visual concept for this generation.
Apply it clearly and visibly to outfit, background, lighting, camera style, pose, atmosphere, materials, colors, and final finish.
If the typed Studio Direction asks for a different concept than the selected style, follow the typed Studio Direction for the concept.
The selected app style may influence only the rendering polish when it does not conflict with the typed direction.
Do not ignore, soften, or replace the typed direction with the selected style preset.
If the typed direction conflicts with identity preservation, safety, selected Gender Mode, adult-only age rules, or face visibility, ignore only the conflicting part and keep the safe visual parts.
Do not follow any instruction that asks to replace the person, change the real identity, hide the face, add text/logos/watermarks, make the person underage, or create sexualized content.
`
        : `
CUSTOM STUDIO DIRECTION:
No custom user direction was provided. Follow the selected studio preset closely.
`

    const stylePromptSection = hasStudioDirection
        ? normalizedStyle === "age studio"
            ? `
AGE STUDIO STYLE LENS:
Keep Age Studio as the active editing mode.
Use the user's Studio Direction for styling and scene details, but keep the Age Studio age transformation and identity preservation rules active.
The result must not be a normal portrait copy; it must visibly match the selected adult age target.
`
            : `
SELECTED STYLE LENS:
The selected app style is "${safeStyleName}".
Because Studio Direction is active, do not use the selected style's default concept prompt as the main idea.
Use "${safeStyleName}" only as a secondary rendering lens for quality, finish, and polish when compatible with the user's typed direction.
Do not apply selected-style avoid-lists, default outfit rules, default background rules, or default genre rules if they conflict with the typed direction.
`
        : `
STYLE PROMPT:
${selectedPrompt}
`

    const styleRulesSection = hasStudioDirection
        ? normalizedStyle === "age studio"
            ? `
AGE STUDIO STYLE-SPECIFIC RULES:
Studio Direction is active, but Age Studio age editing is still required.
Preserve identity and face visibility.
Apply the selected adult age target visibly.
Use Studio Direction only to control non-age styling and scene details unless it safely supports the age edit.
`
            : `
STYLE-SPECIFIC RULES:
Studio Direction is active, so selected-style restrictions are disabled except identity preservation, safety, face visibility, selected Gender Mode, and adult-only age rules.
Keep only the rendering quality expectations of "${safeStyleName}" when they are compatible with the typed direction.
`
        : `
STYLE-SPECIFIC RULES:
${styleRules}
`

    const finalPrompt = `
${genderRule}

${ageEditCommandSection}

${cartoon3dCommandSection}

${animeCommandSection}

${fantasyCommandSection}

${cyberpunkCommandSection}

${superheroFaceCommandSection}

${professionalCommandSection}

IDENTITY LOCK:
${effectiveIdentityRule}

${accurateFaceLockRule}

${controlPriorityText}

${customDirectionSection}

${stylePromptSection}

VARIATION:
${variationText}

${styleVariationText}

${superheroVariationText}

MOOD:
${moodText}

STRENGTH:
${strengthText}

${styleRulesSection}

${brightnessAndWardrobeRule}

${ageTransformationRule}

STUDIO DIRECTION PRIORITY:
${studioDirectionPriorityRules || "No extra studio direction priority rules are needed."}

GLOBAL QUALITY RULES:

The final image must be high quality, sharp, realistic or properly stylized according to the selected style, visually premium, and suitable for a paid AI Face Studio app.

The face must remain visible, clear, well-lit, and recognizable unless the selected style is Anime or Cartoon, where identity must still be preserved through stylized features.

Do not create:
- blurry output
- distorted face
- extra eyes
- broken mouth
- deformed hands near the face
- cropped face
- hidden face
- mask over the face
- sunglasses covering identity
- helmet covering identity
- low-quality skin
- fake plastic skin
- watermark
- text
- logo
- signature
`

    return finalPrompt.trim()
}

function getGenerationSettings(strength, styleName = "", studioDirection = "") {

    const normalizedStrength =
        typeof strength === "string"
            ? strength.trim().toLowerCase()
            : "balanced"

    const normalizedStyle = sanitizeText(styleName, "", 80).toLowerCase()
    const hasStudioDirection = Boolean(
        typeof studioDirection === "string" &&
        studioDirection.trim()
    )
    const isAccurateFace =
        normalizedStrength === "accurate" ||
        normalizedStrength === "identity lock" ||
        normalizedStrength === "realistic"

    if (normalizedStyle !== "age studio" && hasSpiderHeroDirection(studioDirection)) {
        return {
            guidance_scale: isAccurateFace ? 2.7 : 4.2,
            num_inference_steps: isAccurateFace ? 34 : 44,
            prompt_strength: isAccurateFace ? 0.34 : 0.64
        }
    }

    if (hasStudioDirection && normalizedStyle !== "age studio") {
        return {
            guidance_scale: isAccurateFace ? 2.6 : normalizedStrength === "extreme" ? 4.4 : 3.7,
            num_inference_steps: isAccurateFace ? 34 : normalizedStrength === "extreme" ? 46 : 42,
            prompt_strength: isAccurateFace ? 0.32 : normalizedStrength === "extreme" ? 0.72 : 0.60
        }
    }

    if (normalizedStyle === "superhero") {
        return {
            guidance_scale: normalizedStrength === "accurate" ? 2.6 : normalizedStrength === "extreme" ? 4.4 : 3.7,
            num_inference_steps: normalizedStrength === "accurate" ? 32 : normalizedStrength === "extreme" ? 46 : 40,
            prompt_strength: normalizedStrength === "accurate" ? 0.34 : normalizedStrength === "extreme" ? 0.70 : 0.62
        }
    }

    if (normalizedStyle === "cartoon") {
        if (normalizedStrength === "extreme") {
            return {
                guidance_scale: 5.0,
                num_inference_steps: 50,
                prompt_strength: 0.82
            }
        }

        return {
            guidance_scale: isAccurateFace ? 3.4 : 4.6,
            num_inference_steps: isAccurateFace ? 40 : 46,
            prompt_strength: isAccurateFace ? 0.52 : 0.74
        }
    }

    if (normalizedStyle === "anime") {
        if (normalizedStrength === "extreme") {
            return {
                guidance_scale: 4.9,
                num_inference_steps: 50,
                prompt_strength: 0.82
            }
        }

        return {
            guidance_scale: isAccurateFace ? 3.2 : 4.5,
            num_inference_steps: isAccurateFace ? 38 : 46,
            prompt_strength: isAccurateFace ? 0.48 : 0.74
        }
    }

    if (normalizedStyle === "age studio") {
        return {
            guidance_scale: normalizedStrength === "accurate" ? 3.0 : normalizedStrength === "extreme" ? 4.2 : 3.6,
            num_inference_steps: normalizedStrength === "accurate" ? 38 : normalizedStrength === "extreme" ? 48 : 44,
            prompt_strength: normalizedStrength === "accurate" ? 0.46 : normalizedStrength === "extreme" ? 0.68 : 0.58
        }
    }

    if (normalizedStyle === "fantasy") {
        return {
            guidance_scale: isAccurateFace ? 2.9 : normalizedStrength === "extreme" ? 4.7 : 4.1,
            num_inference_steps: isAccurateFace ? 36 : normalizedStrength === "extreme" ? 48 : 44,
            prompt_strength: isAccurateFace ? 0.40 : normalizedStrength === "extreme" ? 0.74 : 0.64
        }
    }

    if (normalizedStyle === "cyberpunk") {
        return {
            guidance_scale: isAccurateFace ? 2.9 : normalizedStrength === "extreme" ? 4.8 : 4.2,
            num_inference_steps: isAccurateFace ? 36 : normalizedStrength === "extreme" ? 48 : 44,
            prompt_strength: isAccurateFace ? 0.40 : normalizedStrength === "extreme" ? 0.76 : 0.66
        }
    }

    if (normalizedStyle === "professional") {
        return {
            guidance_scale: isAccurateFace ? 2.4 : normalizedStrength === "extreme" ? 3.9 : 3.2,
            num_inference_steps: isAccurateFace ? 32 : normalizedStrength === "extreme" ? 42 : 38,
            prompt_strength: isAccurateFace ? 0.30 : normalizedStrength === "extreme" ? 0.60 : 0.48
        }
    }

    if (normalizedStyle === "headshot" || normalizedStyle === "ai avatar") {
        return {
            guidance_scale: isAccurateFace ? 2.1 : normalizedStrength === "extreme" ? 3.4 : 2.8,
            num_inference_steps: isAccurateFace ? 30 : normalizedStrength === "extreme" ? 38 : 34,
            prompt_strength: isAccurateFace ? 0.22 : normalizedStrength === "extreme" ? 0.52 : 0.38
        }
    }

    if (
        normalizedStrength === "accurate" ||
        normalizedStrength === "identity lock" ||
        normalizedStrength === "realistic"
    ) {
        return {
            guidance_scale: 2.0,
            num_inference_steps: 28,
            prompt_strength: 0.26
        }
    }

    if (
        normalizedStrength === "extreme" ||
        normalizedStrength === "high" ||
        normalizedStrength === "cinematic"
    ) {
        return {
            guidance_scale: 3.6,
            num_inference_steps: 40,
            prompt_strength: 0.58
        }
    }

    return {
        guidance_scale: 2.8,
        num_inference_steps: 34,
        prompt_strength: 0.42
    }
}

app.post("/generate", generationLimiter, async (req, res) => {

    try {

        const {
            styleName,
            imageBase64,
            mood = "Natural",
            strength = "Balanced",
            variation = "Random",
            genderMode = "Auto",
            ageTarget = "50s",
            customPrompt = "",
            aspectRatio = "1:1",
            upscale = true
        } = req.body || {}

        if (!styleName || typeof styleName !== "string") {
            throw createHttpError("Missing or invalid styleName", 400, "INVALID_STYLE")
        }

        if (!imageBase64 || typeof imageBase64 !== "string") {
            throw createHttpError("Missing or invalid imageBase64", 400, "INVALID_IMAGE")
        }

        const startedAt = Date.now()
        const safeStyleName = pickAllowed(styleName, studioOptions.styles, STYLE_NAMES.AI_AVATAR)
        const safeMood = pickAllowed(mood, studioOptions.moods, "Natural")
        const safeStrength = pickAllowed(strength, studioOptions.strengths, "Balanced")
        const safeVariation = pickAllowed(variation, studioOptions.variations, "Random")
        const safeGenderMode = pickAllowed(genderMode, studioOptions.genderModes, "Auto")
        const safeAgeTarget = pickAllowed(ageTarget, studioOptions.ageTargets, "50s")
        const safeCustomPrompt = sanitizeText(customPrompt, "", 700)
        const safeAspectRatio = pickAllowed(aspectRatio, studioOptions.aspectRatios, "1:1")
        const shouldUpscale = upscale !== false

        console.log("Generate request:", {
            requestId: req.requestId,
            styleName: safeStyleName,
            mood: safeMood,
            strength: safeStrength,
            variation: safeVariation,
            genderMode: safeGenderMode,
            ageTarget: safeStyleName === "Age Studio" ? safeAgeTarget : null,
            hasCustomPrompt: Boolean(safeCustomPrompt),
            aspectRatio: safeAspectRatio,
            upscale: shouldUpscale
        })

        const uploadedImageUrl =
            await uploadBase64Image(
                imageBase64,
                "photo.jpg"
            )

        console.log("Uploaded image:", uploadedImageUrl)

        const prompt =
            buildGeneratePrompt({
                styleName: safeStyleName,
                mood: safeMood,
                strength: safeStrength,
                variation: safeVariation,
                genderMode: safeGenderMode,
                ageTarget: safeAgeTarget,
                customPrompt: safeCustomPrompt
            })

        console.log("Prompt:", prompt)

        const settings =
            getGenerationSettings(safeStrength, safeStyleName, safeCustomPrompt)

        const generationModel =
            safeStyleName === "Age Studio"
                ? AGE_GENERATION_MODEL
                : GENERATION_MODEL

        const predictionId =
            await startPrediction(
                generationModel,
                {
                    prompt,
                    input_image: uploadedImageUrl,
                    aspect_ratio: safeAspectRatio,
                    output_format: "jpg",
                    safety_tolerance: 2,
                    ...settings
                }
            )

        console.log("Prediction started:", predictionId)

        const generatedUrl =
            await waitForPrediction(
                predictionId,
                "AI generation"
            )

        console.log("Generated image:", generatedUrl)

        let finalUrl = generatedUrl
        let upscaleApplied = false

        if (shouldUpscale) {
            try {

                const shouldFaceEnhance =
                    safeStrength.toLowerCase() === "extreme" &&
                    safeStyleName !== "Age Studio"

                const upscalePredictionId =
                    await startPrediction(
                        UPSCALE_MODEL,
                        {
                            image: generatedUrl,
                            scale: 2,
                            face_enhance: shouldFaceEnhance
                        }
                    )

                console.log("Upscale started:", upscalePredictionId)

                finalUrl =
                    await waitForPrediction(
                        upscalePredictionId,
                        "Upscale"
                    )

                upscaleApplied = true

            } catch (upscaleError) {

                console.log(
                    "Upscale failed, returning original image:",
                    upscaleError.message
                )

                finalUrl = generatedUrl
            }
        }

        return sendSuccess(res, req, {
            imageUrl: finalUrl,
            studio: {
                styleName: safeStyleName,
                mood: safeMood,
                strength: safeStrength,
                variation: safeVariation,
                genderMode: safeGenderMode,
                ageTarget: safeStyleName === "Age Studio" ? safeAgeTarget : null,
                aspectRatio: safeAspectRatio,
                customPromptApplied: Boolean(safeCustomPrompt),
                ageStudioDirectionApplied: safeStyleName === "Age Studio" && Boolean(safeCustomPrompt),
                upscaleApplied,
                model: generationModel,
                durationMs: Date.now() - startedAt
            }
        })

    } catch (error) {
        return sendError(res, req, error, "Generation failed")
    }
})

function getBackgroundPrompt(backgroundStyle) {

    const normalizedStyle =
        typeof backgroundStyle === "string"
            ? backgroundStyle.trim().toLowerCase()
            : "studio"

    const backgroundPrompts = {

        studio: `
Replace only the background with a beautiful premium studio portrait background.

IMPORTANT:
Keep the person exactly the same.
Preserve face, identity, age, skin texture, clothes, body, pose, hairstyle or baldness, beard if present, hands, and expression.

Style:
Clean luxury studio backdrop, soft professional lighting, realistic shadows, premium portrait photography, elegant neutral tones, high-end camera depth of field.

Rules:
Do not change the face.
Do not change the clothing.
Do not change the body shape.
Do not beautify heavily.
Do not add text, logos, or watermark.
`,

        beach: `
Replace only the background with a beautiful tropical beach sunset.

IMPORTANT:
Keep the person exactly the same.
Preserve face, identity, age, skin texture, clothes, body, pose, hairstyle or baldness, beard if present, hands, and expression.

Style:
Golden sunset beach, soft ocean light, realistic sand and water, warm natural glow, premium vacation portrait photography, cinematic depth of field.

Rules:
Do not change the face.
Do not change the person.
Do not change the clothes.
Do not make the person look younger.
Do not add sunglasses unless already present.
Do not add text, logos, or watermark.
`,

        cyberpunk: `
Replace only the background with a futuristic cyberpunk neon city at night.

IMPORTANT:
Keep the person exactly the same.
Preserve face, identity, age, skin texture, clothes, body, pose, hairstyle or baldness, beard if present, hands, and expression.

Style:
Cinematic neon city, rainy street reflections, futuristic skyline, subtle blue and magenta lighting, realistic urban atmosphere, premium sci-fi photography.

Rules:
Do not turn the person into a cyborg.
Do not add robotic parts.
Do not add masks, helmets, or goggles.
Do not change the face or clothes.
Do not add text, logos, or watermark.
`,

        office: `
Replace only the background with a luxury modern office.

IMPORTANT:
Keep the person exactly the same.
Preserve face, identity, age, skin texture, clothes, body, pose, hairstyle or baldness, beard if present, hands, and expression.

Style:
Premium executive office, clean glass walls, elegant desk area, soft professional lighting, realistic background blur, business portrait atmosphere, high-end corporate photography.

Rules:
Do not change the face.
Do not change the clothes.
Do not make the person younger.
Do not create fake suit clothing unless already worn.
Do not add text, logos, or watermark.
`,

        fantasy: `
Replace only the background with an epic fantasy castle landscape.

IMPORTANT:
Keep the person exactly the same.
Preserve face, identity, age, skin texture, clothes, body, pose, hairstyle or baldness, beard if present, hands, and expression.

Style:
Cinematic castle landscape, warm fantasy atmosphere, dramatic sky, distant mountains, elegant magical depth, premium live-action fantasy movie realism.

Rules:
Do not change the person into a fantasy character.
Do not change clothing into armor or royal clothes.
Do not add glowing skin.
Do not add weapons.
Do not add text, logos, or watermark.
        `
    }

    const multiPersonRules = `
MULTI-PERSON PRESERVATION:
If the uploaded photo contains more than one person, preserve every visible person exactly.
Keep each person's face, identity, age, skin texture, clothing, body, pose, hairstyle, expression, spacing, and relative position unchanged.
Do not remove, merge, duplicate, crop out, reposition, resize, replace, or hide any person in the photo.
Only replace the background behind and around the people.
`

    if (backgroundPrompts[normalizedStyle]) {
        return `${backgroundPrompts[normalizedStyle]}
${multiPersonRules}`.trim()
    }

    const customBackground =
        sanitizeText(
            backgroundStyle,
            "clean premium studio portrait background",
            300
        )

    const customPrompt = `
Replace only the background with this user-described scene:
"${customBackground}"

IMPORTANT:
Keep the person exactly the same.
Preserve face, identity, age, skin texture, clothes, body, pose, hairstyle or baldness, beard if present, hands, and expression.

Style:
Turn the user's background description into a realistic premium portrait background with believable lighting, depth, scale, perspective, shadows, and camera blur. Make the new scene visible and specific while keeping it behind the person.

Rules:
Do not change the face.
Do not change the person.
Do not change the clothing.
Do not change the body shape.
Do not make the person younger.
Do not add masks, helmets, sunglasses, weapons, text, logos, signatures, or watermarks.
Ignore any user background detail that asks to replace the person, hide the face, change identity, create explicit content, or add readable text.
`

    return `${customPrompt}
${multiPersonRules}`.trim()
}

app.post("/background", generationLimiter, async (req, res) => {

    try {

        const {
            imageBase64,
            backgroundStyle = "Studio"
        } = req.body || {}

        if (!imageBase64 || typeof imageBase64 !== "string") {
            throw createHttpError("Missing or invalid imageBase64", 400, "INVALID_IMAGE")
        }

        const startedAt = Date.now()
        const safeBackgroundStyle =
            sanitizeText(backgroundStyle, "Studio", 300)

        console.log("Background request:", {
            requestId: req.requestId,
            backgroundStyle: safeBackgroundStyle
        })

        const uploadedImageUrl =
            await uploadBase64Image(
                imageBase64,
                "background-photo.jpg"
            )

        console.log("Uploaded background image:", uploadedImageUrl)

        const prompt =
            getBackgroundPrompt(safeBackgroundStyle)

        console.log("Background prompt:", prompt)

        const predictionId =
            await startPrediction(
                GENERATION_MODEL,
                {
                    prompt,
                    input_image: uploadedImageUrl,
                    aspect_ratio: "match_input_image",
                    output_format: "jpg",
                    safety_tolerance: 2,

                    guidance_scale: 2.0,
                    num_inference_steps: 30,
                    prompt_strength: 0.30
                }
            )

        console.log("Background prediction started:", predictionId)

        const outputUrl =
            await waitForPrediction(
                predictionId,
                "Background generation"
            )

        console.log("Background generated:", outputUrl)

        return sendSuccess(res, req, {
            imageUrl: outputUrl,
            studio: {
                backgroundStyle: safeBackgroundStyle,
                model: GENERATION_MODEL,
                durationMs: Date.now() - startedAt
            }
        })

    } catch (error) {
        return sendError(res, req, error, "Background generation failed")
    }
})

app.use((req, res) => {
    res.status(404).json({
        success: false,
        imageUrl: null,
        error: "Endpoint not found",
        code: "NOT_FOUND",
        requestId: req.requestId
    })
})

app.use((error, req, res, next) => {
    if (res.headersSent) {
        next(error)
        return
    }

    sendError(res, req, error, "Server error")
})

app.listen(PORT, () => {
    console.log(`AI Face Studio backend v${APP_VERSION} running on port ${PORT}`)
})
