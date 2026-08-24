# Linking ControlRoom with Gemini Spark / Cloud Agents

This guide explains how to connect **Gemini Spark** (or any cloud agent / Custom Gem / Assistant) to live ControlRoom messages in real time.

---

## 1. How It Works
- ControlRoom messages are stored in **Google Cloud Firestore** (`your-journey-your-tools`).
- The Netlify serverless function [`/.netlify/functions/messages`](file:///v:/New%20App%20Ideas/Work/Control%20Room/netlify/functions/messages.cjs) exposes a secure REST API in the cloud.
- Gemini Spark uses the OpenAPI specification ([`public/openapi.yaml`](file:///v:/New%20App%20Ideas/Work/Control%20Room/public/openapi.yaml) or [`public/openapi.json`](file:///v:/New%20App%20Ideas/Work/Control%20Room/public/openapi.json)) to fetch and resolve tickets on demand.

---

## 2. Environment Variable Setup (Netlify)

In your [Netlify Dashboard](https://app.netlify.com) > **Site configuration** > **Environment variables**:

1. Ensure the existing credentials are set:
   - `GOOGLE_CLIENT_EMAIL`: Your Firebase Service Account Email
   - `GOOGLE_PRIVATE_KEY`: Your Firebase RSA Private Key
   - `GOOGLE_PROJECT_ID`: `your-journey-your-tools`
2. *(Optional & Recommended)* Add an API Key to secure the endpoint:
   - `CONTROLROOM_API_KEY`: e.g. `cr_live_sec_123456789`

---

## 3. Configuring Gemini Spark / Custom Gem / Agent

### Step 3.1: Add the Custom Tool / Action
In your Gemini Spark / Custom Gem / Agent configuration screen:

1. Under **Tools / Actions**, select **Add Action** (or **Import OpenAPI**).
2. Set the **Server URL** to your Netlify site URL, e.g.:
   ```
   https://control-room.yourdomain.com/.netlify/functions
   ```
3. Import or paste the OpenAPI schema from [`public/openapi.yaml`](file:///v:/New%20App%20Ideas/Work/Control%20Room/public/openapi.yaml) (or upload [`openapi.json`](file:///v:/New%20App%20Ideas/Work/Control%20Room/public/openapi.json)).
4. **Authentication**:
   - Authentication Type: **API Key**
   - Header Name: `x-api-key`
   - API Key Value: `<Your CONTROLROOM_API_KEY>` (or choose Bearer token)

---

### Step 3.2: System Instructions / Prompt for Gemini Spark
Add this section to your Gemini Spark's System Instructions:

```markdown
### 🎛️ ControlRoom Integration
You have access to the live ControlRoom API for user feedback, error reports, and support tickets.
- To check open or pending tickets, invoke `getMessages(status='unresolved')`.
- You can filter by application (`app='PlexMePlease'`), priority (`priority='high'`), or limit.
- To view full details and thread history for a ticket, invoke `getMessages(message_id='<ID>')`.
- To resolve a ticket once handled, invoke `resolveMessage(message_id='<ID>', notes='...')`.
```

---

## 4. API Reference Summary

| Method | Endpoint | Description | Query / Body Params |
|---|---|---|---|
| `GET` | `/.netlify/functions/messages` | List unresolved tickets | `limit`, `priority`, `app`, `since`, `status` |
| `GET` | `/.netlify/functions/messages?message_id={id}` | Get full ticket details | `message_id` |
| `POST` | `/.netlify/functions/messages` | Resolve ticket | Body: `{"action": "resolve", "message_id": "...", "notes": "..."}` |
