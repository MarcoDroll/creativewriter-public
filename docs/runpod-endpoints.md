# Your own image endpoints on RunPod

CreativeWriter's image tool can render on RunPod Serverless endpoints that you deploy and pay for yourself. It is **experimental**: turn on **Settings → AI models → Experimental providers**, and a RunPod section appears.

This page describes what such an endpoint has to provide. It describes an API, not a particular worker. Any worker that answers the way it describes will work.

## What you enter in Settings

- **A RunPod API key.** Safer: a *restricted* key with Read/Write access to your two endpoints only. That is enough to run jobs.
- **One endpoint ID per model**, for `flux2-klein-9b` and/or `qwen-image-2.1`. Leave a field empty if you don't run that model. Pasting the endpoint's URL works too.

Your key and endpoint IDs stay on the device you entered them on. They are never synced. A settings export leaves the key out unless you ask for it.

**Test connection** asks each endpoint's `/health` and says whether it answered, and whether the next picture will have to start a worker first.

## How the app talks to your endpoint

The browser calls RunPod directly, with no server of ours in between:

| Call | Used for |
|---|---|
| `POST https://api.runpod.ai/v2/{endpoint}/run` with `{"input": <request>}` | starting a picture |
| `GET  …/status/{job}` | following it, every few seconds, for up to 40 minutes |
| `POST …/cancel/{job}` | Cancel |
| `GET  …/health` | Test connection, and the "no GPU free" hint while a job waits |

Every call is sent with `Authorization: Bearer <your key>`. RunPod answers these calls for any web page (CORS), so nothing needs setting up for that.

Pictures come back inside the job's result and are stored on your device. RunPod deletes a finished job's result after 30 minutes, so a job collected later than that is reported as expired.

## The request (schema version 1)

```jsonc
{
  "schema_version": 1,
  "model": "flux2-klein-9b",            // or "qwen-image-2.1" — must match the endpoint
  "prompt": "…",
  "negative_prompt": "…",               // optional
  "size": { "width": 1024, "height": 768 },   // optional; never together with a mask
  "sampling": { "steps": 20, "cfg": 5, "sampler": "euler", "seed": 42 },
  "num_images": 1,                      // 1–4
  "images": [{ "b64": "…" }],           // guides, in order; image 1 is the picture being changed
  "mask": { "b64": "…", "grow": 0, "blur": 8 },   // white = change, black = keep
  "loras": [{ "name": "…", "strength": 1.0 }],    // only if your worker offers a LoRA
  "output": { "format": "webp", "quality": 90, "delivery": "b64" }
}
```

The app never sends a mode. The endpoint works it out from what arrives:

- **no `images`**: text to image;
- **`images`**: an edit;
- **`images` and a `mask`**: inpainting.

A worker must reject fields it doesn't know. The app sends only the ones above, and only where they apply:

- a `scheduler` goes to Qwen alone (`"simple"`);
- a LoRA goes only to a model that lists one;
- the `size` is dropped whenever there is a mask.

## The result

A `COMPLETED` job's `output`:

```jsonc
{
  "schema_version": 1,
  "model": "qwen-image-2.1",
  "images": [{ "b64": "…", "format": "webp", "width": 1024, "height": 768, "seed": 42 }],
  "timings": { "run_s": 7.2, "total_s": 7.4 }
}
```

A `FAILED` job carries its error in `error` as a **JSON string**: `{"code": "…", "message": "…"}`. The app recognises these codes:

- `invalid_request`
- `model_mismatch`
- `limit_exceeded`
- `unknown_lora`
- `unsupported_mode`
- `image_fetch_failed`
- `invalid_image`
- `bucket_not_configured`
- `response_too_large`
- `comfy_error`
- `oom`
- `timeout`

Each one gets its own message in the app. The worker's own text is shown as a detail underneath.

## Limits the app checks before sending

A worker that has scaled to zero takes minutes to start, and only then can it say a request is too large. So the app checks these first and holds Generate, with a note, instead of sending:

| | FLUX.2 klein (`flux2-klein-9b`) | Qwen Image 2.1 (`qwen-image-2.1`) |
|---|---|---|
| Guides | up to 2 | up to 10 |
| Pictures per request | up to 4 | up to 4 |
| Side length | 256–2048, a multiple of 16 | 256–2048, a multiple of 32 |
| Pixels per picture / in total | 4,194,304 / 8,388,608 | 4,194,304 / 8,388,608 |
| Steps | up to 50 (default 20) | up to 50 (default 25) |
| Guidance (CFG) default | 5 | 1 |
| Work budget | 420 | 700 |

The work budget is `(output megapixels + guides × 1) × pictures × steps`. The endpoint should refuse anything over these limits as well (`limit_exceeded`).

## Licences

The models carry their own licences, and running them is your responsibility:

- **FLUX.2 klein** is under the FLUX Non-Commercial License.
- **Qwen Image 2.1** is under the Qwen Research License. The app shows "Built with Qwen" wherever the model is chosen or configured.

Check the terms of any LoRA you add, and RunPod's acceptable-use policy, for your own account.
