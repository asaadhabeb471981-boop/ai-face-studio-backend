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
        } = req.body

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
    `Transform this person into a realistic premium superhero-style portrait. ${identityRule} Preserve the exact same face, age, wrinkles, skin texture, baldness or hairstyle, beard if present, expression, and natural identity. Use realistic tactical outfit styling, cinematic natural lighting, believable background, premium movie-poster quality, but keep the face real and recognizable. No purple neon, no fantasy glow, no fake actor face.`,

    `Create a realistic heroic portrait of this person. ${identityRule} Keep the same real face, age, skin texture, wrinkles, hairline or baldness, beard if present, and expression. Add a refined dark tactical jacket or subtle armor-inspired outfit, realistic cinematic lighting, dramatic but natural atmosphere, high-end action portrait look. Avoid heavy sci-fi effects or face reconstruction.`,

    `Transform this person into a grounded modern hero portrait. ${identityRule} Preserve identity strongly. Use premium realistic photography, subtle heroic styling, elegant dark outfit, natural shadows, cinematic background depth, sharp professional detail, and believable realism. Do not make the person look younger or like a different actor.`
]

        const fantasyPrompts = [
    `Transform this person into a realistic luxury fantasy-inspired portrait. ${identityRule} Preserve exact real face, age, wrinkles, skin texture, baldness or hairstyle, beard if present, and expression. Use elegant royal clothing, warm cinematic lighting, believable castle or luxury interior background, premium realistic photography. Avoid glowing magic, purple effects, or changing the face.`,

    `Create a grounded cinematic royal portrait of this person. ${identityRule} Keep the same real identity and natural aging. Add elegant formal clothing, rich warm lighting, realistic luxury background, premium portrait detail, and believable fantasy-inspired atmosphere. Do not make the person younger or actor-like.`,

    `Transform this person into a realistic noble portrait. ${identityRule} Preserve facial identity strongly. Use classic luxury styling, elegant background, natural skin texture, warm light, realistic shadows, and high-end editorial photography. No magic glow, no fantasy skin, no face reconstruction.`
]

        const cyberpunkPrompts = [
    `Transform this person into a realistic futuristic city portrait. ${identityRule} Preserve exact face identity, age, wrinkles, skin texture, baldness or hairstyle, beard if present, and expression. Use modern futuristic clothing, realistic night city background, subtle blue ambient light, professional cinematic photography. No strong purple neon, no glowing face, no cybernetic face changes.`,

    `Create a believable modern tech-style AI portrait. ${identityRule} Keep the same real person and natural facial details. Use sleek dark clothing, realistic urban background, soft city lights, premium camera depth of field, natural skin texture, and realistic color grading. Avoid fantasy cyberpunk glow or actor replacement.`,

    `Transform this person into a premium futuristic professional portrait. ${identityRule} Preserve age, face shape, skin texture, hairline or baldness, beard if present, and expression. Use elegant futuristic outfit, realistic background blur, subtle cinematic lighting, and high-end realistic photography.`
]

        const animePrompts = [
    `Transform this person into a premium cinematic anime character. ${identityRule} Preserve the exact same real identity, age, wrinkles, baldness or hairstyle, beard if present, face shape, eyes, nose, lips, and expression while converting them into a polished anime version. Use high-end modern anime movie rendering, expressive anime eyes, cinematic anime lighting, elegant animated textures, detailed hair rendering, and premium blockbuster anime quality. Avoid turning the person into a completely different anime character.`,

    `Create a realistic luxury anime portrait of this person. ${identityRule} Keep the same recognizable face identity, same age, same facial proportions, same hairstyle or baldness, same beard if present, and same natural expression. Use premium anime illustration quality, cinematic anime atmosphere, elegant color grading, polished anime shading, detailed animated lighting, and believable anime realism.`,

    `Transform this person into a high-end anime hero portrait. ${identityRule} Preserve facial identity strongly while anime-stylizing the character. Keep the same face shape, age, wrinkles, hairstyle or baldness, beard if present, skin tone, and expression. Use modern anime movie-quality rendering, expressive detailed anime eyes, cinematic lighting, elegant anime background atmosphere, and premium animated realism.`,

    `Create a premium anime movie-style portrait of this person. ${identityRule} Maintain the exact same recognizable identity and natural facial structure while applying anime stylization. Use clean anime shading, cinematic anime lighting, polished illustration textures, elegant animated atmosphere, and realistic anime proportions. Avoid extreme fantasy transformations or replacing the person's identity.`,

    `Transform this person into a believable cinematic anime character. ${identityRule} Preserve age, wrinkles, baldness or hairstyle, beard if present, face shape, jawline, eyes, nose, lips, and expression while creating a premium anime adaptation. Use modern anime film rendering, soft cinematic lighting, elegant animated depth, detailed anime textures, and blockbuster anime realism.`,

    `Create a realistic premium anime avatar of this person. ${identityRule} Keep the same real identity and recognizable facial structure. Use polished anime artwork, cinematic anime lighting, expressive animated facial detail, elegant anime background, and premium movie-quality anime rendering. Avoid making the person look like a generic anime character.`
]

        const professionalPrompts = [
    `Transform this person into a realistic premium executive portrait. ${identityRule} Preserve the exact same real identity, age, wrinkles, skin texture, baldness or hairstyle, beard if present, facial proportions, expression, and natural imperfections. Use elegant business clothing, realistic studio lighting, premium office background blur, natural skin tones, and high-end LinkedIn-quality photography. Avoid heavy beautification, face smoothing, or actor-like reconstruction.`,

    `Create a luxury CEO-style portrait of this person. ${identityRule} Keep the same real face, same age, same wrinkles, same baldness or hairstyle, same beard if present, and same natural expression. Use refined formal clothing, realistic executive office atmosphere, warm professional lighting, premium camera depth of field, and believable business photography realism. No purple lighting, no fantasy effects, no artificial skin.`,

    `Transform this person into a premium modern entrepreneur portrait. ${identityRule} Preserve facial identity strongly, including skin texture, age, wrinkles, facial structure, hairline or baldness, beard if present, and natural expression. Use elegant smart-casual business styling, realistic lighting, clean luxury background, and social-media premium photography quality. Keep the portrait believable and natural.`,

    `Create a realistic professional headshot of this person. ${identityRule} Maintain the same real identity and natural aging. Use premium studio photography, soft natural lighting, realistic shadows, elegant outfit styling, clean background blur, sharp eyes, and realistic skin detail. Avoid unrealistic beauty enhancement or face reconstruction.`,

    `Transform this person into a realistic luxury personal-brand portrait. ${identityRule} Preserve the exact same face identity, age, skin texture, baldness or hairstyle, beard if present, and expression. Use stylish formal clothing, premium natural color grading, realistic portrait lighting, and believable high-end editorial photography. No cyberpunk, no superhero styling, no glowing effects.`,

    `Create a believable premium business portrait of this person. ${identityRule} Keep the same real face, same natural wrinkles, same skin detail, same facial structure, and same expression. Upgrade only the outfit, lighting, and background into a realistic high-end professional portrait. Use elegant photography, natural cinematic lighting, and premium executive atmosphere.`
]

        const headshotPrompts = [
    `Transform this person into a realistic premium studio headshot. ${identityRule} Preserve the exact same real identity, age, wrinkles, skin texture, baldness or hairstyle, beard if present, face shape, eyes, nose, lips, and natural expression. Use clean professional studio lighting, realistic skin detail, elegant neutral background blur, premium camera quality, and believable LinkedIn-style photography. Avoid heavy beautification or unrealistic face reconstruction.`,

    `Create a luxury executive headshot of this person. ${identityRule} Keep the same real face, same natural aging, same wrinkles, same skin texture, same baldness or hairstyle, same beard if present, and same expression. Use elegant formal clothing, realistic office or studio background blur, soft cinematic lighting, premium professional photography, and natural color grading.`,

    `Transform this person into a realistic high-end business profile portrait. ${identityRule} Preserve facial identity strongly, including natural skin texture, facial proportions, age, wrinkles, hairline or baldness, beard if present, and expression. Use refined professional styling, clean studio lighting, sharp portrait detail, and believable premium corporate photography.`,

    `Create a realistic premium close-up portrait of this person. ${identityRule} Keep the same face identity and natural imperfections. Use elegant portrait lighting, realistic shadows, clean background blur, premium lens depth of field, sharp eyes, and realistic skin detail. Avoid excessive skin smoothing, glamor effects, or artificial beauty enhancement.`,

    `Transform this person into a polished luxury personal-brand headshot. ${identityRule} Preserve the same real person, including age, wrinkles, skin texture, facial structure, baldness or hairstyle, beard if present, and expression. Use premium studio lighting, elegant wardrobe styling, realistic background blur, and high-end editorial photography realism.`,

    `Create a believable premium social-media headshot portrait. ${identityRule} Maintain exact facial identity and realistic natural aging. Use realistic cinematic photography, elegant soft lighting, natural skin tones, clean luxury background, and professional portrait quality. No cyberpunk, no fantasy effects, no purple neon lighting, and no actor-like face replacement.`
]

        const aiAvatarPrompts = [
    `Transform this person into a realistic premium AI avatar portrait. ${identityRule} Preserve the exact same real identity, age, wrinkles, baldness or hairstyle, beard if present, face shape, eyes, nose, lips, skin texture, expression, and natural imperfections. Upgrade the outfit into elegant modern luxury clothing. Use realistic cinematic photography, natural skin texture, premium golden-hour lighting, soft background blur, luxury lifestyle atmosphere, high-end portrait quality. Do not use purple lighting, neon lighting, cyberpunk effects, glowing particles, fantasy colors, or superhero styling.`,

    `Create a high-end realistic AI portrait of this person. ${identityRule} Keep the same face, same age, same wrinkles, same baldness or hairstyle, same facial proportions, same expression, and same skin realism. Give the person a refined luxury portrait look with elegant clothing, natural warm lighting, realistic background, premium camera depth of field, and believable professional photography. No purple, no neon, no sci-fi armor, no cyberpunk, no fantasy effects.`,

    `Transform this person into a realistic luxury social-media AI avatar. ${identityRule} Preserve real identity strongly, including age, wrinkles, face shape, baldness or hairstyle, facial hair, skin tone, and expression. Use premium realistic portrait lighting, stylish modern outfit, elegant background, natural color grading, sharp professional detail, and believable cinematic realism. Avoid artificial purple colors, neon glow, holograms, cyberpunk effects, superhero armor, or dramatic face reconstruction.`,

    `Create a realistic premium lifestyle avatar portrait. ${identityRule} Keep the person recognizable as the exact same real person. Preserve facial structure, age, wrinkles, skin texture, baldness or hairline, beard if present, clothing identity where possible, and natural expression. Upgrade only the background, lighting, and outfit in a realistic luxury way. Use warm natural light, realistic shadows, premium photography, and clean social-media portrait quality.`,

    `Transform this person into a luxury realistic AI head-and-shoulders portrait. ${identityRule} Preserve the same real face, same age, same natural skin texture, same baldness or hairstyle, same eyes, nose, lips, cheeks, jawline, and expression. Use elegant clothing, realistic studio lighting, soft neutral background, premium camera quality, and natural color grading. Do not create a different actor-like person. Do not use purple, neon, cyberpunk, fantasy, or superhero elements.`,

    `Create a believable premium AI portrait upgrade of this person. ${identityRule} Maintain exact identity and natural aging. Keep wrinkles, skin details, baldness or hairstyle, beard if present, face shape, and expression. Use realistic luxury portrait photography, elegant outfit styling, warm cinematic lighting, high-end background, and natural professional color grading. The output should look like a real premium photo, not a sci-fi character.`
]

        const cartoonPrompts = [
    `Transform this person into a premium 3D animated movie character. ${identityRule} Preserve the exact same real identity, age, wrinkles, baldness or hairstyle, beard if present, facial structure, expression, and recognizable face proportions while converting them into a polished animated character. Use clean Pixar-style 3D rendering, cinematic animated lighting, expressive animated eyes, smooth stylized textures, premium movie-quality cartoon shading, and realistic character depth. Avoid turning the person into a completely different cartoon character.`,

    `Create a luxury modern cartoon avatar of this person. ${identityRule} Keep the same recognizable face identity, age, skin tone, hairstyle or baldness, beard if present, expression, and facial proportions. Use high-end animated rendering, elegant colorful lighting, premium social-media cartoon styling, smooth animated textures, and cinematic 3D cartoon realism. The result should look like a believable animated version of the same person.`,

    `Transform this person into a realistic animated film character. ${identityRule} Preserve identity strongly while stylizing into premium animation. Keep the same facial proportions, natural expression, age, wrinkles, hairline or baldness, beard if present, and recognizable features. Use cinematic cartoon lighting, polished 3D animated shading, expressive eyes, elegant background atmosphere, and blockbuster animated movie quality.`,

    `Create a polished premium cartoon portrait of this person. ${identityRule} Preserve the same real person and recognizable identity. Use soft stylized animated skin, elegant cartoon lighting, smooth rendering, expressive animated facial detail, realistic depth, and modern social-media premium cartoon quality. Avoid excessive caricature distortion or unrealistic face changes.`,

    `Transform this person into a high-end animated studio portrait. ${identityRule} Keep the same recognizable face, same age, same hairstyle or baldness, same beard if present, and same expression while applying premium cartoon stylization. Use clean animated rendering, luxury color grading, cinematic cartoon atmosphere, and polished 3D character realism.`,

    `Create a believable premium animated avatar of this person. ${identityRule} Preserve the exact same identity and natural facial structure while converting into a stylized animated character. Use elegant animated textures, cinematic lighting, expressive cartoon detail, premium 3D rendering, and modern blockbuster animation quality. Avoid making the character look like a completely different person.`
]

        const moodText =
    mood === "Serious"
        ? "Use a serious confident expression, realistic natural shadows, mature premium portrait mood."
        : mood === "Luxury"
            ? "Use luxury realistic styling, elegant clothing, warm premium lighting, high-end portrait atmosphere."
            : "Use realistic cinematic lighting, natural color grading, premium portrait quality."

        const strengthText =
            styleName === "Cartoon"

                ? "CARTOON MODE: The final image must be clearly non-photorealistic and animated. Use a premium 3D cartoon or animated movie character style with stylized skin, expressive animated eyes, clean cartoon shading, simplified facial planes, illustration textures, and a high-end animated film appearance. Do not output a realistic human photo. Do not keep realistic photographic skin texture. Preserve the person's real identity, gender, age, baldness or hairstyle, beard if present, clothes, face structure, and expression while converting them into a clearly animated character."

                : styleName === "Anime"

                    ? "ANIME MODE: Create a clearly anime-styled character with cinematic anime rendering, illustrated textures, anime facial styling, stylized lighting, and premium anime artwork quality. Preserve the same real identity, age, baldness or hairstyle, beard if present, clothes, face proportions, expression, and gender. Do not turn the person into a completely different anime character. Keep the same recognizable person while anime-stylizing them."

                    : strength === "Accurate"

    ? "PHOTO-REALISTIC ACCURATE FACE MODE: Preserve the uploaded person's real identity almost unchanged. This is not a makeover. This is not a fantasy portrait. Keep the same real face, same age, same wrinkles, same forehead lines, same skin texture, same eye bags, same nose, same lips, same cheeks, same jawline, same baldness or hairline, same beard if present, same clothing, same expression, and same natural imperfections. Do not make the person younger. Do not beautify. Do not smooth skin. Do not sharpen jawline. Do not slim face. Do not restore hair. Do not add dramatic purple neon lighting. Do not heavily recolor the face. Use natural realistic lighting and only very subtle cinematic enhancement. The final image must look like the same original person, not a different AI actor."

                        : strength === "Extreme"

                            ? "Create a bold and dramatic transformation, but the person must still be clearly recognizable. Preserve the same face identity, facial structure, eyes, nose, mouth, gender, age, hairstyle or baldness, beard if present, clothes, and skin tone while applying stronger cinematic styling."

                            : "BALANCED MODE: Create a premium cinematic AI transformation while keeping the person clearly recognizable. Preserve the same real identity, face shape, age, wrinkles, hairstyle or baldness, beard if present, eyes, nose, lips, jawline, skin tone, clothing, and expression. Allow noticeable AI styling, cinematic atmosphere, improved lighting, stylish outfit enhancement, and premium visual polish, but avoid replacing the person with a different actor-like face. Avoid excessive face reconstruction, extreme beautification, unrealistic symmetry, or over-processed skin. Keep the result stylish, realistic, and social-media premium."

        let genderRule = ""

        if (genderMode === "Female") {

            genderRule =
                "The input person is female. Keep her female. Preserve feminine facial features, hairstyle, body shape, age, and natural expression. Do not masculinize the person. Do not add masculine jawline, beard, mustache, or male appearance."

        } else if (genderMode === "Male") {

            genderRule =
                "The input person is male. Keep him male. Preserve masculine facial features, beard if present, hairstyle, body shape, age, and expression."

        } else {

            genderRule =
                "Preserve the person's original gender presentation exactly as shown in the input image."
        }

        let prompt = ""

        switch (styleName) {

            case "AI Avatar":

                if (variation === "Variation 1") {
                    prompt = `${genderRule}\n\n${aiAvatarPrompts[0]}`
                }
                else if (variation === "Variation 2") {
                    prompt = `${genderRule}\n\n${aiAvatarPrompts[1]}`
                }
                else if (variation === "Variation 3") {
                    prompt = `${genderRule}\n\n${aiAvatarPrompts[2]}`
                }
                else {
                    prompt = `${genderRule}\n\n${pickRandom(aiAvatarPrompts)}`
                }

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

                if (variation === "Variation 1") {
                    prompt = `${genderRule}\n\n${headshotPrompts[0]}`
                }
                else if (variation === "Variation 2") {
                    prompt = `${genderRule}\n\n${headshotPrompts[1]}`
                }
                else if (variation === "Variation 3") {
                    prompt = `${genderRule}\n\n${headshotPrompts[2]}`
                }
                else {
                    prompt = `${genderRule}\n\n${pickRandom(headshotPrompts)}`
                }

                break

            default:
                prompt =
                    `${genderRule}

Transform this person into a high-quality premium AI portrait. ${identityRule}`
        }

let styleIntensityRule = ""

if (strength === "Accurate") {

    styleIntensityRule =
        "ACCURATE MODE: Preserve the uploaded person's real identity extremely closely. Keep the same age, wrinkles, forehead lines, eye bags, skin texture, pores, face shape, jawline, cheeks, nose, lips, eyes, eyebrows, ears, baldness or hairstyle, beard if present, clothing, expression, and natural imperfections. Do not make the person younger. Do not beautify heavily. Do not smooth skin excessively. Do not slim the face. Do not sharpen the jawline. Do not restore hair. Use realistic natural lighting, realistic skin tones, and subtle premium enhancement only. The final image must still clearly look like the same real person."

} else if (strength === "Extreme") {

    styleIntensityRule =
        "EXTREME MODE: Apply a strong premium cinematic AI transformation while keeping the person recognizable. Allow stronger styling, dramatic atmosphere, outfit upgrades, cinematic lighting, and visual enhancement, but preserve the same real identity, age, facial structure, baldness or hairstyle, beard if present, skin tone, and expression."

} else {

    styleIntensityRule =
        "BALANCED MODE: Apply realistic premium AI portrait styling while keeping the person clearly recognizable. Preserve the same face identity, age, wrinkles, skin texture, baldness or hairstyle, beard if present, facial proportions, and expression. Allow stylish cinematic enhancement, elegant outfit upgrades, premium portrait lighting, and realistic atmosphere while avoiding fake actor replacement, excessive beauty enhancement, unrealistic skin smoothing, purple neon glow, or heavy face reconstruction."
}

prompt = `
${prompt}

${moodText}

${strengthText}

${styleIntensityRule}
`

if (strength === "Accurate") {

    prompt += `

IMPORTANT ACCURATE FACE RULES:

Keep the exact same real person.
Strongly preserve facial identity.
Preserve age, wrinkles, skin texture, baldness or hairstyle, beard if present, face shape, jawline, nose, eyes, lips, and expression.

Allow realistic outfit styling, premium portrait enhancement, cinematic atmosphere, and environment upgrades,
BUT keep the face highly recognizable.

Do not replace the person with a different attractive actor-like face.
Do not heavily reconstruct the face.
Do not dramatically change facial proportions.
Avoid excessive beauty enhancement.
Avoid unrealistic skin smoothing.
Use natural realistic skin texture and realistic lighting.
`
}

        console.log("Prompt:", prompt)

        const cleanedBase64 = imageBase64.replace(
            /^data:image\/\w+;base64,/,
            ""
        )

        const imageBuffer = Buffer.from(cleanedBase64, "base64")

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

        let selectedModel = "black-forest-labs/flux-kontext-pro"

        if (styleName === "Anime") {
            selectedModel = "black-forest-labs/flux-kontext-pro"
        } else if (styleName === "Professional" || styleName === "Headshot") {
            selectedModel = "black-forest-labs/flux-kontext-pro"
        } else if (styleName === "Cartoon") {
            selectedModel = "black-forest-labs/flux-kontext-pro"
        }

        console.log("Selected Model:", selectedModel)

        const startResponse = await axios.post(
            `https://api.replicate.com/v1/models/${selectedModel}/predictions`,
            {
                input: {
    prompt: prompt,
    input_image: uploadedImageUrl,
    aspect_ratio: "1:1",
    output_format: "jpg",
    safety_tolerance: 2,

    guidance_scale:
    strength === "Accurate" ? 2.0 :
    strength === "Balanced" ? 2.8 :
    3.6,

num_inference_steps:
    strength === "Accurate" ? 26 :
    strength === "Balanced" ? 32 :
    38,

prompt_strength:
    strength === "Accurate" ? 0.32 :
    strength === "Balanced" ? 0.52 :
    0.72
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

        const upscaleResponse = await axios.post(
            "https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions",
            {
                input: {
    image: outputUrl,
    scale: 2,
    face_enhance: strength === "Extreme" ? true : false
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
