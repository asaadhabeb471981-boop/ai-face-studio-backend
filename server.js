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
    `Transform this person into a dark cinematic superhero character. ${identityRule} Premium armored suit, dramatic storm clouds, heroic movie-poster lighting, glowing energy accents, realistic skin texture, powerful stance, ultra detailed blockbuster style.`,
    `Transform this person into a futuristic tech superhero. ${identityRule} Sleek high-tech armor, glowing chest core, neon reflections, cinematic sci-fi city background, premium realistic lighting, sharp facial detail.`,
    `Transform this person into a cosmic superhero legend. ${identityRule} Galaxy energy aura, starfield background, elegant heroic costume, glowing cosmic particles, epic cinematic lighting, premium fantasy-sci-fi realism.`,
    `Transform this person into a tactical night vigilante. ${identityRule} Black luxury tactical armor, rainy city rooftop, dramatic shadows, intense realistic mood, premium superhero film look.`,
    `Transform this person into a lightning-powered superhero. ${identityRule} Electric energy around the body, stormy sky, glowing blue-purple highlights, cinematic action portrait, ultra premium realistic detail.`,
    `Transform this person into a mystical superhero guardian. ${identityRule} Magical glowing symbols, elegant armor, dark fantasy atmosphere, purple energy portals, cinematic heroic portrait.`
]

const fantasyPrompts = [
    `Transform this person into a legendary fantasy king or queen. ${identityRule} Royal armor, glowing crown, cinematic castle throne room, golden firelight, epic fantasy movie-poster atmosphere, ultra realistic detail.`,

    `Transform this person into a powerful fire mage warrior. ${identityRule} Burning magical energy, glowing runes, volcanic fantasy environment, dramatic cinematic lighting, premium fantasy realism.`,

    `Transform this person into an ancient dragon guardian. ${identityRule} Elegant fantasy armor, dragon energy aura, glowing eyes, cinematic fantasy mountains, ultra detailed magical atmosphere.`,

    `Transform this person into a dark fantasy assassin. ${identityRule} Hooded luxury armor, smoke effects, moonlit medieval city, mysterious cinematic shadows, realistic fantasy movie style.`,

    `Transform this person into an enchanted elf warrior. ${identityRule} Elegant fantasy clothing, magical forest, glowing green-blue particles, cinematic fantasy lighting, premium realism.`,

    `Transform this person into a legendary knight commander. ${identityRule} Detailed silver armor, battlefield atmosphere, royal banners, cinematic medieval realism, blockbuster fantasy style.`
]

const cyberpunkPrompts = [
    `Transform this person into a premium cyberpunk hacker. ${identityRule} Purple-blue neon lighting, holographic screens, futuristic fashion, cinematic rainy city atmosphere, ultra realistic sci-fi detail.`,

    `Transform this person into a futuristic android mercenary. ${identityRule} Cybernetic enhancements, glowing circuitry, metallic textures, cinematic neon reflections, premium sci-fi realism.`,

    `Transform this person into a luxury cyberpunk street rebel. ${identityRule} Neon jacket, futuristic city alley, holograms, dramatic lighting, cinematic cyberpunk movie-poster style.`,

    `Transform this person into a cyber ninja assassin. ${identityRule} Black futuristic armor, glowing energy katana, rooftop neon skyline, smoke atmosphere, premium cinematic action realism.`,

    `Transform this person into a blade-runner style detective. ${identityRule} Long futuristic coat, rainy neon streets, moody noir lighting, elegant cyberpunk atmosphere, ultra detailed portrait.`,

    `Transform this person into a futuristic cyber soldier. ${identityRule} Tactical sci-fi armor, glowing visor, battlefield neon environment, cinematic lighting, blockbuster sci-fi realism.`
]

const animePrompts = [
    `Transform this person into a premium anime hero. ${identityRule} Ultra polished anime style, cinematic lighting, expressive eyes, sharp anime detail, vibrant colors, blockbuster anime movie atmosphere.`,

    `Transform this person into a futuristic anime warrior. ${identityRule} High-tech anime armor, glowing neon effects, cinematic sci-fi anime city, premium anime realism, dramatic action mood.`,

    `Transform this person into an elite anime samurai. ${identityRule} Elegant samurai armor, cherry blossom atmosphere, cinematic anime sunset, ultra detailed anime illustration style.`,

    `Transform this person into a dark anime assassin. ${identityRule} Hooded ninja outfit, moonlit rooftop, cinematic anime shadows, glowing energy effects, premium anime action realism.`,

    `Transform this person into a magical anime guardian. ${identityRule} Fantasy anime robes, glowing magical particles, cinematic enchanted world, elegant anime movie-poster style.`,

    `Transform this person into an anime legend character. ${identityRule} Heroic anime pose, ultra detailed hair and eyes, cinematic background, polished modern anime masterpiece quality.`
]

const professionalPrompts = [
    `Transform this person into a luxury CEO portrait. ${identityRule} Tailored premium suit, elegant studio lighting, modern executive office background, cinematic business magazine photography, ultra realistic detail.`,

    `Transform this person into a world-class entrepreneur portrait. ${identityRule} Smart luxury fashion, modern tech office, confident cinematic lighting, premium startup founder aesthetic, realistic professional photography.`,

    `Transform this person into a Hollywood celebrity portrait. ${identityRule} Premium studio lighting, cinematic background blur, luxury styling, ultra realistic skin detail, elegant blockbuster headshot quality.`,

    `Transform this person into a high-fashion magazine cover portrait. ${identityRule} Editorial lighting, luxury outfit styling, premium beauty photography, cinematic color grading, Vogue-level realism.`,

    `Transform this person into a luxury executive portrait. ${identityRule} Elegant dark suit, modern boardroom atmosphere, cinematic business lighting, premium LinkedIn-quality professional realism.`,

    `Transform this person into a premium personal brand portrait. ${identityRule} Soft cinematic studio lighting, modern luxury fashion, elegant social media influencer aesthetic, ultra polished realistic portrait.`
]

const cartoonPrompts = [
    `Transform this person into a premium animated movie character. ${identityRule} Ultra polished 3D cartoon style, cinematic animated lighting, expressive eyes, colorful Pixar-style atmosphere, high-end animation quality.`,

    `Transform this person into a modern cartoon superhero. ${identityRule} Bold animated outlines, vibrant colors, dynamic cartoon action atmosphere, polished comic-animation realism, cinematic cartoon lighting.`,

    `Transform this person into a luxury 3D cartoon avatar. ${identityRule} Smooth skin shading, premium animated textures, cheerful cinematic background, ultra detailed modern cartoon design.`,

    `Transform this person into a retro animated character. ${identityRule} Vintage cartoon aesthetic, warm cinematic colors, polished animated style, playful premium cartoon atmosphere.`,

    `Transform this person into a modern social media cartoon avatar. ${identityRule} Clean premium animated look, stylish colorful background, polished influencer-avatar aesthetic, cinematic cartoon realism.`,

    `Transform this person into a cinematic caricature portrait. ${identityRule} Slightly stylized facial features while preserving identity, premium animated lighting, elegant cartoon realism, high-end illustration quality.`
]

const moodText =
    mood === "Serious"
        ? "Use a serious intense expression, darker lighting, dramatic mood."
        : mood === "Luxury"
            ? "Use luxury premium styling, elegant lighting, expensive fashion look."
            : "Use cinematic lighting, balanced dramatic style, premium movie-poster quality."

const strengthText =
    strength === "Accurate"
        ? "Identity preservation is the highest priority. Keep the transformation subtle and realistic. Preserve the exact same face, same facial structure, same eyes, same nose, same mouth, same skin tone, same hairstyle, same age, same gender, and same expression. Do not beautify too much. Do not change the person into a different-looking person."
        : strength === "Extreme"
            ? "Create a bold and dramatic transformation, but the person must still be clearly recognizable. Preserve the same face identity, facial structure, eyes, nose, mouth, gender, age, hairstyle, and skin tone while applying stronger cinematic styling."
            : "Use a balanced transformation. Preserve the person's real identity clearly while applying premium cinematic styling. Keep the same face structure, gender, age, hairstyle, eyes, nose, mouth, and skin tone."

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

Transform this person into an ultra premium futuristic AI avatar. ${identityRule}

Hyper realistic facial detail, premium cinematic movie-poster quality, luxury sci-fi aesthetic, glowing holographic particles, dark purple neon studio environment, ultra detailed skin texture, cinematic rim lighting, volumetric light beams, realistic eyes, premium color grading, futuristic fashion styling, dramatic atmosphere, sharp focus, depth of field, high-end blockbuster visual effects, premium cybernetic details, elegant futuristic realism.

Make the portrait visually stunning, expensive-looking, highly cinematic, and social-media viral quality while preserving the person's real identity naturally.`
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
safety_tolerance: 2,
guidance_scale: 3.5,
num_inference_steps: 35
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

        // upscale final image
const upscaleResponse = await axios.post(
    "https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions",
    {
        input: {
            image: outputUrl,
            scale: 2,
            face_enhance: true
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

const upscalePredictionId = upscaleResponse.data.id

console.log("Upscale started:", upscalePredictionId)

let upscaleUrl = outputUrl

for (let i = 0; i < 30; i++) {

    await new Promise(resolve =>
        setTimeout(resolve, 2000)
    )

    const upscalePoll = await axios.get(
        `https://api.replicate.com/v1/predictions/${upscalePredictionId}`,
        {
            headers: {
                Authorization:
                    `Token ${process.env.REPLICATE_API_TOKEN}`
            }
        }
    )

    const upscalePrediction = upscalePoll.data

    console.log("Upscale status:", upscalePrediction.status)

    if (upscalePrediction.status === "succeeded") {

        upscaleUrl = Array.isArray(upscalePrediction.output)
            ? upscalePrediction.output[0]
            : upscalePrediction.output

        break
    }

if (upscalePrediction.status === "failed") {
    console.log("Upscale failed, returning original AI image")
    break
}

}

return res.json({
    success: true,
    imageUrl: upscaleUrl
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
