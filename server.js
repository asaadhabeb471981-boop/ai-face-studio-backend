require("dotenv").config()

const express = require("express")
const cors = require("cors")
const axios = require("axios")
const FormData = require("form-data")
const crypto = require("crypto")
const compression = require("compression")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")

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
const UPSCALE_MODEL = process.env.REPLICATE_UPSCALE_MODEL || "nightmareai/real-esrgan"
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "*")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)

const studioOptions = {
    styles: [
        "AI Avatar",
        "Headshot",
        "Professional",
        "Superhero",
        "Fantasy",
        "Cyberpunk",
        "Anime",
        "Cartoon"
    ],
    moods: ["Cinematic", "Serious", "Luxury", "Editorial", "Dramatic", "Natural"],
    strengths: ["Accurate", "Balanced", "Extreme"],
    variations: ["Random", "Variation 1", "Variation 2", "Variation 3"],
    genderModes: ["Auto", "Female", "Male"],
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
        return "The input person is female. Keep her female. Preserve feminine facial features, hairstyle, body shape, age, and natural expression. Do not masculinize the person. Do not add masculine jawline, beard, mustache, or male appearance."
    }

    if (genderMode === "Male") {
        return "The input person is male. Keep him male. Preserve masculine facial features, beard if present, hairstyle, body shape, age, and expression."
    }

    return "Preserve the person's original gender presentation exactly as shown in the input image."
}

const identityRule = `
Preserve the exact facial identity from the uploaded image.
Do not replace the person with another actor, celebrity, younger version, or generic AI face.
Keep the same gender, age, face shape, forehead, wrinkles, skin texture, eyes, nose, lips, cheeks, jawline, ears, hairstyle or baldness, beard if present, glasses if present, skin tone, and natural expression.
The final image must still look clearly like the same real person.
`

const superheroPrompts = [
`
Transform the same person into a powerful Marvel-style cinematic superhero.

The result must look like a real blockbuster superhero movie still.
The person must wear a premium superhero suit, not tactical military clothing, not casual clothing, not a street vigilante outfit.

Suit design:
Advanced cinematic superhero armor, elegant heroic silhouette, layered futuristic plating, glowing energy core, detailed suit seams, premium materials, powerful Marvel-inspired costume realism.

Powers:
Cinematic energy aura, controlled glowing particles, realistic VFX, powerful superhero presence, dramatic environmental reflections.

Environment:
Epic futuristic city skyline, atmospheric smoke, dramatic sky, blockbuster movie scale, cinematic destruction in the distance.

Lighting:
Premium cinematic lighting, strong key light, realistic shadows, heroic glow, IMAX-style movie color grading.

Face rule:
The face must remain extremely close to the uploaded person. Change the suit, power, and environment more than the face.
`,

`
Reimagine the same person as an iconic Marvel-style superhero standing in a cinematic battle scene.

The outfit must look like a real superhero costume from a premium comic-book movie:
sleek armored chest plate, heroic shoulder structure, glowing red or blue energy details, luxury textured materials, sharp cinematic silhouette, high-end superhero design.

Do not make the outfit look like a soldier, police, SWAT, biker, or tactical vest.
It must feel superhuman, powerful, and iconic.

Preserve the real face strongly.
Keep the same age, wrinkles, forehead, nose, eyes, lips, jawline, beard or baldness if present.
The final result must look like the same person wearing a superhero suit.
`,

`
Create a premium live-action superhero movie poster of the same person.

The person should look like a central Marvel-style hero:
heroic armored suit, glowing energy reactor, dramatic cape or advanced suit panels if suitable, cinematic energy effects, premium blockbuster composition.

Make the scene visually spectacular:
futuristic city, smoke, sparks, energy waves, dramatic sky, strong movie lighting.

Identity lock:
Do not make the person younger.
Do not beautify the face heavily.
Do not change facial proportions.
Do not replace the face with a fake actor face.
Keep the original person's real facial identity highly recognizable.
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
Luxury executive portrait, elegant business suit, premium office background blur, cinematic professional lighting, realistic skin tones, refined corporate atmosphere, high-end LinkedIn-quality photography, premium camera depth of field.

Rules:
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
High-end CEO portrait, refined formal clothing, elegant executive office atmosphere, warm professional lighting, premium camera realism, cinematic depth of field, luxury business environment, believable executive photography.

Rules:
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
Modern entrepreneur aesthetic, elegant smart-casual business styling, luxury minimal background, realistic cinematic lighting, social-media premium photography quality, warm natural tones, clean high-end portrait atmosphere.

Rules:
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
Using the uploaded image as the identity reference, transform the same person into a realistic luxury fantasy-inspired royal portrait.

IMPORTANT: ${identityRule}
Preserve the exact same real face, age, wrinkles, skin texture, forehead, eye bags, hairstyle or baldness, beard if present, jawline, cheeks, eyes, nose, lips, facial proportions, and natural expression.

Style:
Elegant royal fantasy portrait, luxurious medieval-inspired clothing, noble king or queen aesthetic, premium embroidered fabrics, cinematic castle environment, warm golden lighting, realistic shadows, atmospheric depth, high-end fantasy movie photography.

Environment:
Luxury royal hall, elegant throne room, cinematic castle interior, candles, warm ambient glow, premium fantasy atmosphere.

Rules:
Do not turn the person into a different fantasy character.
Do not make the person younger.
Do not heavily beautify the face.
Do not create glowing magical skin.
Do not create cartoon or anime style.
Keep the portrait realistic, cinematic, and highly recognizable as the same real person.
`,

`
Create a grounded cinematic noble portrait of the uploaded person.

IMPORTANT: ${identityRule}
Keep the face highly recognizable. Preserve natural aging, wrinkles, skin texture, hairstyle or baldness, beard if present, facial structure, jawline, cheeks, eyes, nose, lips, and natural expression.

Style:
Classic noble fantasy aesthetic, elegant royal clothing, luxury fabrics, cinematic warm lighting, realistic medieval-inspired environment, premium editorial photography, natural shadows, realistic skin detail, believable fantasy realism.

Environment:
Elegant palace interior, royal library, noble hall, warm firelight atmosphere, luxury architectural details, cinematic depth of field.

Rules:
No fake actor face.
No unrealistic beauty enhancement.
No heavy fantasy glow.
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
Epic fantasy movie realism, royal warrior or noble ruler aesthetic, luxurious fantasy clothing, cinematic dramatic lighting, realistic textures, premium blockbuster fantasy photography, elegant atmosphere, believable medieval realism.

Environment:
Grand fantasy castle balcony, misty royal kingdom background, cinematic sky, elegant architectural details, atmospheric lighting.

Rules:
Keep the face realistic and natural.
Do not dramatically change facial proportions.
Do not replace the person with a younger or more attractive AI character.
Avoid cartoon fantasy styling.
Avoid exaggerated magical effects.
The final image should feel like a real live-action fantasy movie portrait of the same person.
`
]

const cyberpunkPrompts = [
`
Using the uploaded image as the identity reference, transform the same person into a realistic futuristic cyberpunk city portrait.

IMPORTANT: ${identityRule}
Preserve the exact same real face, age, wrinkles, skin texture, forehead, eye bags, hairstyle or baldness, beard if present, jawline, cheeks, eyes, nose, lips, facial proportions, and natural expression.

Style:
Premium cyberpunk portrait, futuristic dark clothing, cinematic night city background, realistic neon reflections, high-tech urban atmosphere, rain-slick streets, soft city lights, premium camera depth of field, realistic skin tones.

Rules:
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
Sleek futuristic outfit, premium urban background, soft neon city lights, realistic cinematic photography, subtle high-tech atmosphere, elegant dark styling, natural skin texture, professional portrait realism.

Rules:
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
Luxury cyberpunk realism, cinematic neon skyline, elegant futuristic jacket, realistic rain reflections, moody urban lighting, premium sci-fi atmosphere, sharp professional portrait detail, high-end movie color grading.

Rules:
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
Modern anime movie rendering, premium illustrated textures, expressive anime eyes, cinematic anime lighting, clean detailed shading, elegant background atmosphere, high-end animated film quality.

Rules:
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
Premium anime hero portrait, cinematic anime lighting, polished illustration quality, detailed animated facial features, elegant heroic outfit, soft atmospheric background, modern anime film realism.

Rules:
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
High-end anime avatar, clean cinematic shading, expressive eyes, premium anime artwork, elegant lighting, refined outfit styling, soft depth background, polished animated portrait quality.

Rules:
The result must be clearly anime.
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
High-end 3D animated movie rendering, cinematic cartoon lighting, expressive animated eyes, premium stylized textures, smooth character shading, realistic depth, blockbuster animation quality, elegant animated atmosphere.

Rules:
The result must clearly look animated.
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
Premium cartoon avatar, cinematic 3D rendering, elegant lighting, smooth stylized textures, polished animated skin, expressive cartoon detail, modern animated realism, social-media premium avatar quality.

Rules:
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
Blockbuster animated film aesthetic, premium 3D cartoon realism, elegant cinematic lighting, expressive animated features, polished textures, luxury color grading, modern animation studio quality.

Rules:
Keep the character recognizable as the uploaded person.
Do not over-simplify the face.
Do not create unrealistic cartoon proportions.
Do not replace the identity with a random animated character.
The final image should look like a high-budget animated adaptation of the same real person.
`
]

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
        animated: cartoonPrompts
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
Use a serious confident expression.
Use realistic natural shadows.
Use mature premium portrait mood.
Use cinematic dramatic lighting with controlled contrast.
Maintain realistic skin tones and believable realism.
`,

        luxury: `
Use luxury realistic styling.
Use elegant clothing and refined atmosphere.
Use warm premium lighting.
Use high-end portrait photography aesthetics.
Create a sophisticated cinematic luxury mood.
`,

        cinematic: `
Use cinematic blockbuster lighting.
Use dramatic movie-style atmosphere.
Use realistic depth, shadows, and premium color grading.
Create high-end cinematic portrait realism.
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

function getStrengthText(strength, styleName) {

    const normalizedStrength =
        typeof strength === "string"
            ? strength.trim().toLowerCase()
            : "balanced"

    const normalizedStyle =
        typeof styleName === "string"
            ? styleName.trim().toLowerCase()
            : ""

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
- gender
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
- same gender
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
- same gender
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
    customPrompt
}) {

    const safeStyleName =
        typeof styleName === "string" && styleName.trim()
            ? styleName.trim()
            : "AI Avatar"

    const safeMood =
        typeof mood === "string" && mood.trim()
            ? mood.trim()
            : "Cinematic"

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

    const safeCustomPrompt =
        sanitizeText(customPrompt, "", 700)

    const normalizedStyle =
        safeStyleName.toLowerCase()

    const genderRule =
        getGenderRule(safeGenderMode)

    const selectedPrompt =
        getPromptByVariation(safeStyleName, safeVariation)

    const moodText =
        getMoodText(safeMood)

    const strengthText =
        getStrengthText(safeStrength, safeStyleName)

    let styleRules = ""

    if (normalizedStyle === "superhero") {

        styleRules = `
SUPERHERO RULES:

The result must clearly look like a real premium superhero movie scene.

The outfit must be:
- a cinematic superhero suit
- powerful
- iconic
- advanced
- polished
- visually superhuman
- premium movie-quality

The outfit must NOT be:
- tactical gear
- military clothing
- police armor
- normal clothes
- a leather jacket
- a biker outfit
- a SWAT vest
- a generic combat suit

Make the suit and environment dramatic, but keep the face highly recognizable.
Change the costume, background, lighting, and powers more than the face.
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

Use:
- elegant business clothing
- realistic office or studio background
- warm professional lighting
- premium camera depth of field
- refined corporate atmosphere

Avoid:
- fake CEO stock-photo face
- unrealistic beauty edits
- fantasy elements
- superhero costume
- cyberpunk effects
- cartoon/anime rendering
`
    }

    if (normalizedStyle === "fantasy") {

        styleRules = `
FANTASY RULES:

Create a realistic live-action fantasy portrait.

Use:
- royal or noble clothing
- cinematic castle or palace atmosphere
- warm fantasy movie lighting
- realistic luxury textures
- believable human skin

Avoid:
- cartoon fantasy rendering
- excessive glowing magic
- unrealistic fantasy skin
- changing the person into a different character
`
    }

    if (normalizedStyle === "cyberpunk") {

        styleRules = `
CYBERPUNK RULES:

Create a realistic futuristic city portrait.

Use:
- subtle neon reflections
- futuristic clothing
- cinematic night city background
- realistic urban atmosphere
- premium sci-fi photography

Avoid:
- robotic face changes
- helmets or masks covering the face
- extreme cybernetic implants
- anime/cartoon rendering
- replacing the person with a different cyberpunk character
`
    }

    if (normalizedStyle === "anime") {

        styleRules = `
ANIME RULES:

The result must clearly look like premium anime artwork.

Use:
- cinematic anime rendering
- expressive anime eyes
- polished illustration quality
- clean anime shading
- elegant animated atmosphere

Preserve the uploaded person's identity features while converting them into anime style.
Do not create a generic anime character.
`
    }

    if (normalizedStyle === "cartoon") {

        styleRules = `
CARTOON RULES:

The result must clearly look like a premium 3D animated character.

Use:
- cinematic cartoon lighting
- expressive animated eyes
- polished stylized textures
- smooth animated shading
- high-end animated movie quality

Preserve the uploaded person's recognizable identity.
Do not create a random cartoon character.
`
    }

    const finalPrompt = `
${genderRule}

IDENTITY LOCK:
${identityRule}

STYLE PROMPT:
${selectedPrompt}

MOOD:
${moodText}

STRENGTH:
${strengthText}

STYLE-SPECIFIC RULES:
${styleRules}

CUSTOM STUDIO DIRECTION:
${safeCustomPrompt
        ? `Use this user creative direction as a secondary style guide while obeying the identity and safety rules: ${safeCustomPrompt}`
        : "No custom user direction was provided. Follow the selected studio preset closely."}

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

function getGenerationSettings(strength) {

    const normalizedStrength =
        typeof strength === "string"
            ? strength.trim().toLowerCase()
            : "balanced"

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
            mood = "Cinematic",
            strength = "Balanced",
            variation = "Random",
            genderMode = "Auto",
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
        const safeStyleName = pickAllowed(styleName, studioOptions.styles, "AI Avatar")
        const safeMood = pickAllowed(mood, studioOptions.moods, "Cinematic")
        const safeStrength = pickAllowed(strength, studioOptions.strengths, "Balanced")
        const safeVariation = pickAllowed(variation, studioOptions.variations, "Random")
        const safeGenderMode = pickAllowed(genderMode, studioOptions.genderModes, "Auto")
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
                customPrompt: safeCustomPrompt
            })

        console.log("Prompt:", prompt)

        const settings =
            getGenerationSettings(safeStrength)

        const predictionId =
            await startPrediction(
                GENERATION_MODEL,
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
                    safeStrength.toLowerCase() === "extreme"

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
                aspectRatio: safeAspectRatio,
                customPromptApplied: Boolean(safeCustomPrompt),
                upscaleApplied,
                model: GENERATION_MODEL,
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

    return (
        backgroundPrompts[normalizedStyle] ||
        backgroundPrompts.studio
    ).trim()
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
            pickAllowed(backgroundStyle, studioOptions.backgroundStyles, "Studio")

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
