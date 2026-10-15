/*
 * workflows.js — GENERATED FILE. Do not edit by hand.
 *
 * Regenerate with:  node tools/sync-workflows.js [path-to-sillytavern]
 *
 * Each entry holds a ComfyUI API-format graph with its placeholder fields
 * left intact, so the app substitutes them per generation. Two placeholder
 * conventions are carried through unchanged and both are understood at
 * runtime (see substituteComfyWorkflow in js/comfy.js):
 *
 *   "%prompt%"            SillyTavern's Stable Diffusion extension
 *   {{POSITIVE_PROMPT}}   the ComfyInject extension
 *
 * Loaded via <script src>, not fetch(), because the app must stay usable as
 * a bare file:// page.
 */

const COMFY_BUILTIN_WORKFLOWS = [
  {
    id: "default-comfy-workflow",
    label: "Default Comfy Workflow",
    origin: "user",
    style: "st",
    sourceFile: "Default_Comfy_Workflow.json",
    workflow: "{\r\n    \"3\": {\r\n        \"class_type\": \"KSampler\",\r\n        \"inputs\": {\r\n            \"cfg\": \"%scale%\",\r\n            \"denoise\": 1,\r\n            \"latent_image\": [\r\n                \"5\",\r\n                0\r\n            ],\r\n            \"model\": [\r\n                \"4\",\r\n                0\r\n            ],\r\n            \"negative\": [\r\n                \"7\",\r\n                0\r\n            ],\r\n            \"positive\": [\r\n                \"6\",\r\n                0\r\n            ],\r\n            \"sampler_name\": \"%sampler%\",\r\n            \"scheduler\": \"%scheduler%\",\r\n            \"seed\": \"%seed%\",\r\n            \"steps\": \"%steps%\"\r\n        }\r\n    },\r\n    \"4\": {\r\n        \"class_type\": \"CheckpointLoaderSimple\",\r\n        \"inputs\": {\r\n            \"ckpt_name\": \"%model%\"\r\n        }\r\n    },\r\n    \"5\": {\r\n        \"class_type\": \"EmptyLatentImage\",\r\n        \"inputs\": {\r\n            \"batch_size\": 1,\r\n            \"height\": \"%height%\",\r\n            \"width\": \"%width%\"\r\n        }\r\n    },\r\n    \"6\": {\r\n        \"class_type\": \"CLIPTextEncode\",\r\n        \"inputs\": {\r\n            \"clip\": [\r\n                \"4\",\r\n                1\r\n            ],\r\n            \"text\": \"%prompt%\"\r\n        }\r\n    },\r\n    \"7\": {\r\n        \"class_type\": \"CLIPTextEncode\",\r\n        \"inputs\": {\r\n            \"clip\": [\r\n                \"4\",\r\n                1\r\n            ],\r\n            \"text\": \"%negative_prompt%\"\r\n        }\r\n    },\r\n    \"8\": {\r\n        \"class_type\": \"VAEDecode\",\r\n        \"inputs\": {\r\n            \"samples\": [\r\n                \"3\",\r\n                0\r\n            ],\r\n            \"vae\": [\r\n                \"4\",\r\n                2\r\n            ]\r\n        }\r\n    },\r\n    \"9\": {\r\n        \"class_type\": \"SaveImage\",\r\n        \"inputs\": {\r\n            \"filename_prefix\": \"SillyTavern\",\r\n            \"images\": [\r\n                \"8\",\r\n                0\r\n            ]\r\n        }\r\n    }\r\n}\r\n",
  },
  {
    id: "wai-hswq-turbo",
    label: "WAI HSWQ Turbo",
    origin: "user",
    style: "comfyinject",
    sourceFile: "WAI_HSWQ_Turbo.json",
    workflow: "{\n  \"1\": {\n    \"inputs\": {\n      \"ckpt_name\": \"{{CHECKPOINT}}\"\n    },\n    \"class_type\": \"CheckpointLoaderSimple\",\n    \"_meta\": { \"title\": \"Load Checkpoint\" }\n  },\n  \"2\": {\n    \"inputs\": {\n      \"text\": \"{{POSITIVE_PROMPT}}\",\n      \"clip\": [\"1\", 1]\n    },\n    \"class_type\": \"CLIPTextEncode\",\n    \"_meta\": { \"title\": \"CLIP Text Encode (Prompt)\" }\n  },\n  \"3\": {\n    \"inputs\": {\n      \"text\": \"{{NEGATIVE_PROMPT}}\",\n      \"clip\": [\"1\", 1]\n    },\n    \"class_type\": \"CLIPTextEncode\",\n    \"_meta\": { \"title\": \"CLIP Text Encode (Negative Prompt)\" }\n  },\n  \"4\": {\n    \"inputs\": {\n      \"width\": \"{{WIDTH}}\",\n      \"height\": \"{{HEIGHT}}\",\n      \"batch_size\": 1\n    },\n    \"class_type\": \"EmptyLatentImage\",\n    \"_meta\": { \"title\": \"Empty Latent Image\" }\n  },\n  \"5\": {\n    \"inputs\": {\n      \"seed\": \"{{SEED}}\",\n      \"steps\": 10,\n      \"cfg\": 1.0,\n      \"sampler_name\": \"euler_ancestral\",\n      \"scheduler\": \"normal\",\n      \"denoise\": 1.0,\n      \"model\": [\"1\", 0],\n      \"positive\": [\"2\", 0],\n      \"negative\": [\"3\", 0],\n      \"latent_image\": [\"4\", 0]\n    },\n    \"class_type\": \"KSampler\",\n    \"_meta\": { \"title\": \"KSampler (WAI HSWQ v17 DMD2 turbo: 10 steps, cfg 1.0, euler a)\" }\n  },\n  \"6\": {\n    \"inputs\": {\n      \"samples\": [\"5\", 0],\n      \"vae\": [\"1\", 2]\n    },\n    \"class_type\": \"VAEDecode\",\n    \"_meta\": { \"title\": \"VAE Decode\" }\n  },\n  \"7\": {\n    \"inputs\": {\n      \"filename_prefix\": \"ComfyInject\",\n      \"images\": [\"6\", 0]\n    },\n    \"class_type\": \"SaveImage\",\n    \"_meta\": { \"title\": \"Save Image\" }\n  }\n}\n",
  },
  {
    id: "wai-hswq-turbo-st",
    label: "WAI HSWQ Turbo ST",
    origin: "user",
    style: "st",
    sourceFile: "WAI_HSWQ_Turbo_ST.json",
    workflow: "{\n    \"1\": {\n        \"class_type\": \"CheckpointLoaderSimple\",\n        \"inputs\": {\n            \"ckpt_name\": \"%model%\"\n        }\n    },\n    \"2\": {\n        \"class_type\": \"CLIPTextEncode\",\n        \"inputs\": {\n            \"text\": \"%prompt%\",\n            \"clip\": [\"1\", 1]\n        }\n    },\n    \"3\": {\n        \"class_type\": \"CLIPTextEncode\",\n        \"inputs\": {\n            \"text\": \"%negative_prompt%\",\n            \"clip\": [\"1\", 1]\n        }\n    },\n    \"4\": {\n        \"class_type\": \"EmptyLatentImage\",\n        \"inputs\": {\n            \"width\": \"%width%\",\n            \"height\": \"%height%\",\n            \"batch_size\": 1\n        }\n    },\n    \"5\": {\n        \"class_type\": \"KSampler\",\n        \"inputs\": {\n            \"seed\": \"%seed%\",\n            \"steps\": \"%steps%\",\n            \"cfg\": \"%scale%\",\n            \"sampler_name\": \"%sampler%\",\n            \"scheduler\": \"%scheduler%\",\n            \"denoise\": 1,\n            \"model\": [\"1\", 0],\n            \"positive\": [\"2\", 0],\n            \"negative\": [\"3\", 0],\n            \"latent_image\": [\"4\", 0]\n        }\n    },\n    \"6\": {\n        \"class_type\": \"VAEDecode\",\n        \"inputs\": {\n            \"samples\": [\"5\", 0],\n            \"vae\": [\"1\", 2]\n        }\n    },\n    \"7\": {\n        \"class_type\": \"SaveImage\",\n        \"inputs\": {\n            \"filename_prefix\": \"SillyTavern\",\n            \"images\": [\"6\", 0]\n        }\n    }\n}\n",
  },
  {
    id: "comfyinject-default",
    label: "comfyinject default",
    origin: "comfyinject",
    style: "comfyinject",
    sourceFile: "comfyinject_default.json",
    workflow: "{\r\n  \"1\": {\r\n    \"inputs\": {\r\n      \"ckpt_name\": \"{{CHECKPOINT}}\"\r\n    },\r\n    \"class_type\": \"CheckpointLoaderSimple\",\r\n    \"_meta\": {\r\n      \"title\": \"Load Checkpoint\"\r\n    }\r\n  },\r\n  \"2\": {\r\n    \"inputs\": {\r\n      \"text\": \"{{POSITIVE_PROMPT}}\",\r\n      \"clip\": [\r\n        \"1\",\r\n        1\r\n      ]\r\n    },\r\n    \"class_type\": \"CLIPTextEncode\",\r\n    \"_meta\": {\r\n      \"title\": \"CLIP Text Encode (Prompt)\"\r\n    }\r\n  },\r\n  \"3\": {\r\n    \"inputs\": {\r\n      \"text\": \"{{NEGATIVE_PROMPT}}\",\r\n      \"clip\": [\r\n        \"1\",\r\n        1\r\n      ]\r\n    },\r\n    \"class_type\": \"CLIPTextEncode\",\r\n    \"_meta\": {\r\n      \"title\": \"CLIP Text Encode (Prompt)\"\r\n    }\r\n  },\r\n  \"4\": {\r\n    \"inputs\": {\r\n      \"width\": \"{{WIDTH}}\",\r\n      \"height\": \"{{HEIGHT}}\",\r\n      \"batch_size\": 1\r\n    },\r\n    \"class_type\": \"EmptyLatentImage\",\r\n    \"_meta\": {\r\n      \"title\": \"Empty Latent Image\"\r\n    }\r\n  },\r\n  \"5\": {\r\n    \"inputs\": {\r\n      \"seed\": \"{{SEED}}\",\r\n      \"steps\": \"{{STEPS}}\",\r\n      \"cfg\": \"{{CFG}}\",\r\n      \"sampler_name\": \"{{SAMPLER}}\",\r\n      \"scheduler\": \"{{SCHEDULER}}\",\r\n      \"denoise\": \"{{DENOISE}}\",\r\n      \"model\": [\r\n        \"1\",\r\n        0\r\n      ],\r\n      \"positive\": [\r\n        \"2\",\r\n        0\r\n      ],\r\n      \"negative\": [\r\n        \"3\",\r\n        0\r\n      ],\r\n      \"latent_image\": [\r\n        \"4\",\r\n        0\r\n      ]\r\n    },\r\n    \"class_type\": \"KSampler\",\r\n    \"_meta\": {\r\n      \"title\": \"KSampler\"\r\n    }\r\n  },\r\n  \"6\": {\r\n    \"inputs\": {\r\n      \"samples\": [\r\n        \"5\",\r\n        0\r\n      ],\r\n      \"vae\": [\r\n        \"1\",\r\n        2\r\n      ]\r\n    },\r\n    \"class_type\": \"VAEDecode\",\r\n    \"_meta\": {\r\n      \"title\": \"VAE Decode\"\r\n    }\r\n  },\r\n  \"7\": {\r\n    \"inputs\": {\r\n      \"filename_prefix\": \"ComfyInject\",\r\n      \"images\": [\r\n        \"6\",\r\n        0\r\n      ]\r\n    },\r\n    \"class_type\": \"SaveImage\",\r\n    \"_meta\": {\r\n      \"title\": \"Save Image\"\r\n    }\r\n  }\r\n}",
  },
  {
    id: "comfyinject-default-tipo",
    label: "comfyinject default TIPO",
    origin: "comfyinject",
    style: "comfyinject",
    sourceFile: "comfyinject_default_TIPO.json",
    workflow: "{\n  \"1\": {\n    \"inputs\": {\n      \"ckpt_name\": \"{{CHECKPOINT}}\"\n    },\n    \"class_type\": \"CheckpointLoaderSimple\",\n    \"_meta\": {\n      \"title\": \"Load Checkpoint\"\n    }\n  },\n  \"10\": {\n    \"inputs\": {\n      \"tags\": \"{{POSITIVE_PROMPT}}\",\n      \"nl_prompt\": \"\",\n      \"ban_tags\": \"{{TIPO_BAN}}\",\n      \"tipo_model\": \"KBlueLeaf/TIPO-500M-ft | TIPO-500M-ft-F16.gguf\",\n      \"format\": \"<|special|>,\\n<|characters|>, <|copyrights|>,\\n\\n<|general|>,\\n\\n<|quality|>, <|meta|>, <|rating|>\",\n      \"width\": \"{{WIDTH}}\",\n      \"height\": \"{{HEIGHT}}\",\n      \"temperature\": 0.3,\n      \"top_p\": 0.95,\n      \"min_p\": 0.05,\n      \"top_k\": 80,\n      \"tag_length\": \"short\",\n      \"nl_length\": \"very_short\",\n      \"seed\": \"{{SEED}}\",\n      \"device\": \"cpu\"\n    },\n    \"class_type\": \"TIPO\",\n    \"_meta\": {\n      \"title\": \"TIPO (prompt presampling, CPU)\"\n    }\n  },\n  \"2\": {\n    \"inputs\": {\n      \"text\": [\n        \"10\",\n        0\n      ],\n      \"clip\": [\n        \"1\",\n        1\n      ]\n    },\n    \"class_type\": \"CLIPTextEncode\",\n    \"_meta\": {\n      \"title\": \"CLIP Text Encode (TIPO expanded prompt)\"\n    }\n  },\n  \"3\": {\n    \"inputs\": {\n      \"text\": \"{{NEGATIVE_PROMPT}}\",\n      \"clip\": [\n        \"1\",\n        1\n      ]\n    },\n    \"class_type\": \"CLIPTextEncode\",\n    \"_meta\": {\n      \"title\": \"CLIP Text Encode (Negative)\"\n    }\n  },\n  \"4\": {\n    \"inputs\": {\n      \"width\": \"{{WIDTH}}\",\n      \"height\": \"{{HEIGHT}}\",\n      \"batch_size\": 1\n    },\n    \"class_type\": \"EmptyLatentImage\",\n    \"_meta\": {\n      \"title\": \"Empty Latent Image\"\n    }\n  },\n  \"5\": {\n    \"inputs\": {\n      \"seed\": \"{{SEED}}\",\n      \"steps\": \"{{STEPS}}\",\n      \"cfg\": \"{{CFG}}\",\n      \"sampler_name\": \"{{SAMPLER}}\",\n      \"scheduler\": \"{{SCHEDULER}}\",\n      \"denoise\": \"{{DENOISE}}\",\n      \"model\": [\n        \"1\",\n        0\n      ],\n      \"positive\": [\n        \"2\",\n        0\n      ],\n      \"negative\": [\n        \"3\",\n        0\n      ],\n      \"latent_image\": [\n        \"4\",\n        0\n      ]\n    },\n    \"class_type\": \"KSampler\",\n    \"_meta\": {\n      \"title\": \"KSampler\"\n    }\n  },\n  \"6\": {\n    \"inputs\": {\n      \"samples\": [\n        \"5\",\n        0\n      ],\n      \"vae\": [\n        \"1\",\n        2\n      ]\n    },\n    \"class_type\": \"VAEDecode\",\n    \"_meta\": {\n      \"title\": \"VAE Decode\"\n    }\n  },\n  \"7\": {\n    \"inputs\": {\n      \"filename_prefix\": \"ComfyInject_TIPO\",\n      \"images\": [\n        \"6\",\n        0\n      ]\n    },\n    \"class_type\": \"SaveImage\",\n    \"_meta\": {\n      \"title\": \"Save Image\"\n    }\n  }\n}\n",
  },
  {
    id: "wai-hswq-turbo-wide",
    label: "WAI HSWQ Turbo Wide",
    origin: "comfyinject",
    style: "comfyinject",
    sourceFile: "WAI_HSWQ_Turbo_Wide.json",
    workflow: "{\n  \"1\": {\n    \"inputs\": {\n      \"ckpt_name\": \"{{CHECKPOINT}}\"\n    },\n    \"class_type\": \"CheckpointLoaderSimple\",\n    \"_meta\": { \"title\": \"Load Checkpoint\" }\n  },\n  \"2\": {\n    \"inputs\": {\n      \"text\": \"{{POSITIVE_PROMPT}}\",\n      \"clip\": [\"1\", 1]\n    },\n    \"class_type\": \"CLIPTextEncode\",\n    \"_meta\": { \"title\": \"CLIP Text Encode (Prompt)\" }\n  },\n  \"3\": {\n    \"inputs\": {\n      \"text\": \"{{NEGATIVE_PROMPT}}\",\n      \"clip\": [\"1\", 1]\n    },\n    \"class_type\": \"CLIPTextEncode\",\n    \"_meta\": { \"title\": \"CLIP Text Encode (Negative Prompt)\" }\n  },\n  \"4\": {\n    \"inputs\": {\n      \"width\": \"{{WIDTH}}\",\n      \"height\": \"{{HEIGHT}}\",\n      \"batch_size\": 1\n    },\n    \"class_type\": \"EmptyLatentImage\",\n    \"_meta\": { \"title\": \"Empty Latent Image\" }\n  },\n  \"5\": {\n    \"inputs\": {\n      \"seed\": \"{{SEED}}\",\n      \"steps\": \"{{STEPS}}\",\n      \"cfg\": \"{{CFG}}\",\n      \"sampler_name\": \"{{SAMPLER}}\",\n      \"scheduler\": \"{{SCHEDULER}}\",\n      \"denoise\": \"{{DENOISE}}\",\n      \"model\": [\"1\", 0],\n      \"positive\": [\"2\", 0],\n      \"negative\": [\"3\", 0],\n      \"latent_image\": [\"4\", 0]\n    },\n    \"class_type\": \"KSampler\",\n    \"_meta\": { \"title\": \"KSampler (WAI HSWQ v17 DMD2 turbo: 10 steps, cfg 1.0, euler a)\" }\n  },\n  \"6\": {\n    \"inputs\": {\n      \"samples\": [\"5\", 0],\n      \"vae\": [\"1\", 2]\n    },\n    \"class_type\": \"VAEDecode\",\n    \"_meta\": { \"title\": \"VAE Decode\" }\n  },\n  \"8\": {\n    \"inputs\": {\n      \"model_name\": \"bbox/face_yolov8m.pt\"\n    },\n    \"class_type\": \"UltralyticsDetectorProvider\",\n    \"_meta\": { \"title\": \"BBox Detector (face_yolov8m)\" }\n  },\n  \"9\": {\n    \"inputs\": {\n      \"image\": [\"6\", 0],\n      \"model\": [\"1\", 0],\n      \"clip\": [\"1\", 1],\n      \"vae\": [\"1\", 2],\n      \"guide_size\": 384,\n      \"guide_size_for\": true,\n      \"max_size\": 768,\n      \"seed\": \"{{SEED}}\",\n      \"steps\": \"{{STEPS}}\",\n      \"cfg\": \"{{CFG}}\",\n      \"sampler_name\": \"{{SAMPLER}}\",\n      \"scheduler\": \"{{SCHEDULER}}\",\n      \"positive\": [\"2\", 0],\n      \"negative\": [\"3\", 0],\n      \"denoise\": 0.5,\n      \"feather\": 10,\n      \"noise_mask\": true,\n      \"force_inpaint\": true,\n      \"bbox_threshold\": 0.3,\n      \"bbox_dilation\": 4,\n      \"bbox_crop_factor\": 1.7,\n      \"sam_detection_hint\": \"center-1\",\n      \"sam_dilation\": 0,\n      \"sam_threshold\": 0.93,\n      \"sam_bbox_expansion\": 0,\n      \"sam_mask_hint_threshold\": 0.7,\n      \"sam_mask_hint_use_negative\": \"False\",\n      \"drop_size\": 16,\n      \"bbox_detector\": [\"8\", 0],\n      \"wildcard\": \"\",\n      \"cycle\": 1\n    },\n    \"class_type\": \"FaceDetailer\",\n    \"_meta\": { \"title\": \"Face Detailer (wide-shot pass)\" }\n  },\n  \"7\": {\n    \"inputs\": {\n      \"filename_prefix\": \"ComfyInject\",\n      \"images\": [\"9\", 0]\n    },\n    \"class_type\": \"SaveImage\",\n    \"_meta\": { \"title\": \"Save Image\" }\n  }\n}\n",
  },
];

/* eslint-disable-next-line no-unused-vars */

/* Skipped during the last sync:
 *   Char_Avatar_Comfy_Workflow.json: skipped, needs an input image (ETN_LoadImageBase64) — chatchat is text-to-image only
 *   WAI_Jab_AyPapi.json: skipped, loads LoRA(s) jab_aypapi17.safetensors (machine-specific path)
 *   WAI_Jab_Housework.json: skipped, loads LoRA(s) jab_housework.safetensors (machine-specific path)
 *   WAI_Jab_Silvia.json: skipped, loads LoRA(s) jab_silvia.safetensors (machine-specific path)
 *   WAI_Scenic.json: skipped, loads LoRA(s) scenic_bg.safetensors (machine-specific path)
 *   Char_Avatar_Comfy_Workflow.json: skipped, needs an input image (ETN_LoadImageBase64) — chatchat is text-to-image only
 *   Default_Comfy_Workflow.json: duplicate of an already-collected workflow, skipped
 *   Eldoria.json: not API-graph format (editor-format exports cannot be posted to /prompt)
 *   index.json: not API-graph format (editor-format exports cannot be posted to /prompt)
 *   settings.json: not API-graph format (editor-format exports cannot be posted to /prompt)
 *   WAI_HSWQ_Turbo.json: duplicate of an already-collected workflow, skipped
 *   WAI_Jab_AyPapi_CI.json: skipped, loads LoRA(s) jab_aypapi17.safetensors (machine-specific path)
 */
