# ChatGPT plan sign-in (development preview)

TJ keeps the existing OpenAI API-key provider. The separate ChatGPT Account connection uses the official open-source Sign in with ChatGPT flow, under `TJ_CHATGPT_PLAN_SIGNIN_ENABLED=1`. It is disabled by default so an ineligible private or commercial build cannot claim ChatGPT-plan inference.

The public TJ source is MIT licensed. OpenAI describes ChatGPT plan usage as available to open-source partners and selected private clients. A future paid or remotely hosted version needs the applicable OpenAI commercial approval and terms before this feature is enabled for customers. An ordinary Plus subscription alone does not authorize an arbitrary commercial app.

## Local setup

1. Run the TJ API and web UI locally. Set `TJ_CHATGPT_PLAN_SIGNIN_ENABLED=1` in your ignored `.env`, then restart the API.
2. Open **AI Providers → ChatGPT Account → Continue with ChatGPT**. TJ starts an HTTP callback on `127.0.0.1`, then opens OpenAI authorization in the Windows system browser.
3. Sign in and review the requested scopes in the browser. TJ validates state, PKCE, the OpenAI-signed ID token and granted plan-usage scopes before saving account-specific credentials in its encrypted vault.
4. On return, click **Discover** on the ChatGPT Account provider if models did not load. Models are account-specific; select a model from that provider's dropdown and set it as default.

Never put your ChatGPT password, OAuth tokens or browser cookies into TJ's API-key field or a chat message. Signing in does not expose ChatGPT conversations to TJ.

## Current scope

- Inference uses only `POST https://api.openai.com/v1/responses` with `store: false` and `stream: true`. The adapter accepts text messages and confirms `response.completed` before recording success.
- Model discovery uses the signed-in account's `GET /v1/models` list and shows only entries marked for display. No model list or quota is fabricated.
- Tokens stay in the backend vault; the web UI receives account labels and status only. Disconnect attempts remote refresh-token revocation and always clears local tokens.
- Tool-call orchestration, multimodal input, account-specific live inference, Windows packaged installer behavior and commercial deployment remain unverified. The adapter rejects unsupported tool or image requests rather than silently changing providers.
- The router stops after a ChatGPT plan failure so it cannot automatically send that task to a billable API-key provider. Existing other-provider routing behavior is unchanged.
- The Tauri shell does not yet package or launch the Node API. Use the local API and web UI for this development preview.

Official references: [Quickstart](https://developers.openai.com/siwc/quickstart), [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
