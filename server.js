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
    "premium AI avatar portrait, polished digital studio finish, clear face, detailed outfit, strong visual identity, high-end app result",
  Cartoon:
    "premium 3D animated movie character portrait, expressive stylized face, polished character materials, cinematic cartoon lighting",
  Headshot:
    "clean professional headshot, sharp eyes, natural skin texture, premium studio lighting, confident profile-photo composition",
  Fantasy:
    "cinematic fantasy portrait, rich wardrobe, magical environment, elegant lighting, detailed atmosphere, premium fantasy finish",
  Anime:
    "high-end anime portrait, expressive eyes, clean linework, polished color, cinematic anime lighting, detailed background",
  Cyberpunk:
    "futuristic cyberpunk portrait, neon city lighting, sleek techwear, reflective materials, cinematic sci-fi atmosphere",
  Superhero:
    "cinematic superhero portrait, powerful costume design, heroic posture, dramatic lighting, premium action-poster finish",
  Professional:
    "premium business portrait, refined wardrobe, modern office or studio background, confident posture, polished commercial photography",
  "Age Studio":
    "realistic age-edited portrait, premium studio photography, natural skin texture, clear face, tasteful wardrobe and background",
};

const AGE_TARGETS = {
  "Younger Adult":
    "make the person look like a younger adult, with realistic adult facial maturity and natural polished skin texture",
  "30s":
    "make the person look like they are in their 30s, with natural adult maturity and realistic skin texture",
  "40s":
    "make the person look like they are in their 40s, with realistic mature adult facial detail",
  "50s":
    "make the person look like they are in their 50s, with natural age texture and premium portrait realism",
  "60s":
    "make the person look like they are in their 60s, with realistic senior-adult detail, mature skin texture, and natural dignity",
  "Senior Adult":
    "make the person look like a senior adult, with believable mature aging details and premium portrait realism",
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

function buildPortraitPrompt({
  styleName,
  genderMode,
  customPrompt,
  ageTarget,
}) {
  const baseline = STYLE_BASELINES[styleName] || STYLE_BASELINES["AI Avatar"];
  const studioDirection = normalizeString(customPrompt);
  const gender = normalizeString(genderMode, "Auto");
  const ageInstruction =
    styleName === "Age Studio"
      ? AGE_TARGETS[normalizeString(ageTarget)] || AGE_TARGETS["50s"]
      : "";

  if (studioDirection) {
    return [
      "STUDIO DIRECTION IS THE PRIMARY CREATIVE COMMAND.",
      "Follow the user's Studio Direction with maximum weight for wardrobe, identity styling, expression, pose, lighting, colors, background, camera angle, composition, genre, realism level, and final finish.",
      "If Studio Direction asks for something different from the selected style baseline, Studio Direction wins.",
      "",
      `User Studio Direction: ${studioDirection}`,
      "",
      `Selected app style baseline: ${styleName} - ${baseline}.`,
      gender && gender !== "Auto" ? `Requested gender mode: ${gender}.` : "",
      ageInstruction ? `Age Studio target: ${ageInstruction}.` : "",
      "",
      "Use the uploaded photo as the visual source image. Produce a premium, sharp, finished portrait that visibly obeys the Studio Direction.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Create a ${baseline}.`,
    gender && gender !== "Auto" ? `Requested gender mode: ${gender}.` : "",
    ageInstruction ? `Age Studio target: ${ageInstruction}.` : "",
    "Use the uploaded photo as the visual source image. Produce a premium, sharp, finished portrait.",
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
    const genderMode = normalizeString(req.body?.genderMode, "Auto");
    const ageTarget = normalizeString(req.body?.ageTarget);
    const customPrompt = normalizeString(req.body?.customPrompt);

    console.log("Generate request:", {
      requestId: id,
      styleName,
      genderMode,
      ageTarget: ageTarget || null,
      hasStudioDirection: Boolean(customPrompt),
      model: REPLICATE_MODEL,
    });

    const prompt = buildPortraitPrompt({
      styleName,
      genderMode,
      customPrompt,
      ageTarget,
    });

    const result = await runImageEdit({
      imageBase64: req.body?.imageBase64,
      prompt,
      promptStrength: customPrompt ? 0.98 : 0.9,
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
        genderMode,
        ageTarget: ageTarget || null,
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
