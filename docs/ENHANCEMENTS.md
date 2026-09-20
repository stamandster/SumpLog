# SumpLog enhancement proposal

Status: Proposed
Scope: One enhancement — an AI-assisted maintenance and service chat
Implementation status: Not implemented
Configuration decision: AI configuration is managed in the SumpLog app, not through provider environment variables

## Goal

Add an optional assistant that helps a mechanic understand the selected vehicle's maintenance history, service intervals, specifications, parts, consumables, and uploaded evidence. It should also read receipts and service records from other mechanics and turn them into reviewable drafts.

The assistant must remain useful without changing records automatically. Every answer should show which SumpLog records or documents support it, and every proposed write should require an explicit user confirmation.

## Current baseline

SumpLog already stores the required source material locally:

- Vehicle identity, current and dated mileage, annual-mileage estimates, and vehicle photos
- Maintenance records, next-due mileage/date, parts used, partial consumable usage, costs, and audit history
- Vehicle-specific specifications and service plans with checklist items and reminders
- Parts/consumables inventory, suppliers, quantities, volumes, specifications, and fitments
- Documents stored with stable tracking UUIDs, editable display names, MIME types, notes, and links to multiple maintenance records

There is currently no AI provider client, OCR pipeline, chat route, conversation store, or extraction-review workflow.

## User experience

Add an optional Chat entry below Calculators or in the contextual vehicle navigation. The opening state should identify the active vehicle and explain the evidence boundary:

> Answers use this vehicle's SumpLog records and any documents you explicitly attach. They are suggestions, not factory specifications or a substitute for a qualified mechanic.

The chat should support:

1. A question-and-answer thread with streaming text where supported.
2. Source chips linking to maintenance records, specs, parts, service tasks, and documents.
3. An attachment picker for one or more existing SumpLog documents.
4. A “review extracted fields” screen for receipts and service records.
5. Suggested actions such as “Create reminder,” “Create service task,” or “Prepare maintenance draft,” each requiring confirmation.
6. Clear provider/model disclosure, request progress, cancellation, errors, and a way to clear the conversation.

The assistant should never silently write a maintenance record, change a specification, reduce inventory, or create a reminder.

## Maintenance evidence ordering

**Status: implemented.** Maintenance evidence now has per-record persisted ordering, drag handles, and keyboard/touch move controls. The remaining AI-chat proposal below is intentionally still a future enhancement.

Maintenance evidence should support drag-and-drop positioning so a mechanic can put a receipt first, then the work photos, then supporting documents. Reordering is scoped to the maintenance record: the same shared document may appear in a different position on another record without duplicating the stored file.

The expanded maintenance details and maintenance edit workflow should show a clear drag handle, a visible drop target, and the current position. Dragging must not accidentally open the image editor or toggle the maintenance row. On touch and keyboard devices, provide equivalent Move up, Move down, Move to top, and Move to bottom actions; do not make drag-and-drop the only path.

Order changes should remain in the current edit session until the user saves the record or explicitly saves evidence order. Cancel must restore the previous order. A persisted position field on `document_maintenance_links` is the preferred data-model change because ordering can differ per maintenance link; legacy single-link documents should receive a deterministic fallback based on upload time and ID.

The maintenance PDF report and readable ZIP should preserve each record's evidence order. PDF receipts must remain first within the ordered evidence section, followed by images and other documents according to the user's chosen order. The Documents gallery keeps its own global sorting and is not reordered as a side effect.

## Configuration through the app

AI setup belongs in Settings > Assistant. The user should not need to edit `.env` files or restart the server to select a provider, model, or key.

The Settings workflow should provide:

- Provider: **Groq**, **OpenRouter**, or **Disabled**
- Model selection appropriate to the chosen provider, loaded from a provider model list where available
- Connection test that makes a minimal request and reports latency and the model response status
- “Use for document images/PDFs” capability indicator based on the selected model
- Per-request consent for sending receipts, insurance documents, or other private evidence to a hosted provider
- Usage guardrails such as maximum attachment size, maximum pages/images, and optional monthly request budget
- Clear/remove-key action and provider status

The key is entered in the app and stored encrypted in SQLite. The raw value must never be rendered after save, logged, placed in exports, or sent to the browser after the initial form submission. A practical cross-platform design is to encrypt it with a key derived from the owner password after sign-in; if the key cannot be unlocked, chat remains unavailable until the owner authenticates again. Backups should exclude the provider secret and require re-entry after restore.

Provider endpoints should be fixed by provider selection (`https://api.groq.com/openai/v1` or `https://openrouter.ai/api/v1`) rather than accepting arbitrary URLs from a normal user field. This avoids turning a configurable AI endpoint into an SSRF path. An advanced custom endpoint, if ever added, needs an explicit allowlist and security review.

Infrastructure settings such as `PORT`, `HOST`, `DATABASE_URL`, and `UPLOAD_DIRECTORY` remain deployment configuration. This proposal changes the AI provider/model/key configuration only.

## Provider strategy

Use a small provider interface so the rest of SumpLog does not depend on a vendor SDK:

```text
chat(messages, tools, attachments, options) -> streamed or complete response
listModels() -> model capability summaries
testConnection() -> provider/model status
```

Groq is a strong initial provider for fast conversational responses. Its API is largely OpenAI-compatible, and its Responses API supports image inputs and tool calling. See the [Groq OpenAI compatibility guide](https://console.groq.com/docs/openai) and [Responses API guide](https://console.groq.com/docs/responses-api).

OpenRouter is a useful optional provider for model choice and fallback routing. It exposes an OpenAI-compatible endpoint and supports image and PDF inputs. PDF parsing may use a provider-native path or an OCR engine, so cost and image limits depend on the selected configuration. See the [OpenRouter quickstart](https://openrouter.ai/docs/quickstart) and [PDF input guide](https://openrouter.ai/docs/guides/overview/multimodal/pdfs).

Provider model names, capabilities, limits, and pricing are external dependencies. The Settings UI must treat them as discoverable current metadata rather than hard-coded product guarantees.

## Context and source retrieval

Start without a vector database. Build a bounded, deterministic context pack from SQLite:

- Active vehicle identity and current mileage
- Upcoming service tasks and standalone reminders
- Maintenance records filtered by date, mileage, title, category, shop, and associated parts
- Vehicle specifications and their sources
- Matching parts, consumables, supplier, quantity, volume, and fitment
- Selected document metadata and extracted text, never every document by default

Every context item should carry a stable local source reference such as `maintenance:42` or `document:17`. The response renderer turns those references into normal SumpLog links. Add embeddings only if measured search quality shows that SQLite text search is insufficient.

## Document and receipt understanding

Use the existing document UUID and storage path to read files server-side. Never make private uploads public just to give them to a provider.

For an explicitly selected receipt or mechanic record:

1. Load the original bytes and MIME type.
2. Downsample images only for the model request; preserve the original in SumpLog.
3. Send the minimum selected file(s) after consent.
4. Request structured fields: date, mileage, supplier/shop, work description, part numbers, quantities, prices, tax, total, and suggested next service.
5. Validate dates, numbers, vehicle identity, and part matches with Zod and local catalogue data.
6. Present uncertain or conflicting fields for review.
7. Save only after the user confirms the maintenance draft, parts usage, or document links.

Extraction provenance should record the source document ID, provider, model, request time, prompt/schema version, extracted values, confidence/review state, and approval outcome.

## Safety and trust rules

- Stored SumpLog specs and manufacturer-provided documents outrank model memory.
- The assistant must label estimates, inferences, and unverified external information.
- It must not invent torque values, fluid standards, service intervals, or safety procedures.
- It must not diagnose a dangerous condition from a receipt or photo without a clear uncertainty warning.
- Hosted-provider transmission is opt-in for private documents, with the selected files listed before send.
- Insurance documents and policy details receive the same consent and redaction treatment as receipts.
- AI-suggested writes must pass the existing validation and audit pathways.
- Rate limits, request timeouts, cancellation, retry policy, and provider errors must leave the garage unchanged.

## Suggested implementation sequence

### Phase 1 — Read-only assistant

Add the provider interface, Settings configuration, encrypted-key handling, one chat route, selected-vehicle context retrieval, source links, request limits, and a compact chat panel. No document upload and no write actions yet.

### Phase 2 — Evidence reading

Allow explicit selection of existing images and PDFs. Add image/PDF extraction, structured output validation, provenance records, review UI, and provider/model disclosure. Keep extraction results as drafts.

### Phase 3 — Confirmed actions

Add “prepare maintenance draft,” “create reminder,” and “create service task.” Require a confirmation summary and use normal SumpLog mutations so maintenance audit history and inventory rules remain authoritative.

### Phase 4 — Optional provider fallback

Add OpenRouter model discovery and fallback behavior behind the same interface. Show the actual provider/model used for every response and do not silently switch providers for private documents.

## Acceptance criteria

- A user can configure or disable Groq/OpenRouter entirely from Settings without editing environment variables.
- API keys are never exposed to the browser after save and never appear in JSON, ZIP, CSV, or PDF exports.
- A question scoped to a vehicle returns an answer with source links and does not include unrelated vehicles by default.
- A selected receipt can produce a structured draft with visible uncertain fields, but no record changes before confirmation.
- A shared document can be used as evidence without duplicating its stored file.
- Evidence on a maintenance record can be reordered by drag-and-drop and by accessible move controls, with cancel/revert behavior.
- A shared document can have independent positions on different maintenance records.
- Maintenance PDF and ZIP outputs preserve the saved evidence order while retaining the receipt-first report rule.
- Failed, cancelled, rate-limited, or malformed provider responses leave SQLite and uploads unchanged.
- AI-created reminders, service tasks, and maintenance drafts use existing validation, confirmation, and audit behavior.
- The feature remains disabled and the rest of SumpLog remains fully usable when no provider is configured.
- Tests cover provider selection, encrypted-key access, source scoping, prompt-size limits, document consent, malformed extraction, cancellation, and confirmed writes.

## Explicit non-goals

This proposal does not add multi-user accounts, business licensing, automatic cloud synchronization, a general-purpose autonomous agent, unreviewed record mutation, or a guarantee that a hosted model will retain no request metadata. Provider terms and capabilities must be reviewed again when implementation begins.
