# Rare360 Demo (Node-enabled)

## What this now supports
- Patient app logs symptoms, flare events, and daily status into calendar entries.
- Real email send for external forms using Resend.
- External recipients open a tokenized form link and submit responses.
- External form responses are written back into the patient calendar timeline.

## Setup
1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Set your values in `.env`:
- `RESEND_API_KEY` from Resend
- `FROM_EMAIL` must be a verified sender in Resend
- `APP_BASE_URL` must be reachable by recipients (for local testing with only your browser, localhost is fine)

## Run
```bash
cd "/Users/rowanmcdonnell/Documents/New project"
export $(grep -v '^#' .env | xargs)
npm start
```

Open `http://localhost:3000`.

## Run with ngrok (public demo link)
This starts an ngrok tunnel, auto-detects its URL, and runs the server with that URL for email links.

1. Install ngrok and authenticate once:
   ```bash
   ngrok config add-authtoken <your_token>
   ```
2. Optionally set `NGROK_AUTHTOKEN` in `.env`.
3. Run:
   ```bash
   cd "/Users/rowanmcdonnell/Documents/New project"
   npm run dev:ngrok
   ```
4. Use the printed `Rare360 public URL` for sharing/demo.

## Important
- If `RESEND_API_KEY` or `FROM_EMAIL` is missing/invalid, email sending fails and UI will show the error.
- `external-form.html` is the hosted page recipients use from the email link.
- Data is stored in `data/store.json` for demo purposes.
