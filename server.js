require("dotenv").config()

const express = require("express")
const cors = require("cors")
const axios = require("axios")
const FormData = require("form-data")

const app = express()

app.use(cors())
app.use(express.json({ limit: "50mb" }))

const PORT = process.env.PORT || 3000
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN

if (!REPLICATE_TOKEN) {
    console.error("Missing REPLICATE_API_TOKEN in .env")
}

app.get("/", (req, res) => {
    res.send("AI Face Studio Backend Running")
})

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)]
}

function cleanBase64(imageBase64) {
    if (!imageBase64) throw new Error("Missing imageBase64")
    return imageBase64.replace(/^data:image\/\w+;base64,/, "")
}

async function uploadBase64Image(imageBase64, filename = "photo.jpg") {
    const imageBuffer = Buffer.from(cleanBase64(imageBase64), "base64")

    const form = new FormData()

    form.append("content", imageBuffer, {
        filename,
        contentType: "image/jpeg"
    })

    const response = await axios.post(
        "https://api.replicate.com/v1/files",
        form,
        {
            headers: {
                Authorization: `Token ${REPLICATE_TOKEN}`,
                ...form.getHeaders()
            }
        }
    )

    return response.data.urls.get
}

async function startPrediction(model, input) {
    const response = await axios.post(
        `https://api.replicate.com/v1/models/${model}/predictions`,
        { input },
        {
            headers: {
                Authorization: `Token ${REPLICATE_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    )

    return response.data.id
}

async function waitForPrediction(predictionId, label = "Prediction") {
    for (let i = 0; i < 45; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000))

        const response = await axios.get(
            `https://api.replicate.com/v1/predictions/${predictionId}`,
            {
                headers: {
                    Authorization: `Token ${REPLICATE_TOKEN}`
                }
            }
        )

        const prediction = response.data

        console.log(`${label} status:`, prediction.status)

        if (prediction.status === "succeeded") {
            return Array.isArray(prediction.output)
                ? prediction.output[0]
                : prediction.output
        }

        if (prediction.status === "failed" || prediction.status === "canceled") {
            console.log(prediction)
            throw new Error(`${label} failed`)
        }
    }

    throw new Error(`${label} timeout`)
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
Transform this person into a realistic premium AI avatar portrait.
Use elegant modern luxury clothing, realistic cinematic photography, natural skin texture, warm premium lighting, soft background blur, and high-end portrait quality.
No purple neon, no cyberpunk, no fantasy glow, no superhero suit.
`,

`
Create a high-end realistic AI portrait of this person.
Use refined luxury styling, elegant clothing, natural warm lighting, realistic background, premium camera depth of field, and believable professional photography.
Keep the face real and recognizable.
`,

`
Transform this person into a luxury realistic social-media avatar.
Use premium realistic portrait lighting, stylish modern outfit, elegant background, natural color grading, sharp professional detail, and believable cinematic realism.
`
]

const headshotPrompts = [
`
Create a realistic premium studio headshot.
Use clean professional studio lighting, elegant neutral background, realistic skin detail, formal clothing, and LinkedIn-quality photography.
`,

`
Create a luxury executive headshot.
Use elegant formal clothing, soft cinematic lighting, realistic office or studio background blur, and premium professional photography.
`,

`
Create a high-end business profile portrait.
Use refined professional styling, clean studio lighting, sharp portrait detail, and believable corporate photography.
`
]

const professionalPrompts = [
`
Transform this person into a premium executive portrait.
Use elegant business clothing, realistic studio lighting, premium office background blur, natural skin tones, and high-end LinkedIn-quality photography.
`,

`
Create a luxury CEO-style portrait.
Use refined formal clothing, realistic executive office atmosphere, warm professional lighting, premium camera depth of field, and believable business photography.
`,

`
Transform this person into a premium modern entrepreneur portrait.
Use elegant smart-casual business styling, realistic lighting, clean luxury background, and social-media premium photography quality.
`
]

const fantasyPrompts = [
`
Transform this person into a realistic luxury fantasy-inspired royal portrait.
Use elegant royal clothing, warm cinematic lighting, believable castle or luxury interior background, and premium realistic photography.
`,

`
Create a grounded cinematic noble portrait.
Use classic luxury styling, elegant background, natural skin texture, warm light, realistic shadows, and high-end editorial photography.
`
]

const cyberpunkPrompts = [
`
Transform this person into a realistic futuristic city portrait.
Use modern futuristic clothing, realistic night city background, subtle neon reflections, professional cinematic photography, and realistic skin.
`,

`
Create a believable modern tech-style AI portrait.
Use sleek dark clothing, realistic urban background, soft city lights, premium camera depth of field, and natural skin texture.
`
]

const animePrompts = [
`
Transform this person into a premium cinematic anime character.
Preserve the same recognizable identity while converting the person into polished anime style.
Use modern anime movie rendering, cinematic anime lighting, expressive eyes, clean shading, and premium artwork quality.
`,

`
Create a high-end anime hero portrait of this person.
Keep the same age, face shape, hairstyle or baldness, beard if present, and expression while applying premium anime stylization.
`
]

const cartoonPrompts = [
`
Transform this person into a premium 3D animated movie character.
Preserve the same identity while converting them into polished animated style.
Use cinematic cartoon lighting, expressive animated eyes, smooth stylized textures, and high-end 3D cartoon rendering.
`,

`
Create a luxury modern cartoon avatar of this person.
Use premium animated rendering, elegant lighting, smooth stylized textures, and cinematic 3D cartoon realism.
`
]

function getPromptSet(styleName) {
    switch (styleName) {
        case "Superhero":
            return superheroPrompts
        case "AI Avatar":
            return aiAvatarPrompts
        case "Headshot":
            return headshotPrompts
        case "Professional":
            return professionalPrompts
        case "Fantasy":
            return fantasyPrompts
        case "Cyberpunk":
            return cyberpunkPrompts
        case "Anime":
            return animePrompts
        case "Cartoon":
            return cartoonPrompts
        default:
            return aiAvatarPrompts
    }
}

function getPromptByVariation(styleName, variation) {
    const prompts = getPromptSet(styleName)

    if (variation === "Variation 1") return prompts[0] || pickRandom(prompts)
    if (variation === "Variation 2") return prompts[1] || prompts[0]
    if (variation === "Variation 3") return prompts[2] || prompts[0]

    return pickRandom(prompts)
}

function getMoodText(mood) {
    if (mood === "Serious") {
        return "Use a serious confident expression, realistic natural shadows, and mature premium portrait mood."
    }

    if (mood === "Luxury") {
        return "Use luxury realistic styling, elegant clothing, warm premium lighting, and high-end portrait atmosphere."
    }

    return "Use realistic cinematic lighting, natural color grading, and premium portrait quality."
}

function getStrengthText(strength, styleName) {
    if (styleName === "Cartoon") {
        return `
CARTOON MODE:
The final image must be clearly non-photorealistic and animated.
Use premium 3D cartoon style with stylized skin, expressive animated eyes, clean cartoon shading, and high-end animated film appearance.
Preserve the person's identity, gender, age, hairstyle or baldness, beard if present, face structure, and expression.
`
    }

    if (styleName === "Anime") {
        return `
ANIME MODE:
Create a clearly anime-styled character with cinematic anime rendering, illustrated textures, anime facial styling, and premium anime artwork quality.
Preserve the same identity, age, hairstyle or baldness, beard if present, expression, and gender.
`
    }

    if (strength === "Accurate") {
        return `
ACCURATE MODE:
Preserve the uploaded person's real identity extremely closely.
Keep the same age, wrinkles, forehead lines, eye bags, skin texture, pores, face shape, jawline, cheeks, nose, lips, eyes, eyebrows, ears, hairstyle or baldness, beard if present, expression, and natural imperfections.
Do not make the person younger.
Do not beautify heavily.
Do not smooth skin excessively.
Do not slim the face.
Do not sharpen the jawline.
Do not restore hair.
The final image must still clearly look like the same real person.
`
    }

    if (strength === "Extreme") {
        return `
EXTREME MODE:
Apply a strong cinematic AI transformation while keeping the person recognizable.
Allow stronger styling, dramatic atmosphere, outfit upgrades, cinematic lighting, and visual effects.
Still preserve the same real identity, age, facial structure, hairstyle or baldness, beard if present, skin tone, and expression.
`
    }

    return `
BALANCED MODE:
Apply premium AI portrait styling while keeping the person clearly recognizable.
Preserve the same face identity, age, wrinkles, skin texture, hairstyle or baldness, beard if present, facial proportions, and expression.
Allow stylish cinematic enhancement, outfit upgrades, premium lighting, and realistic atmosphere.
Avoid fake actor replacement, excessive beauty enhancement, unrealistic skin smoothing, or heavy face reconstruction.
`
}

function buildGeneratePrompt({ styleName, mood, strength, variation, genderMode }) {
    const genderRule = getGenderRule(genderMode)
    const selectedPrompt = getPromptByVariation(styleName, variation)
    const moodText = getMoodText(mood)
    const strengthText = getStrengthText(strength, styleName)

    let finalPrompt = `
${genderRule}

${identityRule}

${selectedPrompt}

${moodText}

${strengthText}
`

    if (styleName === "Superhero") {
        finalPrompt += `
SUPERHERO RULES:
The result must clearly look like a superhero movie scene.
The outfit must be a superhero suit, not tactical gear.
Do not create normal clothes.
Do not create a military vest.
Do not create a generic leather jacket.
Make the suit iconic, cinematic, powerful, and superhuman.
`
    }

    return finalPrompt
}

function getGenerationSettings(strength) {
    return {
        guidance_scale:
            strength === "Accurate" ? 2.0 :
            strength === "Balanced" ? 2.8 :
            3.6,

        num_inference_steps:
            strength === "Accurate" ? 26 :
            strength === "Balanced" ? 32 :
            38,

        prompt_strength:
            strength === "Accurate" ? 0.28 :
            strength === "Balanced" ? 0.42 :
            0.60
    }
}

app.post("/generate", async (req, res) => {
    try {
        const {
            styleName,
            imageBase64,
            mood = "Cinematic",
            strength = "Balanced",
            variation = "Random",
            genderMode = "Auto"
        } = req.body

        console.log("Generate request:", {
            styleName,
            mood,
            strength,
            variation,
            genderMode
        })

        if (!styleName) throw new Error("Missing styleName")
        if (!imageBase64) throw new Error("Missing imageBase64")

        const uploadedImageUrl = await uploadBase64Image(imageBase64, "photo.jpg")

        console.log("Uploaded image:", uploadedImageUrl)

        const prompt = buildGeneratePrompt({
            styleName,
            mood,
            strength,
            variation,
            genderMode
        })

        console.log("Prompt:", prompt)

        const settings = getGenerationSettings(strength)

        const selectedModel = "black-forest-labs/flux-kontext-pro"

        const predictionId = await startPrediction(selectedModel, {
            prompt,
            input_image: uploadedImageUrl,
            aspect_ratio: "1:1",
            output_format: "jpg",
            safety_tolerance: 2,
            ...settings
        })

        console.log("Prediction started:", predictionId)

        const generatedUrl = await waitForPrediction(predictionId, "AI generation")

        console.log("Generated image:", generatedUrl)

        let finalUrl = generatedUrl

        try {
            const upscalePredictionId = await startPrediction(
                "nightmareai/real-esrgan",
                {
                    image: generatedUrl,
                    scale: 2,
                    face_enhance: strength === "Extreme"
                }
            )

            console.log("Upscale started:", upscalePredictionId)

            finalUrl = await waitForPrediction(upscalePredictionId, "Upscale")
        } catch (upscaleError) {
            console.log("Upscale failed, returning original image:", upscaleError.message)
            finalUrl = generatedUrl
        }

        return res.json({
            success: true,
            imageUrl: finalUrl,
            error: null
        })

    } catch (error) {
        console.log("Generate error:", error.response?.data || error.message)

        return res.status(500).json({
            success: false,
            imageUrl: null,
            error: error.message || "Generation failed"
        })
    }
})

function getBackgroundPrompt(backgroundStyle) {
    switch (backgroundStyle) {
        case "Beach":
            return "Replace the background with a beautiful tropical beach sunset. Keep the person exactly the same, preserve face, clothes, body, and pose. Natural lighting, realistic premium photo."

        case "Cyberpunk":
            return "Replace the background with a futuristic cyberpunk neon city at night. Keep the person exactly the same, preserve face, clothes, body, and pose. Cinematic realistic look."

        case "Office":
            return "Replace the background with a luxury modern office. Keep the person exactly the same, preserve face, clothes, body, and pose. Professional lighting, clean business portrait style."

        case "Fantasy":
            return "Replace the background with an epic fantasy castle landscape. Keep the person exactly the same, preserve face, clothes, body, and pose. Cinematic fantasy atmosphere."

        default:
            return "Replace the background with a beautiful premium studio background. Keep the person exactly the same, preserve face, clothes, body, and pose."
    }
}

app.post("/background", async (req, res) => {
    try {
        const { imageBase64, backgroundStyle = "Studio" } = req.body

        if (!imageBase64) throw new Error("Missing imageBase64")

        console.log("Background style:", backgroundStyle)

        const uploadedImageUrl = await uploadBase64Image(
            imageBase64,
            "background-photo.jpg"
        )

        const prompt = getBackgroundPrompt(backgroundStyle)

        const predictionId = await startPrediction(
            "black-forest-labs/flux-kontext-pro",
            {
                prompt,
                input_image: uploadedImageUrl,
                aspect_ratio: "match_input_image",
                output_format: "jpg",
                safety_tolerance: 2,
                guidance_scale: 2.2,
                num_inference_steps: 28,
                prompt_strength: 0.35
            }
        )

        console.log("Background prediction started:", predictionId)

        const outputUrl = await waitForPrediction(
            predictionId,
            "Background generation"
        )

        return res.json({
            success: true,
            imageUrl: outputUrl,
            error: null
        })

    } catch (error) {
        console.log("Background error:", error.response?.data || error.message)

        return res.status(500).json({
            success: false,
            imageUrl: null,
            error: error.message || "Background generation failed"
        })
    }
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
