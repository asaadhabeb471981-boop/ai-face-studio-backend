require("dotenv").config()

const express = require("express")
const cors = require("cors")
const axios = require("axios")
const FormData = require("form-data")

const app = express()

app.use(cors())
app.use(express.json({ limit: "50mb" }))

app.get("/", (req, res) => {
    res.send("AI Face Studio Backend Running")
})

app.post("/generate", async (req, res) => {

    try {

        const {
  styleName,
  imageBase64,
  mood,
  strength,
  variation,
  genderMode
} = req.body;
console.log("Mood:", mood)
console.log("Strength:", strength)
console.log("Variation:", variation)
console.log("Gender Mode:", genderMode)

        console.log("Style:", styleName)

        const pickRandom = (items) => {
    return items[Math.floor(Math.random() * items.length)]
}

const identityRule =
    "Preserve exact facial identity, gender, age, face shape, hairstyle, beard if present, glasses if present, eyes, nose, mouth, skin tone, and expression. Do not change the person into someone else. If the input person is female, keep them female. If the input person is male, keep them male. Preserve the original person's identity naturally and realistically."

const superheroPrompts = [
    `Transform this person into an agile web-inspired urban superhero. ${identityRule} Red and blue tactical suit, dynamic city rooftop background, heroic comic-book energy, cinematic lighting.`,
    `Transform this person into a dark vigilante superhero. ${identityRule} Black tactical armor, dramatic shadows, rainy city night, serious heroic mood, premium movie-poster style.`,
    `Transform this person into a futuristic armored tech superhero. ${identityRule} High-tech metallic armor, glowing chest core, sci-fi laboratory background, cinematic reflections, ultra detailed.`,
    `Transform this person into a cosmic energy superhero. ${identityRule} Glowing galaxy powers, starfield background, radiant aura, powerful heroic pose, epic cinematic portrait.`,
    `Transform this person into a thunder storm superhero. ${identityRule} Electric lightning powers, stormy sky, glowing eyes, heroic armor, dramatic blockbuster lighting.`,
    `Transform this person into a mystical magic superhero. ${identityRule} Ancient glowing symbols, magical cloak, energy portals, dark fantasy superhero atmosphere, premium cinematic style.`
]

const fantasyPrompts = [
    `Transform this person into a dark fantasy royal leader. ${identityRule} Royal armor, ancient crown, castle throne room, golden firelight, epic fantasy movie poster.`,
    `Transform this person into a fire mage warrior. ${identityRule} Burning magical hands, dark robes, glowing runes, volcanic background, dramatic fantasy lighting.`,
    `Transform this person into a Viking warrior. ${identityRule} Fur armor, battle scars, snowy mountains, ancient Norse atmosphere, powerful cinematic portrait.`,
    `Transform this person into an elf ranger. ${identityRule} Elegant leather armor, enchanted forest, glowing bow, magical green light, premium fantasy character art.`,
    `Transform this person into a shadow assassin. ${identityRule} Dark hooded armor, smoke, moonlit castle walls, mysterious fantasy atmosphere, sharp dramatic lighting.`,
    `Transform this person into an ancient knight commander. ${identityRule} Detailed steel armor, battlefield background, royal banner, cinematic medieval realism.`
]

const cyberpunkPrompts = [
    `Transform this person into a neon cyberpunk hacker. ${identityRule} Purple and blue neon lighting, holographic screens, dark tech room, futuristic streetwear.`,
    `Transform this person into an android mercenary. ${identityRule} Cybernetic face details, glowing circuits, metallic jacket, rainy futuristic city, cinematic sci-fi portrait.`,
    `Transform this person into a cyber ninja. ${identityRule} Black futuristic armor, neon katana, rooftop city background, smoke, action movie lighting.`,
    `Transform this person into a futuristic street rebel. ${identityRule} Neon jacket, cyberpunk alley, graffiti, holograms, strong attitude, premium sci-fi fashion portrait.`,
    `Transform this person into a blade-runner style detective. ${identityRule} Long dark coat, rainy neon city, moody lighting, cinematic cyberpunk noir atmosphere.`,
    `Transform this person into a cyber soldier. ${identityRule} Tactical sci-fi armor, glowing visor, battlefield city background, blue neon energy, ultra detailed.`
]

const animePrompts = [
    `Transform this person into a shonen anime hero. ${identityRule} Clean anime line art, expressive eyes, heroic pose, vibrant colors, dramatic anime lighting.`,
    `Transform this person into a samurai anime warrior. ${identityRule} Traditional armor, katana, cherry blossoms, cinematic anime sunset, polished anime portrait.`,
    `Transform this person into a futuristic anime pilot. ${identityRule} Sci-fi flight suit, glowing cockpit, anime mecha background, blue neon lighting.`,
    `Transform this person into an anime ninja fighter. ${identityRule} Dark ninja outfit, moonlit rooftop, dynamic anime shadows, sharp clean line art.`,
    `Transform this person into an anime school hero. ${identityRule} Stylish anime outfit, modern city background, bright clean anime colors, friendly polished look.`,
    `Transform this person into an anime villain portrait. ${identityRule} Dark dramatic background, intense eyes, elegant villain outfit, cinematic anime mood.`
]

const professionalPrompts = [
    `Transform this person into a luxury CEO portrait. ${identityRule} Tailored premium suit, modern office background, soft studio lighting, business magazine photography.`,
    `Transform this person into a luxury startup founder portrait. ${identityRule} Smart casual blazer, modern tech office, confident expression, clean professional lighting.`,
    `Transform this person into a Hollywood celebrity portrait. ${identityRule} Premium studio lighting, cinematic background blur, realistic skin texture, elegant portrait photography.`,
    `Transform this person into a fashion magazine portrait. ${identityRule} Luxury outfit, editorial lighting, high-end photography, stylish modern background.`,
    `Transform this person into a luxury executive portrait. ${identityRule} Dark suit, elegant boardroom, confident premium look, sharp professional photography.`,
    `Transform this person into a luxury personal brand portrait. ${identityRule} Clean background, soft cinematic lighting, elegant outfit, premium social media profile style.`
]

const cartoonPrompts = [
    `Transform this person into a polished animated movie character. ${identityRule} Smooth shading, friendly expression, colorful background, premium 3D cartoon look.`,
    `Transform this person into a comic strip cartoon hero. ${identityRule} Bold outlines, bright colors, expressive face, dynamic comic-style background.`,
    `Transform this person into a cute 3D cartoon avatar. ${identityRule} Rounded features, soft lighting, cheerful colors, high-quality animated character design.`,
    `Transform this person into a retro cartoon character. ${identityRule} Vintage animation style, bold shapes, warm colors, playful background.`,
    `Transform this person into a modern social media cartoon avatar. ${identityRule} Clean vector-like look, bright background, polished friendly character style.`,
    `Transform this person into a stylized caricature cartoon. ${identityRule} Slightly exaggerated features while still preserving identity, fun expression, premium illustration style.`
]

const moodText =
    mood === "Serious"
        ? "Use a serious intense expression, darker lighting, dramatic mood."
        : mood === "Luxury"
            ? "Use luxury premium styling, elegant lighting, expensive fashion look."
            : "Use cinematic lighting, balanced dramatic style, premium movie-poster quality."

const strengthText =
    strength === "Accurate"
        ? "Keep the transformation subtle and realistic. Strongly preserve the original face identity, natural proportions, and real facial details."
        : strength === "Extreme"
            ? "Make the transformation bold, dramatic, highly stylized, and visually powerful while still keeping the person recognizable."
            : "Use a balanced transformation with strong style but clear face identity preservation."

let genderRule = "";

if (genderMode === "Female") {

    genderRule =
        "The input person is female. Keep her female. Preserve feminine facial features, hairstyle, body shape, age, and natural expression. Do not masculinize the person. Do not add masculine jawline, beard, mustache, or male appearance.";

} else if (genderMode === "Male") {

    genderRule =
        "The input person is male. Keep him male. Preserve masculine facial features, beard if present, hairstyle, body shape, age, and expression.";

} else {

    genderRule =
        "Preserve the person's original gender presentation exactly as shown in the input image.";
}

let prompt = ""

switch (styleName) {

    case "AI Avatar":
        prompt =
    `${genderRule}

Transform this person into a premium futuristic AI avatar. ${identityRule} Glowing holographic details, dark purple neon studio background, cinematic rim lighting, ultra sharp face detail, realistic but futuristic.`
        break

   case "Superhero":

    if (variation === "Variation 1") {
        prompt = `${genderRule}\n\n${superheroPrompts[0]}`
    }
    else if (variation === "Variation 2") {
        prompt = `${genderRule}\n\n${superheroPrompts[1]}`
    }
    else if (variation === "Variation 3") {
        prompt = `${genderRule}\n\n${superheroPrompts[2]}`
    }
    else {
        prompt = `${genderRule}\n\n${pickRandom(superheroPrompts)}`
    }

    break

case "Fantasy":
    prompt = `${genderRule}\n\n${pickRandom(fantasyPrompts)}`
    break

case "Cyberpunk":
    prompt = `${genderRule}\n\n${pickRandom(cyberpunkPrompts)}`
    break

case "Anime":
    prompt = `${genderRule}\n\n${pickRandom(animePrompts)}`
    break

case "Professional":
    prompt = `${genderRule}\n\n${pickRandom(professionalPrompts)}`
    break

case "Cartoon":
    prompt = `${genderRule}\n\n${pickRandom(cartoonPrompts)}`
    break

    case "Headshot":
        prompt =
    `${genderRule}

Transform this person into a clean professional business headshot. ${identityRule} Realistic skin texture, premium studio lighting, modern suit, clean soft background, sharp corporate photography, LinkedIn profile quality.`
        break

    default:
        prompt =
    `${genderRule}

Transform this person into a high-quality premium AI portrait. ${identityRule}`
}

prompt = `${prompt} ${moodText} ${strengthText}`

console.log("Prompt:", prompt)

        // remove data:image/jpeg;base64,
        const cleanedBase64 = imageBase64.replace(
            /^data:image\/\w+;base64,/,
            ""
        )

        const imageBuffer = Buffer.from(cleanedBase64, "base64")

        // upload image to replicate
        const form = new FormData()

        form.append("content", imageBuffer, {
            filename: "photo.jpg",
            contentType: "image/jpeg"
        })

        const uploadResponse = await axios.post(
            "https://api.replicate.com/v1/files",
            form,
            {
                headers: {
                    Authorization:
                        `Token ${process.env.REPLICATE_API_TOKEN}`,
                    ...form.getHeaders()
                }
            }
        )

        const uploadedImageUrl = uploadResponse.data.urls.get

        console.log("Uploaded image:", uploadedImageUrl)

        const startResponse = await axios.post(
            "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions",
            {
                input: {
                    prompt: prompt,
                    input_image: uploadedImageUrl,
                    aspect_ratio: "1:1",
                    output_format: "jpg",
                    safety_tolerance: 2
                }
            },
            {
                headers: {
                    Authorization:
                        `Token ${process.env.REPLICATE_API_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        )

        const predictionId = startResponse.data.id

        console.log("Prediction started:", predictionId)

        let outputUrl = null

        for (let i = 0; i < 30; i++) {

            await new Promise(resolve =>
                setTimeout(resolve, 2000)
            )

            const pollResponse = await axios.get(
                `https://api.replicate.com/v1/predictions/${predictionId}`,
                {
                    headers: {
                        Authorization:
                            `Token ${process.env.REPLICATE_API_TOKEN}`
                    }
                }
            )

            const prediction = pollResponse.data

            console.log("Status:", prediction.status)

            if (prediction.status === "succeeded") {

                if (Array.isArray(prediction.output)) {
                    outputUrl = prediction.output[0]
                } else {
                    outputUrl = prediction.output
                }

                break
            }

            if (prediction.status === "failed") {

                console.log(prediction)

                throw new Error("AI generation failed")
            }
        }

        if (!outputUrl) {
            throw new Error("Generation timeout")
        }

        return res.json({
            success: true,
            imageUrl: outputUrl
        })

    } catch (error) {

        console.log(error.response?.data || error.message)

        return res.status(500).json({
            success: false,
            imageUrl: null,
            error: "Generation failed"
        })
    }
})

app.post("/background", async (req, res) => {

    try {

        const { imageBase64, backgroundStyle } = req.body

        console.log("Background style:", backgroundStyle)

        let prompt = ""

        switch (backgroundStyle) {

            case "Beach":
                prompt =
                    "Replace the background with a beautiful tropical beach sunset. Keep the person exactly the same, preserve face, clothes, body, and pose. Natural lighting, realistic premium photo."
                break

            case "Cyberpunk":
                prompt =
                    "Replace the background with a futuristic cyberpunk neon city at night. Keep the person exactly the same, preserve face, clothes, body, and pose. Purple and blue neon lights, cinematic realistic look."
                break

            case "Office":
                prompt =
                    "Replace the background with a luxury modern office. Keep the person exactly the same, preserve face, clothes, body, and pose. Professional lighting, clean business portrait style."
                break

            case "Fantasy":
                prompt =
                    "Replace the background with an epic fantasy castle landscape. Keep the person exactly the same, preserve face, clothes, body, and pose. Magical lighting, cinematic fantasy atmosphere."
                break

            default:
                prompt =
                    "Replace the background with a beautiful premium studio background. Keep the person exactly the same."
        }

        const cleanedBase64 = imageBase64.replace(
            /^data:image\/\w+;base64,/,
            ""
        )

        const imageBuffer = Buffer.from(cleanedBase64, "base64")

        const form = new FormData()

        form.append("content", imageBuffer, {
            filename: "background-photo.jpg",
            contentType: "image/jpeg"
        })

        const uploadResponse = await axios.post(
            "https://api.replicate.com/v1/files",
            form,
            {
                headers: {
                    Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
                    ...form.getHeaders()
                }
            }
        )

        const uploadedImageUrl = uploadResponse.data.urls.get

        console.log("Uploaded background image:", uploadedImageUrl)

        const startResponse = await axios.post(
            "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions",
            {
                input: {
                    prompt: prompt,
                    input_image: uploadedImageUrl,
                    aspect_ratio: "match_input_image",
                    output_format: "jpg",
                    safety_tolerance: 2
                }
            },
            {
                headers: {
                    Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        )

        const predictionId = startResponse.data.id

        console.log("Background prediction started:", predictionId)

        let outputUrl = null

        for (let i = 0; i < 30; i++) {

            await new Promise(resolve => setTimeout(resolve, 2000))

            const pollResponse = await axios.get(
                `https://api.replicate.com/v1/predictions/${predictionId}`,
                {
                    headers: {
                        Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`
                    }
                }
            )

            const prediction = pollResponse.data

            console.log("Background status:", prediction.status)

            if (prediction.status === "succeeded") {

                outputUrl = Array.isArray(prediction.output)
                    ? prediction.output[0]
                    : prediction.output

                break
            }

            if (prediction.status === "failed") {
                console.log(prediction)
                throw new Error("Background generation failed")
            }
        }

        if (!outputUrl) {
            throw new Error("Background generation timeout")
        }

        return res.json({
            success: true,
            imageUrl: outputUrl,
            error: null
        })

    } catch (error) {

        console.log(error.response?.data || error.message)

        return res.status(500).json({
            success: false,
            imageUrl: null,
            error: "Background generation failed"
        })
    }
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
