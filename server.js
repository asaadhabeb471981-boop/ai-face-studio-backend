require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");

function optionalRequire(name, fallback) {
  try {
    return require(name);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      console.warn(
        `Optional dependency "${name}" is not installed. Using fallback middleware.`
      );
      return fallback;
    }
    throw error;
  }
}

const helmet = optionalRequire("helmet", () => (_req, _res, next) => next());
const compression = optionalRequire(
  "compression",
  () => (_req, _res, next) => next()
);
const rateLimit = optionalRequire("express-rate-limit", () => {
  return (_req, _res, next) => next();
});

const app = express();

const PORT = Number(process.env.PORT || 3000);
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const REPLICATE_MODEL =
  process.env.REPLICATE_MODEL || "black-forest-labs/flux-kontext-pro";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const POLL_INTERVAL_MS = Number(process.env.REPLICATE_POLL_INTERVAL_MS || 1800);
const PREDICTION_TIMEOUT_MS = Number(
  process.env.REPLICATE_PREDICTION_TIMEOUT_MS || 120000
);
const BODY_LIMIT = process.env.BODY_LIMIT || "35mb";

const STYLE_NAMES = new Set([
  "AI Avatar",
  "Cartoon",
  "Headshot",
  "Fantasy",
  "Anime",
  "Cyberpunk",
  "Superhero",
  "Professional",
  "Age Studio",
]);

const STYLE_BASELINES = {
  "AI Avatar":
    "premium AI avatar transformation of the exact uploaded subject or subjects, semi-realistic digital avatar finish, refined cinematic lighting, smooth realistic materials, polished profile quality, not cartoon and not cel-shaded",
  Cartoon:
    "fully redrawn cartoon illustration of the exact uploaded subject or subjects, cel-shaded animated style, simplified shapes, clean bold outlines, flat bright colors, smooth stylized materials, non-photorealistic rendering, not a camera photo",
  Headshot:
    "clean professional close-up studio presentation of the exact uploaded subject or subjects",
  Fantasy:
    "cinematic fantasy transformation of the exact uploaded subject or subjects",
  Anime:
    "high-end anime-style transformation of the exact uploaded subject or subjects",
  Cyberpunk:
    "futuristic cyberpunk transformation of the exact uploaded subject or subjects",
  Superhero:
    "cinematic superhero-inspired transformation of the exact uploaded subject or subjects",
  Professional:
    "premium professional commercial presentation of the exact uploaded subject or subjects",
  "Age Studio":
    "age-aware transformation of the exact uploaded subject or subjects, using human age editing only when the uploaded subject is human",
};

const AGE_TARGETS = {
  "Younger Adult":
    "make each visible human look like a younger adult, with realistic adult facial maturity and natural polished skin texture",
  "30s":
    "make each visible human look like they are in their 30s, with natural adult maturity and realistic skin texture",
  "40s":
    "make each visible human look like they are in their 40s, with realistic mature adult facial detail",
  "50s":
    "make each visible human look like they are in their 50s, with natural age texture and premium portrait realism",
  "60s":
    "make each visible human look like they are in their 60s, with realistic senior-adult detail, mature skin texture, and natural dignity",
  "Senior Adult":
    "make each visible human look like a senior adult, with believable mature aging details and premium portrait realism",
};

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: BODY_LIMIT }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 30),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

function requestId() {
  return crypto.randomUUID();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeStyle(styleName) {
  const value = normalizeString(styleName, "AI Avatar");
  return STYLE_NAMES.has(value) ? value : "AI Avatar";
}

function parseDataUriOrBase64(imageBase64) {
  const raw = normalizeString(imageBase64);
  if (!raw) {
    throw Object.assign(new Error("imageBase64 is required"), {
      statusCode: 400,
      code: "IMAGE_MISSING",
    });
  }

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const contentType = match ? match[1] : "image/jpeg";
  const base64 = match ? match[2] : raw;

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw Object.assign(new Error("imageBase64 is not valid base64"), {
      statusCode: 400,
      code: "IMAGE_INVALID",
    });
  }

  if (!buffer.length) {
    throw Object.assign(new Error("imageBase64 is empty"), {
      statusCode: 400,
      code: "IMAGE_EMPTY",
    });
  }

  return { buffer, contentType };
}

function fileExtensionForContentType(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

function replicateHeaders(extraHeaders = {}) {
  if (!REPLICATE_API_TOKEN) {
    throw Object.assign(new Error("REPLICATE_API_TOKEN is not configured"), {
      statusCode: 500,
      code: "MISSING_REPLICATE_TOKEN",
    });
  }

  return {
    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    ...extraHeaders,
  };
}

async function uploadImageToReplicate(imageBase64) {
  const { buffer, contentType } = parseDataUriOrBase64(imageBase64);
  const extension = fileExtensionForContentType(contentType);
  const form = new FormData();
  form.append("content", buffer, {
    filename: `ai-face-studio-${Date.now()}.${extension}`,
    contentType,
  });

  const response = await axios.post(`${REPLICATE_API_BASE}/files`, form, {
    headers: replicateHeaders(form.getHeaders()),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 45000,
  });

  const fileUrl = response.data?.urls?.get || response.data?.url;
  if (!fileUrl) {
    throw Object.assign(new Error("Replicate file upload did not return a URL"), {
      statusCode: 502,
      code: "UPLOAD_FAILED",
      provider: response.data,
    });
  }

  return fileUrl;
}

function titleCase(value) {
  return normalizeString(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeSubjectAnalysis(value = {}) {
  const allowedSubjectTypes = new Set(["human", "animal", "object", "unknown"]);
  const allowedHumanCategories = new Set([
    "adult female",
    "adult male",
    "child female",
    "child male",
    "unknown",
  ]);

  const rawSubjectType = normalizeString(value.subjectType).toLowerCase();
  const subjectType =
    rawSubjectType === "human" ||
    rawSubjectType === "animal" ||
    rawSubjectType === "unknown"
      ? rawSubjectType
      : rawSubjectType
        ? "object"
        : "unknown";
  const humanCategory = allowedHumanCategories.has(value.humanCategory)
    ? value.humanCategory
    : "unknown";
  const animalKind = normalizeString(value.animalKind).slice(0, 60);
  const objectKind = normalizeString(
    value.objectKind || value.plantKind || value.productKind || value.kind
  ).slice(0, 60);
  const confidence = normalizeString(value.confidence, "unknown").slice(0, 24);
  const subjectCount = Number.isFinite(Number(value.subjectCount))
    ? Math.max(0, Math.min(20, Number(value.subjectCount)))
    : null;
  const hasMultipleSubjects =
    typeof value.hasMultipleSubjects === "boolean"
      ? value.hasMultipleSubjects
      : subjectCount != null
        ? subjectCount > 1
        : false;
  const subjectSummary = normalizeString(value.subjectSummary).slice(0, 180);

  let label = "Detected: Automatic subject analysis";
  if (subjectType === "human") {
    label =
      humanCategory !== "unknown"
        ? `Detected: ${titleCase(humanCategory)}`
        : "Detected: Human";
  } else if (subjectType === "animal") {
    label = `Detected: Animal${animalKind ? ` - ${titleCase(animalKind)}` : ""}`;
  } else if (subjectType === "object") {
    label = `Detected: Object${objectKind ? ` - ${titleCase(objectKind)}` : ""}`;
  }
  if (hasMultipleSubjects && !label.includes("Multiple")) {
    label = label.replace("Detected:", "Detected: Multiple");
  }

  const promptLabel =
    subjectType === "human"
      ? humanCategory !== "unknown"
        ? humanCategory
        : "human"
      : subjectType === "animal"
        ? `animal${animalKind ? ` (${animalKind})` : ""}`
        : subjectType === "object"
          ? `object${objectKind ? ` (${objectKind})` : ""}`
          : "unknown subject";
  const compositionLabel = [
    hasMultipleSubjects ? "multiple visible subjects" : "single visible subject or unclear count",
    subjectCount != null && subjectCount > 0 ? `count ${subjectCount}` : "",
    subjectSummary ? `summary: ${subjectSummary}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  return {
    subjectType,
    humanCategory,
    animalKind: animalKind || null,
    objectKind: objectKind || null,
    subjectCount,
    hasMultipleSubjects,
    subjectSummary: subjectSummary || null,
    confidence,
    label,
    promptLabel,
    compositionLabel,
  };
}

function fallbackSubjectAnalysis(reason = "vision_api_unavailable") {
  return normalizeSubjectAnalysis({
    subjectType: "unknown",
    humanCategory: "unknown",
    confidence: reason,
  });
}

async function analyzeSubject(imageBase64) {
  if (!OPENAI_API_KEY) {
    return fallbackSubjectAnalysis("openai_key_missing");
  }

  const raw = normalizeString(imageBase64);
  const { contentType } = parseDataUriOrBase64(raw);
  const dataUrl = raw.startsWith("data:")
    ? raw
    : `data:${contentType};base64,${raw}`;

  try {
    const response = await axios.post(
      `${OPENAI_API_BASE}/chat/completions`,
      {
        model: OPENAI_VISION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You classify all prominent visible subjects in a user photo for an image-editing app. Return only compact JSON.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Classify the prominent subjects. subjectType must be human, animal, object, or unknown based on the overall image. Use object for any non-human and non-animal subject, including physical items, plants, products, scenes, vehicles, buildings, food, or abstract/non-living subjects. If human, humanCategory must be adult female, adult male, child female, child male, or unknown based on the most prominent visible human when clear. If animal, include animalKind when clear. If object, include objectKind when clear. Include subjectCount as the count of prominent people/animals/objects, hasMultipleSubjects as true when more than one prominent subject exists, subjectSummary as a short description of all prominent subjects and their layout, and confidence as high, medium, or low.",
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 45000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : {};
    return normalizeSubjectAnalysis(parsed);
  } catch (error) {
    console.warn("Subject analysis failed, using generation-time detection:", {
      message: error.message,
      status: error.response?.status,
    });
    return fallbackSubjectAnalysis("vision_api_failed");
  }
}

function buildSubjectInstruction(subjectAnalysis) {
  const detected = subjectAnalysis?.promptLabel || "unknown subject";
  const composition =
    subjectAnalysis?.compositionLabel || "composition must be inferred from the source image";

  return [
    "The uploaded source image is the authority for every prominent subject.",
    "Before editing, inspect the uploaded source image and infer all prominent people, animals, objects, and scene subjects.",
    "Classify the overall image as human, animal, object, mixed, or unknown. Treat any non-human and non-animal subject as object. For humans, infer visible presentation only when clear: adult female, adult male, child female, or child male.",
    `Server subject analysis: ${detected}.`,
    `Server composition analysis: ${composition}.`,
    "Hard rule: preserve every prominent source subject, including subject count, identities, object types, relative positions, scale relationships, and group layout.",
    "Hard rule: do not drop extra people, animals, or objects from the input unless the user's Studio Direction explicitly asks to remove them.",
    "Hard rule: do not merge multiple people or objects into one subject. Keep separate subjects visually separate.",
    "Hard rule: never introduce a person, woman, man, child, face, body, hair, skin, or human portrait when the uploaded image does not clearly contain a human.",
    "Hard rule: for non-human sources, do not add human-like heads, faces, eyes, mouths, noses, limbs, clothing, or character body parts unless those features already exist in the source.",
    "If the uploaded image is not clearly human, the output must remain non-human and preserve the original subject category.",
    "Only create a human result when the uploaded image clearly contains a human or the user's Studio Direction explicitly asks to transform the subject into a human.",
    "If the source contains multiple humans, preserve all visible people as separate people and apply the selected style consistently to the group.",
    "If the source contains multiple objects, preserve all prominent objects and their arrangement while applying the selected style.",
    "If the source contains both humans and objects or animals, preserve the mixed composition instead of focusing only on one subject.",
    "If any source person appears to be a child, keep that person child-appropriate and do not age the child into an adult unless the selected Age Studio target explicitly requests an adult age edit.",
  ].join("\n");
}

function resultTypeInstruction(subjectAnalysis) {
  if (subjectAnalysis?.subjectType === "human") {
    return "Create a premium, sharp, finished human result that preserves every visible person's identity, age category, visible presentation, and position in the group.";
  }

  if (subjectAnalysis?.subjectType === "animal") {
    return "Create a premium, sharp, finished animal result that preserves every visible animal as an animal. Do not add human facial features, human clothing, or a human body unless explicitly requested.";
  }

  if (subjectAnalysis?.subjectType === "object") {
    return "Create a premium, sharp, finished object or product-style result that preserves every prominent object as an object. Do not add any human person.";
  }

  return "Create a premium, sharp, finished result based on all prominent uploaded subjects. If the source is not clearly human, do not add any human person.";
}

function styleBranchInstruction(styleName) {
  const universal = [
    "Interpret the selected style through the subject or subjects that are actually visible in the source image.",
    "If the source contains humans, human portrait conventions are allowed for those humans.",
    "If the source contains multiple humans, style the whole group and preserve each person.",
    "If the source contains multiple non-human subjects, style the whole arrangement and preserve each prominent subject.",
    "If the source is not human, translate the style into an object, animal, product, scene, or subject treatment without adding any human figure.",
  ];

  const byStyle = {
    "AI Avatar": [
      "For human sources, create semi-realistic premium AI avatars of all visible people, preserving identity with refined skin, realistic lighting, and polished profile quality.",
      "For non-human sources, create a premium semi-realistic digital avatar representation of the same subject arrangement, not a human avatar and not a cartoon illustration.",
    ],
    Cartoon: [
      "For human sources, create visibly cartoon character versions of all visible people with simplified facial features, clean outlines, bright animated colors, and a non-photorealistic 3D cartoon finish.",
      "For non-human sources, create a visibly cartoon illustration of the same subject arrangement with original structures preserved, simplified geometry, smooth stylized surfaces, clean bold outlines, flat bright colors, cel shading, and non-photorealistic cartoon lighting.",
      "For non-human sources, cartoonize the real shapes that are already present. Do not add human faces, eyes, mouths, noses, heads, arms, legs, clothing, mascot features, or character parts.",
      "Cartoon must not look like an untouched realistic photo. The final image must read immediately as a cartoon illustration or animated-movie frame.",
      "Redraw the image into cartoon form rather than lightly retouching the original photo. Remove realistic camera noise, realistic photo texture, natural camera lighting, and real-world background detail.",
    ],
    Headshot: [
      "For human sources, create a clean professional headshot or group headshot that preserves all visible people.",
      "For non-human sources, treat Headshot as a clean centered close-up product or subject shot with studio lighting, preserving all prominent subjects, not a human headshot.",
    ],
    Fantasy: [
      "For human sources, create a fantasy portrait or group fantasy scene preserving all visible people.",
      "For non-human sources, create a fantasy-styled version of the same subject arrangement in a magical setting.",
    ],
    Anime: [
      "For human sources, create an anime portrait or anime group scene preserving all visible people.",
      "For non-human sources, create an anime-styled version of the same subject arrangement without adding a human character.",
    ],
    Cyberpunk: [
      "For human sources, create a cyberpunk portrait or group scene preserving all visible people.",
      "For non-human sources, create a cyberpunk-styled version of the same subject arrangement with neon lighting and sci-fi atmosphere.",
    ],
    Superhero: [
      "For human sources, create superhero versions of all visible people.",
      "For non-human sources, create a heroic poster-style version of the same subject arrangement without converting it into a human hero.",
    ],
    Professional: [
      "For human sources, create a premium professional business portrait or group business portrait preserving all visible people.",
      "For non-human sources, treat Professional as premium commercial product photography or polished subject presentation preserving all prominent subjects, not a person in business clothing.",
    ],
    "Age Studio": [
      "For human sources, apply the requested visible age target to each visible person while preserving individual identity and group layout.",
      "For non-human sources, do not create an aged person. Preserve the original subject arrangement and apply only subtle time, patina, maturity, season, or material-detail cues when appropriate.",
    ],
  };

  return [...universal, ...(byStyle[styleName] || [])].join("\n");
}

function buildCartoonPrompt({ customPrompt, subjectAnalysis }) {
  const studioDirection = normalizeString(customPrompt);
  const detected = subjectAnalysis?.promptLabel || "unknown subject";
  const composition =
    subjectAnalysis?.compositionLabel || "infer all visible subjects and layout from the source image";

  return [
    "Transform the uploaded image into a clearly non-photorealistic cartoon illustration.",
    "Use cel-shaded animated style, clean bold outlines, simplified shapes, flat bright colors, smooth stylized surfaces, and playful cartoon lighting.",
    "The output must look like a cartoon drawing or animated-movie frame, not a realistic camera photo.",
    "",
    `Detected source type: ${detected}.`,
    `Composition: ${composition}.`,
    "Preserve every prominent source subject, the number of subjects, object types, relative positions, and overall layout.",
    "Do not drop extra people, animals, or objects.",
    "Do not merge multiple subjects into one.",
    "Do not replace the uploaded subject with a generic symbol, logo, abstract mark, or unrelated icon unless the user explicitly asks to replace the subject.",
    "If the source is not clearly human, do not add any human person.",
    "If the source does not already have human-like faces, eyes, mouths, noses, heads, limbs, or clothing, do not add those features.",
    "",
    studioDirection
      ? [
          "STUDIO DIRECTION IS ACTIVE AND HAS CREATIVE PRIORITY.",
          "Apply the user's Studio Direction to outfit, materials, colors, background, pose, lighting, mood, composition, and final finish.",
          "If the Studio Direction conflicts with the default Cartoon look, keep the request but render it as a clear cartoon illustration.",
          `User Studio Direction: ${studioDirection}`,
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAiAvatarPrompt({ customPrompt, subjectAnalysis }) {
  const studioDirection = normalizeString(customPrompt);
  const detected = subjectAnalysis?.promptLabel || "unknown subject";
  const composition =
    subjectAnalysis?.compositionLabel || "infer all visible subjects and layout from the source image";

  return [
    "Transform the uploaded image into a premium AI Avatar result.",
    "The visible source subject or subjects must be the central artwork.",
    "The output must look like a polished semi-realistic digital avatar, not an untouched realistic camera photo and not a cartoon drawing.",
    "Use refined cinematic lighting, smooth realistic materials, subtle premium stylization, enhanced subject identity, crisp detail, and a finished profile-quality look.",
    "Avoid cartoon traits: no cel shading, no flat vector colors, no thick black outlines, no exaggerated cartoon proportions, no toy-like animated-movie finish.",
    "Create the result only from the subjects that already exist in the uploaded image.",
    "Do not invent a different category of subject.",
    "Do not create a human profile avatar unless the uploaded source image clearly shows a human person.",
    "",
    `Detected source type: ${detected}.`,
    `Composition: ${composition}.`,
    "Preserve every prominent source subject, the number of subjects, object types, relative positions, and overall layout.",
    "Do not drop extra people, animals, or objects.",
    "Do not merge multiple subjects into one.",
    "Do not replace the uploaded subject with a generic symbol, logo, abstract mark, letter, monogram, arrow, UI symbol, brand mark, or unrelated icon.",
    "If the user asks for an app icon or logo-like finish, the uploaded subject itself must become the visible central artwork in a premium semi-realistic avatar style.",
    "Only create a human avatar when the uploaded source image clearly contains a human person.",
    "If the source is not clearly human, do not add any human person, portrait, face, head, body, hair, skin, or clothing.",
    "If the source does not already have human-like faces, eyes, mouths, noses, heads, limbs, or clothing, do not add those features.",
    "",
    studioDirection
      ? [
          "STUDIO DIRECTION IS ACTIVE AND HAS CREATIVE PRIORITY.",
          "Apply the user's Studio Direction to identity styling, outfit, materials, colors, background, pose, lighting, mood, composition, and final finish.",
          "Studio Direction must style the original uploaded subject; it must not erase or replace the source subject unless the user explicitly asks for replacement.",
          "If Studio Direction asks for an icon, logo-like finish, or app-avatar look, keep the uploaded subject as the visible central artwork in a premium semi-realistic avatar style.",
          "If Studio Direction conflicts with the default AI Avatar look, keep the request but render it as a premium subject icon made from the uploaded source.",
          `User Studio Direction: ${studioDirection}`,
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function promptStrengthFor({ customPrompt, styleName, subjectAnalysis }) {
  const preserveFirstStyles = new Set([
    "AI Avatar",
    "Headshot",
    "Professional",
    "Age Studio",
  ]);

  if (
    subjectAnalysis?.subjectType === "unknown" &&
    preserveFirstStyles.has(styleName) &&
    styleName !== "AI Avatar"
  ) {
    return Number(process.env.SUBJECT_PRESERVE_STRICT_PROMPT_STRENGTH || 0.52);
  }

  if (styleName === "AI Avatar") {
    return Number(process.env.AI_AVATAR_PROMPT_STRENGTH || 0.72);
  }

  if (styleName === "Cartoon") {
    return Number(process.env.CARTOON_PROMPT_STRENGTH || 0.98);
  }

  if (styleName === "Age Studio") {
    return Number(process.env.AGE_PROMPT_STRENGTH || 0.82);
  }

  if (customPrompt) {
    return Number(process.env.CUSTOM_PROMPT_STRENGTH || 0.84);
  }

  if (subjectAnalysis?.subjectType === "human") {
    return Number(process.env.HUMAN_PROMPT_STRENGTH || 0.82);
  }

  return Number(process.env.SUBJECT_PRESERVE_PROMPT_STRENGTH || 0.68);
}

function buildPortraitPrompt({
  styleName,
  customPrompt,
  ageTarget,
  subjectAnalysis,
}) {
  if (styleName === "AI Avatar") {
    return buildAiAvatarPrompt({
      customPrompt,
      subjectAnalysis,
    });
  }

  if (styleName === "Cartoon") {
    return buildCartoonPrompt({
      customPrompt,
      subjectAnalysis,
    });
  }

  const baseline = STYLE_BASELINES[styleName] || STYLE_BASELINES["AI Avatar"];
  const studioDirection = normalizeString(customPrompt);
  const ageInstruction =
    styleName === "Age Studio"
      ? AGE_TARGETS[normalizeString(ageTarget)] || AGE_TARGETS["50s"]
      : "";
  const subjectInstruction = buildSubjectInstruction(subjectAnalysis);
  const branchInstruction = styleBranchInstruction(styleName);

  if (studioDirection) {
    return [
      subjectInstruction,
      "",
      branchInstruction,
      "",
      "STUDIO DIRECTION IS THE PRIMARY CREATIVE COMMAND.",
      "Follow the user's Studio Direction with maximum weight for wardrobe, identity styling, expression, pose, lighting, colors, background, camera angle, composition, genre, realism level, and final finish.",
      "If Studio Direction asks for something different from the selected style baseline, Studio Direction wins.",
      "",
      `User Studio Direction: ${studioDirection}`,
      "",
      `Selected app style baseline: ${styleName} - ${baseline}.`,
      ageInstruction ? `Age Studio target: ${ageInstruction}.` : "",
      "",
      `Use the uploaded photo as the visual source image. ${resultTypeInstruction(subjectAnalysis)} Visibly obey the Studio Direction without changing a non-human source into a human.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    subjectInstruction,
    "",
    branchInstruction,
    "",
    `Create a ${baseline}.`,
    ageInstruction ? `Age Studio target: ${ageInstruction}.` : "",
    `Use the uploaded photo as the visual source image. ${resultTypeInstruction(subjectAnalysis)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBackgroundPrompt(backgroundStyle) {
  const direction = normalizeString(backgroundStyle, "premium studio");
  return [
    "Replace or restyle the background according to the user's requested background direction.",
    "The background direction has full creative priority for environment, lighting, colors, atmosphere, depth, and finish.",
    `Background Direction: ${direction}`,
    "Keep the foreground person or subject naturally integrated into the new scene with a premium finished look.",
  ].join("\n");
}

function predictionEndpointForModel(model) {
  const [owner, name] = model.split("/");
  if (!owner || !name) {
    throw Object.assign(
      new Error("REPLICATE_MODEL must be in owner/model format"),
      {
        statusCode: 500,
        code: "INVALID_REPLICATE_MODEL",
      }
    );
  }

  return `${REPLICATE_API_BASE}/models/${owner}/${name}/predictions`;
}

async function createPrediction(input) {
  const response = await axios.post(
    predictionEndpointForModel(REPLICATE_MODEL),
    { input },
    {
      headers: replicateHeaders({
        "Content-Type": "application/json",
        Prefer: "wait=1",
      }),
      timeout: 45000,
    }
  );

  return response.data;
}

async function pollPrediction(prediction) {
  const startedAt = Date.now();
  let current = prediction;

  while (current.status !== "succeeded") {
    if (["failed", "canceled"].includes(current.status)) {
      throw Object.assign(
        new Error(current.error || `Prediction ${current.status}`),
        {
          statusCode: 502,
          code: "PROVIDER_FAILED",
          provider: current,
        }
      );
    }

    if (Date.now() - startedAt > PREDICTION_TIMEOUT_MS) {
      throw Object.assign(new Error("AI generation timed out"), {
        statusCode: 504,
        code: "PROVIDER_TIMEOUT",
        provider: current,
      });
    }

    await sleep(POLL_INTERVAL_MS);
    const response = await axios.get(current.urls.get, {
      headers: replicateHeaders(),
      timeout: 30000,
    });
    current = response.data;
  }

  return current;
}

function extractImageUrl(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const firstString = output.find((item) => typeof item === "string");
    if (firstString) return firstString;

    const nested = output
      .map((item) => extractImageUrl(item))
      .find((item) => typeof item === "string");
    if (nested) return nested;
  }
  if (output && typeof output === "object") {
    return (
      extractImageUrl(output.url) ||
      extractImageUrl(output.image) ||
      extractImageUrl(output.image_url) ||
      extractImageUrl(output.output) ||
      null
    );
  }
  return null;
}

async function runImageEdit({ imageBase64, prompt, promptStrength = 0.92 }) {
  const uploadedImageUrl = await uploadImageToReplicate(imageBase64);
  const prediction = await createPrediction({
    input_image: uploadedImageUrl,
    prompt,
    aspect_ratio: "1:1",
    output_format: "jpg",
    prompt_strength: promptStrength,
    safety_tolerance: Number(process.env.REPLICATE_SAFETY_TOLERANCE || 2),
  });

  const finalPrediction =
    prediction.status === "succeeded" ? prediction : await pollPrediction(prediction);
  const imageUrl = extractImageUrl(finalPrediction.output);

  if (!imageUrl) {
    throw Object.assign(new Error("AI generation returned no image"), {
      statusCode: 502,
      code: "NO_IMAGE_OUTPUT",
      provider: finalPrediction,
    });
  }

  return {
    imageUrl,
    prediction: finalPrediction,
    uploadedImageUrl,
  };
}

function publicError(error, fallbackCode = "SERVER_ERROR") {
  const statusCode = error.statusCode || error.response?.status || 500;
  const providerMessage =
    error.response?.data?.detail ||
    error.response?.data?.error ||
    error.response?.data?.message;

  return {
    statusCode,
    body: {
      success: false,
      imageUrl: null,
      error: providerMessage || error.message || "Server error",
      code: error.code || fallbackCode,
    },
  };
}

app.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "AI Face Studio Backend",
    version: "3.0.0-studio-direction",
    model: REPLICATE_MODEL,
  });
});

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    model: REPLICATE_MODEL,
    hasReplicateToken: Boolean(REPLICATE_API_TOKEN),
  });
});

app.post("/generate", async (req, res) => {
  const id = requestId();
  const startedAt = Date.now();

  try {
    const styleName = normalizeStyle(req.body?.styleName);
    const ageTarget = normalizeString(req.body?.ageTarget);
    const customPrompt = normalizeString(req.body?.customPrompt);
    const subjectAnalysis = await analyzeSubject(req.body?.imageBase64);

    console.log("Generate request:", {
      requestId: id,
      styleName,
      ageTarget: ageTarget || null,
      hasStudioDirection: Boolean(customPrompt),
      subjectAnalysis: subjectAnalysis.label,
      model: REPLICATE_MODEL,
    });

    const prompt = buildPortraitPrompt({
      styleName,
      customPrompt,
      ageTarget,
      subjectAnalysis,
    });

    const result = await runImageEdit({
      imageBase64: req.body?.imageBase64,
      prompt,
      promptStrength: promptStrengthFor({
        customPrompt,
        styleName,
        subjectAnalysis,
      }),
    });

    console.log("Generated portrait:", {
      requestId: id,
      styleName,
      imageUrl: result.imageUrl,
      durationMs: Date.now() - startedAt,
    });

    res.json({
      success: true,
      imageUrl: result.imageUrl,
      error: null,
      studio: {
        styleName,
        ageTarget: ageTarget || null,
        subjectAnalysis,
        studioDirectionApplied: Boolean(customPrompt),
        model: REPLICATE_MODEL,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const { statusCode, body } = publicError(error);
    body.requestId = id;
    console.error("Generate error:", {
      requestId: id,
      statusCode,
      code: body.code,
      message: body.error,
    });
    res.status(statusCode).json(body);
  }
});

app.post("/background", async (req, res) => {
  const id = requestId();
  const startedAt = Date.now();

  try {
    const backgroundStyle = normalizeString(
      req.body?.backgroundStyle,
      "premium studio"
    );
    const prompt = buildBackgroundPrompt(backgroundStyle);

    console.log("Background request:", {
      requestId: id,
      backgroundStyle,
      model: REPLICATE_MODEL,
    });

    const result = await runImageEdit({
      imageBase64: req.body?.imageBase64,
      prompt,
      promptStrength: 0.94,
    });

    console.log("Generated background:", {
      requestId: id,
      imageUrl: result.imageUrl,
      durationMs: Date.now() - startedAt,
    });

    res.json({
      success: true,
      imageUrl: result.imageUrl,
      error: null,
    });
  } catch (error) {
    const { statusCode, body } = publicError(error);
    body.requestId = id;
    console.error("Background error:", {
      requestId: id,
      statusCode,
      code: body.code,
      message: body.error,
    });
    res.status(statusCode).json(body);
  }
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    imageUrl: null,
    error: "Route not found",
    code: "NOT_FOUND",
  });
});

app.listen(PORT, () => {
  console.log(
    `AI Face Studio backend v3.0.0-studio-direction running on port ${PORT}`
  );
});
