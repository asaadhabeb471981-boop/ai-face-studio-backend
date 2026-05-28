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
            `Transform this person into a cinematic dark superhero from a premium blockbuster movie. ${identityRule} Ultra detailed tactical armor, dramatic stormy sky, glowing purple-blue energy, intense heroic lighting, natural identity-preserving facial detail, atmospheric smoke, epic movie-poster composition, powerful serious expression, premium VFX quality.`,

            `Transform this person into a futuristic armored superhero commander. ${identityRule} Sleek high-tech battle suit, glowing chest reactor, neon reflections, cinematic sci-fi city skyline, dramatic rim lighting, natural identity-preserving facial detail, premium blockbuster superhero atmosphere, sharp focus, expensive movie poster quality.`,

            `Transform this person into a cosmic superhero legend. ${identityRule} Elegant heroic costume, galaxy energy aura, glowing particles, starfield background, powerful cinematic pose, luxury fantasy-sci-fi lighting, natural identity-preserving facial detail, epic universe-saving atmosphere, ultra premium cinematic realism.`,

            `Transform this person into a tactical night vigilante. ${identityRule} Black luxury armor, rainy city rooftop, dramatic shadows, moody noir lighting, realistic intense expression, cinematic dark hero atmosphere, premium superhero film style, natural identity-preserving facial detail, high-end action poster look.`,

            `Transform this person into a lightning-powered superhero. ${identityRule} Electric energy surrounding the body, storm clouds, glowing blue-purple highlights, cinematic action lighting, realistic facial identity, dramatic superhero pose, ultra detailed armor textures, premium blockbuster realism.`,

            `Transform this person into a mystical superhero guardian. ${identityRule} Elegant magical armor, ancient glowing symbols, purple energy portals, dark fantasy city background, cinematic heroic lighting, realistic face preservation, premium fantasy-superhero movie poster quality.`
        ]

        const fantasyPrompts = [
            `Transform this person into a legendary fantasy king or queen from an epic cinematic universe. ${identityRule} Royal enchanted armor, glowing golden crown, majestic throne room, dramatic firelight, ultra realistic fantasy detail, premium medieval atmosphere, cinematic movie-poster lighting, elegant magical realism.`,

            `Transform this person into a powerful fire mage warrior. ${identityRule} Burning magical energy, glowing runes, volcanic fantasy world, dramatic cinematic lighting, ultra detailed fantasy robes, natural realistic skin detail, premium dark fantasy movie atmosphere.`,

            `Transform this person into an ancient dragon guardian. ${identityRule} Elegant dragon-scale armor, glowing mystical aura, fantasy mountains, cinematic cloudy sky, realistic heroic face detail, epic magical atmosphere, premium blockbuster fantasy realism.`,

            `Transform this person into a dark fantasy assassin. ${identityRule} Hooded luxury leather armor, smoke effects, moonlit medieval city, mysterious cinematic shadows, realistic intense expression, premium fantasy action movie style.`,

            `Transform this person into an enchanted elf warrior. ${identityRule} Elegant fantasy clothing, magical forest, glowing particles, cinematic green-blue lighting, realistic fantasy styling, premium magical realism, blockbuster fantasy adventure atmosphere.`,

            `Transform this person into a legendary knight commander. ${identityRule} Detailed silver armor, battlefield atmosphere, royal banners, dramatic cinematic lighting, ultra realistic medieval textures, epic fantasy movie-poster quality.`
        ]

        const cyberpunkPrompts = [
            `Transform this person into a premium cyberpunk hacker from a futuristic blockbuster universe. ${identityRule} Purple-blue neon lighting, holographic interfaces, luxury futuristic streetwear, cinematic rainy megacity atmosphere, natural identity-preserving facial detail, glowing reflections, expensive sci-fi movie quality.`,

            `Transform this person into a futuristic cybernetic mercenary. ${identityRule} Advanced robotic enhancements, glowing circuitry, metallic textures, cinematic neon reflections, ultra detailed armor, natural realistic skin detail, premium sci-fi realism, dark futuristic atmosphere.`,

            `Transform this person into a luxury cyberpunk street rebel. ${identityRule} Neon fashion jacket, holographic city alley, dramatic cinematic lighting, futuristic graffiti environment, realistic face preservation, premium social-media viral cyberpunk style.`,

            `Transform this person into a cyber ninja assassin. ${identityRule} Black futuristic armor, glowing energy katana, rooftop neon skyline, smoke atmosphere, cinematic action composition, natural identity-preserving facial detail, premium cyberpunk blockbuster realism.`,

            `Transform this person into a blade-runner style detective. ${identityRule} Long futuristic trench coat, rainy neon streets, moody noir lighting, cinematic sci-fi atmosphere, realistic facial identity, premium futuristic movie-poster realism.`,

            `Transform this person into a futuristic cyber soldier commander. ${identityRule} Tactical sci-fi armor, glowing visor, battlefield neon environment, cinematic dramatic lighting, natural realistic skin detail, blockbuster sci-fi action movie atmosphere.`
        ]

        const animePrompts = [
            `Transform this person into a premium cinematic anime hero. ${identityRule} Identity-preserving premium anime movie quality, expressive detailed eyes, dramatic anime lighting, vibrant cinematic colors, modern blockbuster anime atmosphere, elegant hair detail, premium fantasy-anime styling.`,

            `Transform this person into a futuristic anime warrior. ${identityRule} High-tech anime armor, glowing neon effects, cinematic sci-fi anime city, dramatic action atmosphere, ultra detailed anime illustration quality, premium anime movie style.`,

            `Transform this person into an elite anime samurai. ${identityRule} Elegant samurai armor, cherry blossom atmosphere, cinematic anime sunset, premium anime film lighting, ultra polished anime styling, legendary warrior mood.`,

            `Transform this person into a dark anime assassin. ${identityRule} Hooded anime ninja outfit, moonlit rooftop, cinematic anime shadows, glowing energy effects, dramatic action composition, premium anime blockbuster atmosphere.`,

            `Transform this person into a magical anime guardian. ${identityRule} Fantasy anime robes, glowing magical particles, enchanted anime world, elegant cinematic lighting, ultra detailed anime masterpiece quality.`,

            `Transform this person into an anime legend character. ${identityRule} Heroic anime pose, identity-preserving anime facial detail, cinematic anime background, polished modern anime film quality, premium emotional anime atmosphere.`
        ]

        const professionalPrompts = [
            `Transform this person into a world-class luxury CEO portrait. ${identityRule} Tailored designer suit, elegant executive office, cinematic studio lighting, natural realistic skin detail, premium business magazine photography, confident expression, expensive luxury atmosphere, sharp focus, high-end professional realism.`,

            `Transform this person into a successful tech entrepreneur portrait. ${identityRule} Smart luxury fashion, modern futuristic office, cinematic business lighting, realistic facial detail, premium startup founder aesthetic, elegant color grading, social-media viral quality professional portrait.`,

            `Transform this person into a premium cinematic studio portrait. ${identityRule} Premium studio lighting, cinematic background blur, elegant luxury styling, natural realistic skin texture, blockbuster headshot photography, dramatic soft lighting, high-end portrait realism.`,

            `Transform this person into a high-fashion magazine cover portrait. ${identityRule} Editorial lighting, luxury fashion styling, cinematic photography composition, premium editorial portrait realism, premium facial detail, elegant modern atmosphere, expensive luxury aesthetic.`,

            `Transform this person into a luxury executive portrait. ${identityRule} Elegant dark business suit, modern boardroom environment, premium cinematic lighting, realistic confident expression, premium executive portrait quality, ultra polished corporate realism.`,

            `Transform this person into a premium personal brand portrait. ${identityRule} Soft cinematic studio lighting, elegant professional aesthetic, modern luxury fashion, natural realistic skin texture, premium social media photography, polished professional realism.`
        ]

        const headshotPrompts = [
            `Transform this person into an ultra realistic premium studio headshot. ${identityRule} Clean professional lighting, sharp facial detail, natural skin texture, elegant neutral background, premium LinkedIn-quality portrait photography.`,

            `Transform this person into a luxury executive headshot. ${identityRule} Tailored professional outfit, modern office background blur, cinematic studio lighting, confident natural expression, natural identity-preserving facial detail.`,

            `Transform this person into a premium close-up studio headshot. ${identityRule} Soft cinematic lighting, elegant background blur, realistic skin detail, sharp eyes, premium portrait photography.`,

            `Transform this person into a high-end corporate profile photo. ${identityRule} Clean business outfit, professional studio background, soft realistic lighting, natural expression, polished premium photography.`,

            `Transform this person into a luxury personal branding headshot. ${identityRule} Elegant modern styling, soft cinematic studio lighting, realistic facial detail, premium social media profile portrait.`,

            `Transform this person into a natural realistic passport-style studio portrait but premium. ${identityRule} Clean background, balanced lighting, accurate face identity, realistic skin texture, sharp professional photo quality.`
        ]

        const aiAvatarPrompts = [
            `Transform this person into an ultra premium futuristic AI avatar. ${identityRule} Natural identity-preserving facial detail, luxury sci-fi aesthetic, glowing holographic particles, cinematic purple-blue neon lighting, elegant futuristic fashion, premium movie-poster atmosphere, natural realistic skin detail, sharp focus, blockbuster visual effects.`,

            `Transform this person into a futuristic cybernetic luxury avatar. ${identityRule} Glowing AI circuitry, sleek futuristic outfit, cinematic sci-fi environment, realistic facial identity, elegant holographic lighting, premium futuristic realism, expensive movie-quality visuals.`,

            `Transform this person into a cinematic AI-powered hero portrait. ${identityRule} Dramatic purple energy glow, futuristic armor accents, natural realistic skin texture, volumetric cinematic lighting, elegant sci-fi atmosphere, premium blockbuster portrait quality.`,

            `Transform this person into a luxury neon futuristic portrait. ${identityRule} Purple and blue neon reflections, dark futuristic city atmosphere, premium social-media viral quality, realistic face preservation, elegant cyber-fashion styling.`,

            `Transform this person into a futuristic metaverse portrait. ${identityRule} Natural realistic skin detail, luxury futuristic fashion, holographic environment, cinematic studio lighting, premium identity-preserving avatar realism.`,

            `Transform this person into a premium AI cinematic character. ${identityRule} Elegant futuristic atmosphere, glowing particles, luxury sci-fi textures, realistic face identity, blockbuster cinematic realism, ultra premium visual quality.`
        ]

        const cartoonPrompts = [
            `Transform this person into a premium animated movie character. ${identityRule} Ultra polished Pixar-style 3D animation, cinematic animated lighting, expressive eyes, colorful premium atmosphere, stylized animated shading, premium animated character styling, blockbuster animated movie quality.`,

            `Transform this person into a modern cartoon superhero. ${identityRule} Bold animated outlines, vibrant cinematic colors, dramatic cartoon action atmosphere, polished comic-animation styling, premium animated movie lighting.`,

            `Transform this person into a luxury 3D cartoon avatar. ${identityRule} Smooth cinematic shading, premium animated textures, cheerful colorful background, ultra detailed animated design, premium animated character styling, social-media viral quality.`,

            `Transform this person into a retro animated character. ${identityRule} Vintage cartoon atmosphere, warm cinematic colors, polished animated textures, playful premium animation style, elegant nostalgic cartoon styling.`,

            `Transform this person into a modern social media cartoon avatar. ${identityRule} Stylish colorful background, premium animated influencer aesthetic, cinematic cartoon lighting, polished facial detail, high-end animated styling.`,

            `Transform this person into a cinematic caricature portrait. ${identityRule} Slightly stylized facial features while preserving identity, premium animated lighting, premium animated character styling, blockbuster animated illustration quality.`
        ]

        const moodText =
            mood === "Serious"
                ? "Use a serious intense expression, darker lighting, dramatic mood."
                : mood === "Luxury"
                    ? "Use luxury premium styling, elegant lighting, expensive fashion look."
                    : "Use cinematic lighting, balanced dramatic style, premium movie-poster quality."

        const strengthText =
            styleName === "Cartoon"

                ? "CARTOON MODE: The final image must be clearly non-photorealistic and animated. Use a premium 3D cartoon or animated movie character style with stylized skin, expressive animated eyes, clean cartoon shading, simplified facial planes, illustration textures, and a high-end animated film appearance. Do not output a realistic human photo. Do not keep realistic photographic skin texture. Preserve the person's real identity, gender, age, baldness or hairstyle, beard if present, clothes, face structure, and expression while converting them into a clearly animated character."

                : styleName === "Anime"

                    ? "ANIME MODE: Create a clearly anime-styled character with cinematic anime rendering, illustrated textures, anime facial styling, stylized lighting, and premium anime artwork quality. Preserve the same real identity, age, baldness or hairstyle, beard if present, clothes, face proportions, expression, and gender. Do not turn the person into a completely different anime character. Keep the same recognizable person while anime-stylizing them."

                    : strength === "Accurate"

                        ? "ACCURATE MODE: Identity preservation is the absolute highest priority. Keep the transformation subtle and realistic. Preserve the exact same person, same age, same wrinkles, same forehead, same face shape, same facial proportions, same eyes, same nose, same mouth, same skin tone, same hairstyle or baldness, same beard or facial hair if present, same gender, same clothes, and same natural expression. Preserve natural aging realistically. Preserve baldness exactly if the person is bald. Do not generate new hair or restore hairline. Do not make the person younger. Do not beautify heavily. Do not slim the face. Do not sharpen jawline. Do not smooth skin excessively. Do not remove wrinkles. Do not replace the person with a more attractive actor-like version. Only apply the selected style, atmosphere, outfit, lighting, and environment while keeping the real identity clearly intact."

                        : strength === "Extreme"

                            ? "Create a bold and dramatic transformation, but the person must still be clearly recognizable. Preserve the same face identity, facial structure, eyes, nose, mouth, gender, age, hairstyle or baldness, beard if present, clothes, and skin tone while applying stronger cinematic styling."

                            : "Use a balanced transformation. Preserve the person's real identity clearly while applying premium cinematic styling. Keep the same face structure, gender, age, hairstyle or baldness, beard if present, clothes, eyes, nose, mouth, and skin tone."

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
        "Keep styling subtle and realistic. Minimize facial reconstruction. Do not heavily modify hairstyle, hairline, beard, wrinkles, skin texture, or facial proportions. Preserve the original person's real appearance as much as possible while lightly applying the selected style."

} else if (strength === "Extreme") {

    styleIntensityRule =
        "Apply a strong dramatic cinematic transformation while keeping the person recognizable."

} else {

    styleIntensityRule =
        "Apply balanced premium cinematic styling while preserving identity."
}

        prompt = `${prompt} ${moodText} ${strengthText} ${styleIntensityRule}`

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
